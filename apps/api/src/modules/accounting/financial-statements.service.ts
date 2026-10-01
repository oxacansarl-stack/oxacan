import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AccountTotals,
  BalanceSheet,
  IncomeStatement,
  buildBalanceSheet,
  buildIncomeStatement,
} from './financial-statements';

/** Today in Switzerland as YYYY-MM-DD. */
export function swissToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
}

/**
 * Bilan and compte de résultat (PRD §16.2) from POSTED journal entries only: entries the
 * invoicing writes stay drafts until posted, and are reported as `unpostedEntryCount` so the
 * reader knows the statements leave them out.
 */
@Injectable()
export class FinancialStatementsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Per-account debit / credit totals of posted lines up to dateTo, split at dateFrom. */
  private async accountTotals(companyId: string, dateFrom: string | null, dateTo: string): Promise<AccountTotals[]> {
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT a.id AS account_id, a.account_number, a.name AS account_name, a.type AS account_type,
              COALESCE(SUM(l.debit_cents)  FILTER (WHERE $2::date IS NULL OR e.entry_date >= $2::date), 0)::bigint AS period_debit,
              COALESCE(SUM(l.credit_cents) FILTER (WHERE $2::date IS NULL OR e.entry_date >= $2::date), 0)::bigint AS period_credit,
              COALESCE(SUM(l.debit_cents)  FILTER (WHERE e.entry_date < $2::date), 0)::bigint AS prior_debit,
              COALESCE(SUM(l.credit_cents) FILTER (WHERE e.entry_date < $2::date), 0)::bigint AS prior_credit
         FROM journal_entry_line l
         JOIN journal_entry e ON e.id = l.journal_entry_id AND e.company_id = l.company_id
         JOIN chart_of_accounts a ON a.id = l.account_id AND a.company_id = l.company_id
        WHERE l.company_id = $1 AND e.is_posted = true AND e.entry_date <= $3::date
        GROUP BY a.id, a.account_number, a.name, a.type
        ORDER BY a.account_number`,
      [companyId, dateFrom, dateTo],
    );
    return rows.map((r) => ({
      accountId: r.account_id,
      accountNumber: r.account_number,
      accountName: r.account_name,
      accountType: r.account_type,
      periodDebitCents: Number(r.period_debit),
      periodCreditCents: Number(r.period_credit),
      priorDebitCents: Number(r.prior_debit),
      priorCreditCents: Number(r.prior_credit),
    }));
  }

  private async unpostedCount(companyId: string, dateFrom: string | null, dateTo: string): Promise<number> {
    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM journal_entry
        WHERE company_id = $1 AND is_posted = false AND entry_date <= $3::date
          AND ($2::date IS NULL OR entry_date >= $2::date)`,
      [companyId, dateFrom, dateTo],
    );
    return row?.n ?? 0;
  }

  /**
   * Balance sheet at dateTo (cumulative). With dateFrom, the unclosed result is split into what was
   * earned before dateFrom and the result of [dateFrom, dateTo].
   */
  async balanceSheet(
    companyId: string,
    dateTo: string,
    dateFrom: string | null,
  ): Promise<BalanceSheet & { unpostedEntryCount: number }> {
    const [rows, unposted] = await Promise.all([
      this.accountTotals(companyId, dateFrom, dateTo),
      this.unpostedCount(companyId, null, dateTo),
    ]);
    return { ...buildBalanceSheet(rows, dateTo, dateFrom), unpostedEntryCount: unposted };
  }

  /** Income statement of [dateFrom, dateTo]. */
  async incomeStatement(
    companyId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<IncomeStatement & { unpostedEntryCount: number }> {
    const [rows, unposted] = await Promise.all([
      this.accountTotals(companyId, dateFrom, dateTo),
      this.unpostedCount(companyId, dateFrom, dateTo),
    ]);
    return { ...buildIncomeStatement(rows, dateFrom, dateTo), unpostedEntryCount: unposted };
  }
}
