import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { BusinessRuleError, NotFoundError, ValidationError } from '@oxacan/shared-types';
import { InvoicingService } from '../invoicing/invoicing.service';
import type { RecordPaymentDto } from '../invoicing/dto/invoice.dto';
import {
  ParsedStatementLine,
  StatementFormat,
  StatementParseError,
  parseBankStatement,
} from './bank-statement-parser';
import {
  LineSuggestion,
  MatchInvoice,
  MatchLine,
  MatchPayment,
  PAYMENT_DATE_WINDOW_DAYS,
  isMatchableLine,
  suggestMatches,
} from './bank-matching';
import { ImportBankStatementDto, MatchBankLineDto } from './dto/accounting.dto';

/** Invoice statuses on which InvoicingService.recordPayment accepts a payment. */
const OPEN_INVOICE_STATUSES = ['sent', 'partially_paid', 'overdue'];

const LINE_COLUMNS = `l.id, l.statement_id, l.line_no, to_char(l.booking_date, 'YYYY-MM-DD') AS booking_date,
  to_char(l.value_date, 'YYYY-MM-DD') AS value_date, l.amount_cents, l.currency, l.reference, l.remittance_info,
  l.counterparty_name, l.counterparty_iban, l.bank_reference, l.status, l.matched_payment_id, l.matched_invoice_id,
  l.matched_at, l.matched_by`;

const STATEMENT_COLUMNS = `s.id, s.format, s.filename, s.statement_ref, s.iban, s.currency,
  to_char(s.period_from, 'YYYY-MM-DD') AS period_from, to_char(s.period_to, 'YYYY-MM-DD') AS period_to,
  s.opening_balance_cents, s.closing_balance_cents, s.line_count, s.content_sha256, s.imported_by, s.created_at`;

export interface BankLine {
  id: string;
  statementId: string;
  lineNo: number;
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  currency: string | null;
  reference: string | null;
  remittanceInfo: string | null;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  bankReference: string | null;
  status: 'unmatched' | 'matched' | 'ignored';
  matchedPaymentId: string | null;
  matchedInvoiceId: string | null;
  matchedAt: Date | null;
  matchedBy: string | null;
}

function toLine(r: Record<string, any>): BankLine {
  return {
    id: r.id,
    statementId: r.statement_id,
    lineNo: r.line_no,
    bookingDate: r.booking_date,
    valueDate: r.value_date,
    amountCents: Number(r.amount_cents),
    currency: r.currency,
    reference: r.reference,
    remittanceInfo: r.remittance_info,
    counterpartyName: r.counterparty_name,
    counterpartyIban: r.counterparty_iban,
    bankReference: r.bank_reference,
    status: r.status,
    matchedPaymentId: r.matched_payment_id,
    matchedInvoiceId: r.matched_invoice_id,
    matchedAt: r.matched_at,
    matchedBy: r.matched_by,
  };
}

function toStatement(r: Record<string, any>) {
  return {
    id: r.id,
    format: r.format as StatementFormat,
    filename: r.filename,
    statementRef: r.statement_ref,
    iban: r.iban,
    currency: r.currency,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    openingBalanceCents: r.opening_balance_cents === null ? null : Number(r.opening_balance_cents),
    closingBalanceCents: r.closing_balance_cents === null ? null : Number(r.closing_balance_cents),
    lineCount: r.line_count,
    contentSha256: r.content_sha256,
    importedBy: r.imported_by,
    createdAt: r.created_at,
    ...(r.unmatched_count !== undefined
      ? { unmatchedCount: r.unmatched_count, matchedCount: r.matched_count, ignoredCount: r.ignored_count }
      : {}),
  };
}

/**
 * Re-importing the same file, or an overlapping statement, must not duplicate lines: each line
 * has a key unique per company — the bank's reference of the booking (unique per account, so
 * prefixed with the statement IBAN) when there is one, else a hash of its content — numbered when
 * a file holds several identical lines.
 */
function dedupeKeys(lines: ParsedStatementLine[], iban: string | null): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = l.bankReference
      ? `ref:${iban ?? ''}:${l.bankReference}`
      : 'h:' + createHash('sha256')
          .update([iban, l.bookingDate, l.amountCents, l.reference, l.remittanceInfo, l.counterpartyIban, l.counterpartyName].join('|'))
          .digest('hex');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

/**
 * Bank reconciliation (PRD §16.2 "Rapprochement"): import a statement (camt.053 or CSV), suggest
 * matches of its incoming lines with recorded payments and open invoices (see bank-matching.ts),
 * and confirm them. Confirming against an invoice records the payment through
 * InvoicingService.recordPayment, which also writes the journal entry (debit 1020 Bank, credit
 * 1100 Receivables) and updates the invoice status.
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly invoicing: InvoicingService,
  ) {}

  /* ═══════════════════════════════════════════════
     Import
     ═══════════════════════════════════════════════ */

  async importStatement(companyId: string, userId: string, dto: ImportBankStatementDto) {
    let parsed;
    try {
      parsed = parseBankStatement(dto.content, dto.format);
    } catch (e) {
      if (e instanceof StatementParseError) throw new ValidationError(e.message);
      throw e;
    }
    const sha256 = createHash('sha256').update(dto.content, 'utf8').digest('hex');

    const [already] = await this.dataSource.query(
      'SELECT id FROM bank_statement WHERE company_id = $1 AND content_sha256 = $2',
      [companyId, sha256],
    );
    if (already) {
      throw new BusinessRuleError('STATEMENT_ALREADY_IMPORTED', 'This bank statement has already been imported.', {
        statementId: already.id,
      });
    }

    const warnings: string[] = [];
    const [company] = await this.dataSource.query('SELECT iban FROM company WHERE id = $1', [companyId]);
    const companyIban = company?.iban ? String(company.iban).replace(/\s+/g, '').toUpperCase() : null;
    if (parsed.iban && companyIban && parsed.iban !== companyIban) {
      warnings.push(`The statement account ${parsed.iban} is not the company IBAN.`);
    }
    if (parsed.lines.some((l) => l.currency && l.currency.toUpperCase() !== 'CHF')) {
      warnings.push('Lines in a currency other than CHF are imported but never suggested for matching.');
    }

    const keys = dedupeKeys(parsed.lines, parsed.iban);
    return this.dataSource.transaction(async (m) => {
      const [statement] = await m.query(
        `INSERT INTO bank_statement (company_id, format, filename, statement_ref, iban, currency, period_from, period_to,
                                     opening_balance_cents, closing_balance_cents, content_sha256, imported_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [companyId, parsed.format, dto.filename ?? null, parsed.statementRef, parsed.iban, parsed.currency,
          parsed.periodFrom, parsed.periodTo, parsed.openingBalanceCents, parsed.closingBalanceCents, sha256, userId],
      );

      let imported = 0;
      if (parsed.lines.length) {
        const col = <K extends keyof ParsedStatementLine>(k: K) => parsed.lines.map((l) => l[k]);
        const inserted: { id: string }[] = await m.query(
          `INSERT INTO bank_statement_line (company_id, statement_id, line_no, booking_date, value_date, amount_cents,
                                            currency, reference, remittance_info, counterparty_name, counterparty_iban,
                                            bank_reference, dedupe_key)
           SELECT $1, $2, t.line_no, t.booking_date, t.value_date, t.amount_cents, t.currency, t.reference,
                  t.remittance_info, t.counterparty_name, t.counterparty_iban, t.bank_reference, t.dedupe_key
             FROM unnest($3::int[], $4::date[], $5::date[], $6::bigint[], $7::text[], $8::text[], $9::text[],
                         $10::text[], $11::text[], $12::text[], $13::text[])
                  AS t(line_no, booking_date, value_date, amount_cents, currency, reference, remittance_info,
                       counterparty_name, counterparty_iban, bank_reference, dedupe_key)
           ON CONFLICT (company_id, dedupe_key) DO NOTHING
           RETURNING id`,
          [companyId, statement.id, parsed.lines.map((_, i) => i + 1), col('bookingDate'), col('valueDate'),
            col('amountCents'), col('currency'), col('reference'), col('remittanceInfo'), col('counterpartyName'),
            col('counterpartyIban'), col('bankReference'), keys],
        );
        imported = inserted.length;
      }
      await m.query('UPDATE bank_statement SET line_count = $3 WHERE id = $1 AND company_id = $2', [
        statement.id, companyId, imported,
      ]);

      const [row] = await m.query(`SELECT ${STATEMENT_COLUMNS} FROM bank_statement s WHERE s.id = $1 AND s.company_id = $2`, [
        statement.id, companyId,
      ]);
      return {
        statement: toStatement(row),
        importedLines: imported,
        duplicateLines: parsed.lines.length - imported,
        skippedEntries: parsed.skippedEntries,
        warnings,
      };
    });
  }

  /* ═══════════════════════════════════════════════
     Statements
     ═══════════════════════════════════════════════ */

  async listStatements(companyId: string, page = 1, limit = 25) {
    const [{ total }] = await this.dataSource.query(
      'SELECT count(*)::int AS total FROM bank_statement WHERE company_id = $1',
      [companyId],
    );
    const rows = await this.dataSource.query(
      `SELECT ${STATEMENT_COLUMNS},
              count(l.id) FILTER (WHERE l.status = 'unmatched')::int AS unmatched_count,
              count(l.id) FILTER (WHERE l.status = 'matched')::int AS matched_count,
              count(l.id) FILTER (WHERE l.status = 'ignored')::int AS ignored_count
         FROM bank_statement s
         LEFT JOIN bank_statement_line l ON l.statement_id = s.id AND l.company_id = s.company_id
        WHERE s.company_id = $1
        GROUP BY s.id
        ORDER BY s.created_at DESC, s.id
        LIMIT $2 OFFSET $3`,
      [companyId, limit, (page - 1) * limit],
    );
    return { data: rows.map(toStatement), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getStatement(companyId: string, id: string) {
    const [row] = await this.dataSource.query(
      `SELECT ${STATEMENT_COLUMNS} FROM bank_statement s WHERE s.id = $1 AND s.company_id = $2`,
      [id, companyId],
    );
    if (!row) throw new NotFoundError('BankStatement', id);
    const lines = await this.dataSource.query(
      `SELECT ${LINE_COLUMNS} FROM bank_statement_line l
        WHERE l.company_id = $1 AND l.statement_id = $2 ORDER BY l.line_no`,
      [companyId, id],
    );
    return { ...toStatement(row), lines: lines.map(toLine) };
  }

  private async findLine(companyId: string, lineId: string, db: { query: DataSource['query'] } = this.dataSource): Promise<BankLine> {
    const [row] = await db.query(
      `SELECT ${LINE_COLUMNS} FROM bank_statement_line l WHERE l.id = $1 AND l.company_id = $2`,
      [lineId, companyId],
    );
    if (!row) throw new NotFoundError('BankStatementLine', lineId);
    return toLine(row);
  }

  /* ═══════════════════════════════════════════════
     Suggestions & unmatched lists
     ═══════════════════════════════════════════════ */

  /** Recorded payments of the company that no bank line is linked to yet. */
  private async unlinkedPayments(companyId: string, from: string | null, to: string | null): Promise<MatchPayment[]> {
    const rows = await this.dataSource.query(
      `SELECT p.id, p.invoice_id, i.invoice_number, p.amount_cents, to_char(p.payment_date, 'YYYY-MM-DD') AS payment_date,
              p.reference
         FROM payment p
         JOIN invoice i ON i.id = p.invoice_id AND i.company_id = p.company_id
        WHERE p.company_id = $1
          AND ($2::date IS NULL OR p.payment_date >= $2::date)
          AND ($3::date IS NULL OR p.payment_date <= $3::date)
          AND NOT EXISTS (SELECT 1 FROM bank_statement_line l
                           WHERE l.company_id = p.company_id AND l.matched_payment_id = p.id)
        ORDER BY p.payment_date, p.id`,
      [companyId, from, to],
    );
    return rows.map((r: any) => ({
      id: r.id, invoiceId: r.invoice_id, invoiceNumber: r.invoice_number, amountCents: Number(r.amount_cents),
      paymentDate: r.payment_date, reference: r.reference,
    }));
  }

  /** Customer invoices that can still receive a payment. */
  private async openInvoices(companyId: string): Promise<MatchInvoice[]> {
    const rows = await this.dataSource.query(
      `SELECT i.id, i.invoice_number, c.name AS client_name, to_char(i.issue_date, 'YYYY-MM-DD') AS issue_date,
              to_char(i.due_date, 'YYYY-MM-DD') AS due_date, i.total_ttc_cents,
              (i.total_ttc_cents - COALESCE(i.amount_paid_cents, 0))::bigint AS outstanding_cents
         FROM invoice i
         LEFT JOIN client c ON c.id = i.client_id AND c.company_id = i.company_id
        WHERE i.company_id = $1 AND i.type <> 'credit_note' AND i.status = ANY($2)
          AND i.total_ttc_cents - COALESCE(i.amount_paid_cents, 0) > 0
        ORDER BY i.issue_date, i.invoice_number`,
      [companyId, OPEN_INVOICE_STATUSES],
    );
    return rows.map((r: any) => ({
      id: r.id, invoiceNumber: r.invoice_number, clientName: r.client_name, issueDate: r.issue_date,
      dueDate: r.due_date, totalTtcCents: Number(r.total_ttc_cents), outstandingCents: Number(r.outstanding_cents),
    }));
  }

  private async unmatchedLines(companyId: string, statementId?: string): Promise<BankLine[]> {
    const rows = await this.dataSource.query(
      `SELECT ${LINE_COLUMNS} FROM bank_statement_line l
        WHERE l.company_id = $1 AND l.status = 'unmatched' AND ($2::uuid IS NULL OR l.statement_id = $2::uuid)
        ORDER BY l.booking_date, l.statement_id, l.line_no`,
      [companyId, statementId ?? null],
    );
    return rows.map(toLine);
  }

  private static windowOf(lines: MatchLine[]): { from: string | null; to: string | null } {
    if (!lines.length) return { from: null, to: null };
    const dates = lines.flatMap((l) => [l.bookingDate, l.valueDate].filter((d): d is string => !!d)).sort();
    const shift = (d: string, days: number) =>
      new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    return { from: shift(dates[0], -PAYMENT_DATE_WINDOW_DAYS), to: shift(dates[dates.length - 1], PAYMENT_DATE_WINDOW_DAYS) };
  }

  /** Suggested matches for every unmatched incoming line (of one statement, or of all statements). */
  async suggestions(companyId: string, statementId?: string): Promise<{ statementId: string | null; lines: (LineSuggestion & { line: BankLine })[] }> {
    if (statementId) await this.getStatementRow(companyId, statementId);
    const lines = (await this.unmatchedLines(companyId, statementId)).filter(isMatchableLine);
    if (!lines.length) return { statementId: statementId ?? null, lines: [] };
    const window = BankReconciliationService.windowOf(lines);
    const [payments, invoices] = await Promise.all([
      this.unlinkedPayments(companyId, window.from, window.to),
      this.openInvoices(companyId),
    ]);
    const byId = new Map(lines.map((l) => [l.id, l]));
    return {
      statementId: statementId ?? null,
      lines: suggestMatches(lines, payments, invoices).map((s) => ({ ...s, line: byId.get(s.lineId)! })),
    };
  }

  private async getStatementRow(companyId: string, id: string) {
    const [row] = await this.dataSource.query('SELECT id FROM bank_statement WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (!row) throw new NotFoundError('BankStatement', id);
    return row;
  }

  /**
   * What is left to reconcile: bank lines not matched or ignored, recorded bank-transfer payments
   * no bank line confirms, and invoices still awaiting payment.
   */
  async unmatched(companyId: string, statementId?: string) {
    if (statementId) await this.getStatementRow(companyId, statementId);
    const [bankLines, payments, invoices] = await Promise.all([
      this.unmatchedLines(companyId, statementId),
      this.dataSource.query(
        `SELECT p.id, p.invoice_id, i.invoice_number, p.amount_cents, to_char(p.payment_date, 'YYYY-MM-DD') AS payment_date,
                p.payment_method, p.reference
           FROM payment p
           JOIN invoice i ON i.id = p.invoice_id AND i.company_id = p.company_id
          WHERE p.company_id = $1 AND p.payment_method = 'bank_transfer'
            AND NOT EXISTS (SELECT 1 FROM bank_statement_line l
                             WHERE l.company_id = p.company_id AND l.matched_payment_id = p.id)
          ORDER BY p.payment_date, p.id`,
        [companyId],
      ),
      this.openInvoices(companyId),
    ]);
    return {
      statementId: statementId ?? null,
      bankLines,
      payments: payments.map((r: any) => ({
        id: r.id, invoiceId: r.invoice_id, invoiceNumber: r.invoice_number, amountCents: Number(r.amount_cents),
        paymentDate: r.payment_date, paymentMethod: r.payment_method, reference: r.reference,
      })),
      openInvoices: invoices,
    };
  }

  /* ═══════════════════════════════════════════════
     Confirmation
     ═══════════════════════════════════════════════ */

  /**
   * Confirms a match. With paymentId the line is linked to that recorded payment (same amount
   * required; a payment confirms at most one line). With invoiceId the line's amount is recorded
   * as a bank-transfer payment of the invoice, dated on the booking date, via
   * InvoicingService.recordPayment (which refuses overpayments and non-payable invoices).
   */
  async match(companyId: string, userId: string, lineId: string, dto: MatchBankLineDto) {
    if (!!dto.paymentId === !!dto.invoiceId) {
      throw new ValidationError('Provide exactly one of paymentId or invoiceId.');
    }
    const line = await this.findLine(companyId, lineId);
    if (line.status !== 'unmatched') {
      throw new BusinessRuleError('LINE_NOT_UNMATCHED', `This bank line is already ${line.status}.`);
    }
    if (!isMatchableLine(line)) {
      throw new BusinessRuleError('LINE_NOT_MATCHABLE', 'Only incoming CHF lines can be matched to customer payments.');
    }

    if (dto.paymentId) {
      const paymentId = dto.paymentId;
      await this.dataSource.transaction(async (m) => {
        const [payment] = await m.query(
          'SELECT id, invoice_id, amount_cents FROM payment WHERE id = $1 AND company_id = $2 FOR UPDATE',
          [paymentId, companyId],
        );
        if (!payment) throw new NotFoundError('Payment', paymentId);
        if (Number(payment.amount_cents) !== line.amountCents) {
          throw new BusinessRuleError('AMOUNT_MISMATCH', 'The payment amount differs from the bank line amount.');
        }
        const [linked] = await m.query(
          'SELECT id FROM bank_statement_line WHERE company_id = $1 AND matched_payment_id = $2',
          [companyId, paymentId],
        );
        if (linked) throw new BusinessRuleError('PAYMENT_ALREADY_MATCHED', 'This payment is already matched to a bank line.');
        const claimed = await m.query(
          `UPDATE bank_statement_line
              SET status = 'matched', matched_payment_id = $3, matched_invoice_id = $4, matched_at = now(), matched_by = $5
            WHERE id = $1 AND company_id = $2 AND status = 'unmatched'
            RETURNING id`,
          [lineId, companyId, paymentId, payment.invoice_id, userId],
        );
        if (!claimed.length) throw new BusinessRuleError('LINE_NOT_UNMATCHED', 'This bank line was matched meanwhile.');
      });
      return { line: await this.findLine(companyId, lineId), paymentCreated: false };
    }

    const invoiceId = dto.invoiceId!;
    const [invoice] = await this.dataSource.query('SELECT id FROM invoice WHERE id = $1 AND company_id = $2', [
      invoiceId, companyId,
    ]);
    if (!invoice) throw new NotFoundError('Invoice', invoiceId);

    // Claim the line first, so two concurrent confirmations cannot both record a payment.
    const claimed = await this.dataSource.query(
      `UPDATE bank_statement_line
          SET status = 'matched', matched_invoice_id = $3, matched_at = now(), matched_by = $4
        WHERE id = $1 AND company_id = $2 AND status = 'unmatched'
        RETURNING id`,
      [lineId, companyId, invoiceId, userId],
    );
    if (!claimed.length) throw new BusinessRuleError('LINE_NOT_UNMATCHED', 'This bank line was matched meanwhile.');

    let paymentId: string;
    try {
      const paymentDto: RecordPaymentDto = {
        amountCents: line.amountCents,
        paymentDate: line.bookingDate,
        paymentMethod: 'bank_transfer',
        reference: (line.reference ?? line.bankReference ?? undefined)?.slice(0, 200),
      };
      paymentId = (await this.invoicing.recordPayment(companyId, userId, invoiceId, paymentDto)).id;
    } catch (err) {
      await this.dataSource.query(
        `UPDATE bank_statement_line
            SET status = 'unmatched', matched_invoice_id = NULL, matched_at = NULL, matched_by = NULL
          WHERE id = $1 AND company_id = $2 AND matched_payment_id IS NULL`,
        [lineId, companyId],
      );
      throw err;
    }
    await this.dataSource.query(
      'UPDATE bank_statement_line SET matched_payment_id = $3 WHERE id = $1 AND company_id = $2',
      [lineId, companyId, paymentId],
    );
    return { line: await this.findLine(companyId, lineId), paymentCreated: true };
  }

  /**
   * Puts a matched or ignored line back to unmatched. A payment recorded by the match is kept (it is
   * an accounting record with its journal entry); it shows again among the unlinked payments.
   */
  async unmatch(companyId: string, lineId: string) {
    const line = await this.findLine(companyId, lineId);
    if (line.status === 'unmatched') {
      throw new BusinessRuleError('LINE_NOT_MATCHED', 'This bank line is not matched or ignored.');
    }
    await this.dataSource.query(
      `UPDATE bank_statement_line
          SET status = 'unmatched', matched_payment_id = NULL, matched_invoice_id = NULL, matched_at = NULL, matched_by = NULL
        WHERE id = $1 AND company_id = $2`,
      [lineId, companyId],
    );
    return { line: await this.findLine(companyId, lineId), paymentKeptId: line.matchedPaymentId };
  }

  /** Marks a line that needs no customer payment (bank fees, supplier payments, transfers…). */
  async ignore(companyId: string, userId: string, lineId: string) {
    const updated = await this.dataSource.query(
      `UPDATE bank_statement_line SET status = 'ignored', matched_at = now(), matched_by = $3
        WHERE id = $1 AND company_id = $2 AND status = 'unmatched'
        RETURNING id`,
      [lineId, companyId, userId],
    );
    if (!updated.length) {
      const line = await this.findLine(companyId, lineId);
      throw new BusinessRuleError('LINE_NOT_UNMATCHED', `This bank line is already ${line.status}.`);
    }
    return { line: await this.findLine(companyId, lineId) };
  }
}
