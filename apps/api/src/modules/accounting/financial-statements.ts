/**
 * Balance sheet (bilan) and income statement (compte de résultat) from per-account totals of
 * posted journal lines (PRD §16.2). Pure functions: no DB access.
 *
 * Accounts are placed by their type (asset / liability / equity / revenue / expense) and, inside
 * that, by the class of the Swiss KMU/PME chart their number falls in (1 actifs, 2 passifs,
 * 3–8 compte de résultat). An account whose number does not fit its type's classes (a custom
 * chart) is listed under "Autres" of its type, so every posted centime appears exactly once.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

/** Debit and credit totals of one account, split around the start of the period. */
export interface AccountTotals {
  accountId: string;
  accountNumber: string;
  accountName: string;
  accountType: string;
  /** Lines dated in [dateFrom, dateTo] (or up to dateTo when there is no dateFrom). */
  periodDebitCents: number;
  periodCreditCents: number;
  /** Lines dated before dateFrom (0 when there is no dateFrom). */
  priorDebitCents: number;
  priorCreditCents: number;
}

export interface StatementAccount {
  accountId: string | null;
  accountNumber: string | null;
  accountName: string;
  accountType: string;
  /** Natural-side balance: debit − credit for assets and expenses, credit − debit otherwise. */
  amountCents: number;
}

export interface StatementGroup {
  code: string;
  label: string;
  totalCents: number;
  accounts: StatementAccount[];
}

export interface StatementSection {
  totalCents: number;
  groups: StatementGroup[];
}

/* ── KMU/PME classes and balance sheet groups ── */

export const KMU_CLASSES: Record<string, string> = {
  '1': 'Actifs',
  '2': 'Passifs',
  '3': "Produits nets des ventes de biens et de prestations de services",
  '4': 'Charges de matériel, de marchandises et de prestations de tiers',
  '5': 'Charges de personnel',
  '6': "Autres charges d'exploitation, amortissements et résultat financier",
  '7': "Résultat des activités annexes d'exploitation",
  '8': 'Résultats extraordinaires, hors exploitation et impôts',
};

/** Balance sheet groups: two-digit prefix ranges of classes 1 and 2. */
const BALANCE_GROUPS: { type: AccountType; code: string; label: string; from: number; to: number }[] = [
  { type: 'asset', code: '10', label: 'Actif circulant', from: 10, to: 13 },
  { type: 'asset', code: '14', label: 'Actif immobilisé', from: 14, to: 19 },
  { type: 'liability', code: '20', label: 'Capitaux étrangers à court terme', from: 20, to: 23 },
  { type: 'liability', code: '24', label: 'Capitaux étrangers à long terme', from: 24, to: 27 },
  { type: 'equity', code: '28', label: 'Capitaux propres', from: 28, to: 29 },
];

const OTHER_LABEL: Record<AccountType, string> = {
  asset: 'Autres actifs',
  liability: 'Autres capitaux étrangers',
  equity: 'Autres capitaux propres',
  revenue: 'Autres produits',
  expense: 'Autres charges',
};

/** Order of the income statement and the intermediate result printed after each class. */
const INCOME_STAGES: { cls: string; subtotal?: { key: string; label: string } }[] = [
  { cls: '3' },
  { cls: '4', subtotal: { key: 'gross_profit_material', label: 'Bénéfice brut après charges de matériel et de prestations de tiers' } },
  { cls: '5', subtotal: { key: 'gross_profit_personnel', label: 'Bénéfice brut après charges de personnel' } },
  { cls: '6', subtotal: { key: 'operating_result', label: "Résultat d'exploitation" } },
  { cls: '7', subtotal: { key: 'result_after_ancillary', label: 'Résultat après activités annexes' } },
  { cls: '8' },
  { cls: 'other' },
];

const debitNormal = (type: string) => type === 'asset' || type === 'expense';

function natural(type: string, debit: number, credit: number): number {
  return debitNormal(type) ? debit - credit : credit - debit;
}

function twoDigitPrefix(accountNumber: string): number | null {
  const m = /^(\d{2})/.exec(accountNumber.trim());
  return m ? Number(m[1]) : null;
}

/** KMU class (first digit) of an account number, or null for a non-numeric number. */
export function kmuClass(accountNumber: string): string | null {
  const m = /^(\d)/.exec(accountNumber.trim());
  return m ? m[1] : null;
}

function byNumber(a: StatementAccount, b: StatementAccount) {
  return (a.accountNumber ?? '').localeCompare(b.accountNumber ?? '', 'en', { numeric: true });
}

function section(type: AccountType, accounts: StatementAccount[]): StatementSection {
  const groups = new Map<string, StatementGroup>();
  const defs = BALANCE_GROUPS.filter((g) => g.type === type);
  for (const a of [...accounts].sort(byNumber)) {
    const prefix = a.accountNumber ? twoDigitPrefix(a.accountNumber) : null;
    const def = prefix === null ? undefined : defs.find((g) => prefix >= g.from && prefix <= g.to);
    const code = def?.code ?? 'other';
    let g = groups.get(code);
    if (!g) {
      g = { code, label: def?.label ?? OTHER_LABEL[type], totalCents: 0, accounts: [] };
      groups.set(code, g);
    }
    g.accounts.push(a);
    g.totalCents += a.amountCents;
  }
  const order = [...defs.map((d) => d.code), 'other'];
  const sorted = [...groups.values()].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  return { totalCents: sorted.reduce((s, g) => s + g.totalCents, 0), groups: sorted };
}

/* ── Balance sheet ── */

export interface BalanceSheet {
  asOfDate: string;
  dateFrom: string | null;
  basis: 'posted_entries';
  assets: StatementSection;
  liabilities: StatementSection;
  equity: StatementSection;
  /**
   * Revenue − expense not yet closed to equity: before dateFrom (carried forward) and within the
   * period. Shown in equity as group "result" so the balance sheet balances before year-end closing.
   */
  result: { priorPeriodsCents: number; periodCents: number; totalCents: number };
  totalAssetsCents: number;
  totalLiabilitiesAndEquityCents: number;
  differenceCents: number;
  isBalanced: boolean;
}

export function buildBalanceSheet(rows: AccountTotals[], asOfDate: string, dateFrom: string | null): BalanceSheet {
  const buckets: Record<'asset' | 'liability' | 'equity', StatementAccount[]> = { asset: [], liability: [], equity: [] };
  let priorResult = 0;
  let periodResult = 0;

  for (const r of rows) {
    const debit = r.priorDebitCents + r.periodDebitCents;
    const credit = r.priorCreditCents + r.periodCreditCents;
    if (r.accountType === 'revenue' || r.accountType === 'expense') {
      // Result contribution: credit − debit for both (revenue adds, expense subtracts).
      priorResult += r.priorCreditCents - r.priorDebitCents;
      periodResult += r.periodCreditCents - r.periodDebitCents;
      continue;
    }
    if (debit === 0 && credit === 0) continue;
    const type = (r.accountType in buckets ? r.accountType : 'asset') as keyof typeof buckets;
    buckets[type].push({
      accountId: r.accountId,
      accountNumber: r.accountNumber,
      accountName: r.accountName,
      accountType: r.accountType,
      amountCents: natural(type, debit, credit),
    });
  }

  const assets = section('asset', buckets.asset);
  const liabilities = section('liability', buckets.liability);
  const equity = section('equity', buckets.equity);

  const resultAccounts: StatementAccount[] = [];
  if (dateFrom && priorResult !== 0) {
    resultAccounts.push({
      accountId: null, accountNumber: null, accountType: 'equity', amountCents: priorResult,
      accountName: `Résultat non clôturé avant le ${dateFrom}`,
    });
  }
  resultAccounts.push({
    accountId: null, accountNumber: null, accountType: 'equity',
    amountCents: dateFrom ? periodResult : priorResult + periodResult,
    accountName: dateFrom ? 'Bénéfice / perte de la période' : "Bénéfice / perte de l'exercice (non clôturé)",
  });
  const resultTotal = priorResult + periodResult;
  equity.groups.push({ code: 'result', label: 'Résultat non clôturé', totalCents: resultTotal, accounts: resultAccounts });
  equity.totalCents += resultTotal;

  const totalLiabilitiesAndEquityCents = liabilities.totalCents + equity.totalCents;
  return {
    asOfDate,
    dateFrom,
    basis: 'posted_entries',
    assets,
    liabilities,
    equity,
    result: { priorPeriodsCents: priorResult, periodCents: periodResult, totalCents: resultTotal },
    totalAssetsCents: assets.totalCents,
    totalLiabilitiesAndEquityCents,
    differenceCents: assets.totalCents - totalLiabilitiesAndEquityCents,
    isBalanced: assets.totalCents === totalLiabilitiesAndEquityCents,
  };
}

/* ── Income statement ── */

export interface IncomeStatementSection {
  /** KMU class '3'…'8', or 'other' for revenue / expense accounts outside classes 3–8. */
  code: string;
  label: string;
  revenueCents: number;
  expenseCents: number;
  /** revenueCents − expenseCents: what the class adds to the result. */
  netCents: number;
  accounts: StatementAccount[];
}

export interface IncomeStatement {
  dateFrom: string;
  dateTo: string;
  basis: 'posted_entries';
  sections: IncomeStatementSection[];
  /** Running result after classes 4, 5, 6 and 7 (KMU multi-step presentation). */
  subtotals: { key: string; label: string; afterClass: string; amountCents: number }[];
  revenue: { totalCents: number; accounts: StatementAccount[] };
  expense: { totalCents: number; accounts: StatementAccount[] };
  /** Bénéfice (> 0) ou perte (< 0) de la période. */
  netResultCents: number;
}

export function buildIncomeStatement(rows: AccountTotals[], dateFrom: string, dateTo: string): IncomeStatement {
  const sections = new Map<string, IncomeStatementSection>();
  const revenue: StatementAccount[] = [];
  const expense: StatementAccount[] = [];

  for (const r of [...rows].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, 'en', { numeric: true }))) {
    if (r.accountType !== 'revenue' && r.accountType !== 'expense') continue;
    if (r.periodDebitCents === 0 && r.periodCreditCents === 0) continue;
    const account: StatementAccount = {
      accountId: r.accountId,
      accountNumber: r.accountNumber,
      accountName: r.accountName,
      accountType: r.accountType,
      amountCents: natural(r.accountType, r.periodDebitCents, r.periodCreditCents),
    };
    (r.accountType === 'revenue' ? revenue : expense).push(account);

    const cls = kmuClass(r.accountNumber);
    const code = cls && Number(cls) >= 3 && Number(cls) <= 8 ? cls : 'other';
    let s = sections.get(code);
    if (!s) {
      s = { code, label: code === 'other' ? 'Autres produits et charges' : KMU_CLASSES[code],
        revenueCents: 0, expenseCents: 0, netCents: 0, accounts: [] };
      sections.set(code, s);
    }
    s.accounts.push(account);
    if (r.accountType === 'revenue') s.revenueCents += account.amountCents;
    else s.expenseCents += account.amountCents;
    s.netCents = s.revenueCents - s.expenseCents;
  }

  const ordered: IncomeStatementSection[] = [];
  const subtotals: IncomeStatement['subtotals'] = [];
  let running = 0;
  for (const stage of INCOME_STAGES) {
    const s = sections.get(stage.cls);
    if (s) {
      ordered.push(s);
      running += s.netCents;
    }
    if (stage.subtotal) subtotals.push({ ...stage.subtotal, afterClass: stage.cls, amountCents: running });
  }

  const totalRevenue = revenue.reduce((s, a) => s + a.amountCents, 0);
  const totalExpense = expense.reduce((s, a) => s + a.amountCents, 0);
  return {
    dateFrom,
    dateTo,
    basis: 'posted_entries',
    sections: ordered,
    subtotals,
    revenue: { totalCents: totalRevenue, accounts: revenue },
    expense: { totalCents: totalExpense, accounts: expense },
    netResultCents: totalRevenue - totalExpense,
  };
}
