import { ValidationError } from '@oxacan/shared-types';

type Db = { query: (sql: string, params?: unknown[]) => Promise<any> };

/* ─── Advisory locks ─── */

/*
 * Transaction advisory locks keyed by a 64-bit hash of a namespaced company id, so two companies
 * (or the invoice numbering and the journal of one company) never share a key. The previous keys
 * were the first 8 hex digits of the company UUID (and that + 1 for the journal), which collide
 * between companies whose ids share a prefix, and between one company's journal and the next
 * prefix's invoices.
 */

/** Serialises invoice numbering (and everything created under it) for one company. */
export const INVOICE_NUMBER_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('invoice:' || $1::text, 0))";
/** Serialises journal entry numbering for one company; shared with AccountingService.createEntry. */
export const JOURNAL_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtextextended('journal:' || $1::text, 0))";

export async function lockInvoiceNumbering(db: Db, companyId: string): Promise<void> {
  await db.query(INVOICE_NUMBER_LOCK_SQL, [companyId]);
}

export async function lockJournal(db: Db, companyId: string): Promise<void> {
  await db.query(JOURNAL_LOCK_SQL, [companyId]);
}

/* ─── Invoice number format (PRD §15.1 "Format configurable par entreprise") ─── */

/** The format every invoice number had before formats were configurable: 2026-001, 2026-002, … */
export const DEFAULT_INVOICE_NUMBER_FORMAT = '{YYYY}-{NNN}';
export const INVOICE_NUMBER_FORMAT_MAX_LENGTH = 40;

type FormatPart = { literal: string } | { year: 2 | 4 } | { sequence: number };

const TOKEN = /\{(YYYY|YY|N{1,9})\}/g;
const LITERAL = /^[A-Za-z0-9 ._/-]*$/;

/**
 * Parses a format such as 'F-{YYYY}-{NNNN}': literal text (letters, digits, space . _ / -), exactly
 * one sequence token {N…} whose length is the zero padding (the sequence is never truncated), and
 * at most one year token {YYYY} or {YY}. With a year token the sequence restarts every year;
 * without one it never restarts. Same rules as the company_invoice_number_format_check constraint.
 */
export function parseInvoiceNumberFormat(format: string): FormatPart[] {
  if (typeof format !== 'string' || !format.length || format.length > INVOICE_NUMBER_FORMAT_MAX_LENGTH) {
    throw new ValidationError(`The invoice number format must be 1 to ${INVOICE_NUMBER_FORMAT_MAX_LENGTH} characters.`);
  }
  const parts: FormatPart[] = [];
  let last = 0;
  for (const m of format.matchAll(TOKEN)) {
    if (m.index! > last) parts.push({ literal: format.slice(last, m.index) });
    const token = m[1];
    parts.push(token === 'YYYY' ? { year: 4 } : token === 'YY' ? { year: 2 } : { sequence: token.length });
    last = m.index! + m[0].length;
  }
  if (last < format.length) parts.push({ literal: format.slice(last) });

  for (const p of parts) {
    if ('literal' in p && !LITERAL.test(p.literal)) {
      throw new ValidationError(
        'The invoice number format may only contain letters, digits, spaces, . _ / - and the tokens {YYYY}, {YY} and {NNN}.',
      );
    }
  }
  if (parts.filter((p) => 'sequence' in p).length !== 1) {
    throw new ValidationError('The invoice number format needs exactly one sequence token, e.g. {NNN}.');
  }
  if (parts.filter((p) => 'year' in p).length > 1) {
    throw new ValidationError('The invoice number format may contain at most one year token ({YYYY} or {YY}).');
  }
  return parts;
}

function yearText(width: 2 | 4, year: number): string {
  return width === 4 ? String(year) : String(year % 100).padStart(2, '0');
}

export function renderInvoiceNumber(parts: FormatPart[], year: number, sequence: number): string {
  return parts
    .map((p) => ('literal' in p ? p.literal : 'year' in p ? yearText(p.year, year) : String(sequence).padStart(p.sequence, '0')))
    .join('');
}

/**
 * POSIX regex matching the numbers of one series (the format, for that year if it has a year
 * token); its single capture group is the sequence. Every non-alphanumeric literal is escaped.
 */
export function invoiceNumberSeriesRegex(parts: FormatPart[], year: number): string {
  const escape = (s: string) => s.replace(/[^A-Za-z0-9]/g, (c) => `\\${c}`);
  return `^${parts
    .map((p) => ('literal' in p ? escape(p.literal) : 'year' in p ? yearText(p.year, year) : '([0-9]{1,15})'))
    .join('')}$`;
}

export async function invoiceNumberFormat(db: Db, companyId: string): Promise<string> {
  const [row] = await db.query('SELECT invoice_number_format AS format FROM company WHERE id = $1', [companyId]);
  return row?.format || DEFAULT_INVOICE_NUMBER_FORMAT;
}

/**
 * Next gapless number of the company's current series: the highest sequence among the existing
 * numbers that match the format (for this year if it has a year token), plus one. Existing numbers
 * stay valid: the default format matches every number issued before formats were configurable,
 * and switching back to an earlier format continues its series. Changing the format starts the
 * new format's series at 1 (unless numbers matching it already exist).
 * The caller must hold the company's invoice numbering lock (lockInvoiceNumbering) unless it only
 * previews the number.
 */
export async function nextInvoiceNumber(db: Db, companyId: string, now = new Date()): Promise<string> {
  const parts = parseInvoiceNumberFormat(await invoiceNumberFormat(db, companyId));
  const year = now.getFullYear();
  const regex = invoiceNumberSeriesRegex(parts, year);
  const [{ max }] = await db.query(
    `SELECT MAX(substring(invoice_number from $2)::bigint) AS max
       FROM invoice WHERE company_id = $1 AND invoice_number ~ $2`,
    [companyId, regex],
  );
  return renderInvoiceNumber(parts, year, Number(max ?? 0) + 1);
}
