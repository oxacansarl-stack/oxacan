/**
 * Bank statement parsing for the reconciliation (PRD §16.2 "Rapprochement"). Pure functions.
 *
 * - camt.053 (ISO 20022 BankToCustomerStatement, the Swiss banks' standard since the SIX migration),
 *   read with a minimal non-validating XML parser: no DTD, no external or custom entities, so XXE
 *   and entity expansion are impossible. A document with <!DOCTYPE or <!ENTITY is rejected outright.
 * - CSV exports with a header row (';', ',' or tab separated), columns recognised by name in
 *   French, German or English.
 *
 * Amounts become signed centimes (credit > 0, debit < 0) without floating point.
 */

export class StatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatementParseError';
  }
}

export type StatementFormat = 'csv' | 'camt053';

export interface ParsedStatementLine {
  bookingDate: string;
  valueDate: string | null;
  /** Signed: incoming (credit) > 0, outgoing (debit) < 0. */
  amountCents: number;
  currency: string | null;
  /** Structured creditor reference (QR reference or RF creditor reference), whitespace removed. */
  reference: string | null;
  /** Unstructured remittance / booking text. */
  remittanceInfo: string | null;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  /** The bank's own reference of the booking (camt AcctSvcrRef), when there is one. */
  bankReference: string | null;
}

export interface ParsedStatement {
  format: StatementFormat;
  statementRef: string | null;
  iban: string | null;
  currency: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  lines: ParsedStatementLine[];
  /** camt entries not booked yet (status PDNG / INFO), left out of `lines`. */
  skippedEntries: number;
}

export const MAX_STATEMENT_LINES = 10_000;
const MAX_TEXT = 1000;

/* ═══════════════════════════════════════════════
   Shared helpers
   ═══════════════════════════════════════════════ */

/** Removes whitespace and upper-cases a payment reference; empty → null. */
export function normalizeReference(value: string | null | undefined): string | null {
  const v = (value ?? '').replace(/\s+/g, '').toUpperCase();
  return v ? v : null;
}

function clean(value: string | null | undefined, max = MAX_TEXT): string | null {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : null;
}

function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** YYYY-MM-DD, DD.MM.YYYY, DD.MM.YY, DD/MM/YYYY or an ISO timestamp → YYYY-MM-DD; null if invalid. */
export function parseStatementDate(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  let iso: string | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(v))) iso = `${m[1]}-${m[2]}-${m[3]}`;
  else if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})$/.exec(v))) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    iso = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return iso && isCalendarDate(iso) ? iso : null;
}

/**
 * Decimal amount → centimes, exactly. Accepts "1234.5", "1'234.50", "1 234,50", "-12.30",
 * "12.30-", "+5", "CHF 10.00". Rejects more than two significant decimals.
 */
export function parseAmountToCents(value: string): number {
  let v = value.replace(/[\s  '’]/g, '').replace(/^CHF|CHF$/i, '');
  let negative = false;
  if (/^[-+]/.test(v)) {
    negative = v[0] === '-';
    v = v.slice(1);
  } else if (/-$/.test(v)) {
    negative = true;
    v = v.slice(0, -1);
  }
  const lastDot = v.lastIndexOf('.');
  const lastComma = v.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the last one is the decimal separator, the other groups thousands.
    v = lastDot > lastComma ? v.replace(/,/g, '') : v.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    v = /^\d+,\d{1,2}$/.test(v) ? v.replace(',', '.') : v.replace(/,/g, '');
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) throw new StatementParseError(`Invalid amount "${value}"`);
  const frac = (m[2] ?? '').replace(/0+$/, '');
  if (frac.length > 2) throw new StatementParseError(`Amount "${value}" has more than two decimals`);
  const cents = Number(m[1]) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_000) {
    throw new StatementParseError(`Amount "${value}" is out of range`);
  }
  return negative ? -cents : cents;
}

export function detectFormat(content: string): StatementFormat {
  return /^\s*</.test(content.replace(/^﻿/, '')) ? 'camt053' : 'csv';
}

export function parseBankStatement(content: string, format?: StatementFormat): ParsedStatement {
  const fmt = format ?? detectFormat(content);
  const parsed = fmt === 'camt053' ? parseCamt053(content) : parseCsvStatement(content);
  if (parsed.lines.length > MAX_STATEMENT_LINES) {
    throw new StatementParseError(`A statement may hold at most ${MAX_STATEMENT_LINES} lines`);
  }
  return parsed;
}

/* ═══════════════════════════════════════════════
   Minimal safe XML parser
   ═══════════════════════════════════════════════ */

export interface XmlElement {
  /** Local name (namespace prefix removed). */
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const MAX_XML_DEPTH = 64;
const MAX_XML_ELEMENTS = 500_000;
const PREDEFINED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(raw: string): string {
  return raw.replace(/&([^;&\s]{0,12});|&/g, (match, ref: string | undefined) => {
    if (ref === undefined) throw new StatementParseError('Malformed XML: bare "&"');
    if (ref in PREDEFINED_ENTITIES) return PREDEFINED_ENTITIES[ref];
    const num = /^#x([0-9a-fA-F]{1,6})$/.exec(ref) ?? /^#(\d{1,7})$/.exec(ref);
    if (num) {
      const code = parseInt(num[1], ref[1] === 'x' ? 16 : 10);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        throw new StatementParseError(`Malformed XML: invalid character reference ${match}`);
      }
      return String.fromCodePoint(code);
    }
    throw new StatementParseError(`XML entity ${match} is not allowed`);
  });
}

/**
 * Parses a well-formed XML document into an element tree. Comments, processing instructions and
 * CDATA are handled; any DOCTYPE / ENTITY / other <! declaration is refused, and only the five
 * predefined entities and numeric character references are decoded.
 */
export function parseXml(input: string): XmlElement {
  if (/<!DOCTYPE/i.test(input) || /<!ENTITY/i.test(input)) {
    throw new StatementParseError('XML with a DOCTYPE or entity declarations is not accepted');
  }
  const s = input.replace(/^﻿/, '');
  const stack: { el: XmlElement; qname: string }[] = [];
  let root: XmlElement | null = null;
  let count = 0;
  let i = 0;

  const addText = (raw: string, decode: boolean) => {
    const top = stack[stack.length - 1];
    if (!top) {
      if (raw.trim()) throw new StatementParseError('Malformed XML: text outside the root element');
      return;
    }
    top.el.text += decode ? decodeEntities(raw) : raw;
  };

  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt === -1) {
      addText(s.slice(i), true);
      break;
    }
    if (lt > i) addText(s.slice(i, lt), true);

    if (s.startsWith('<!--', lt)) {
      const end = s.indexOf('-->', lt + 4);
      if (end < 0) throw new StatementParseError('Malformed XML: unterminated comment');
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const end = s.indexOf(']]>', lt + 9);
      if (end < 0) throw new StatementParseError('Malformed XML: unterminated CDATA section');
      addText(s.slice(lt + 9, end), false);
      i = end + 3;
      continue;
    }
    if (s.startsWith('<?', lt)) {
      const end = s.indexOf('?>', lt + 2);
      if (end < 0) throw new StatementParseError('Malformed XML: unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (s.startsWith('<!', lt)) throw new StatementParseError('XML markup declarations are not accepted');

    if (s.startsWith('</', lt)) {
      const end = s.indexOf('>', lt);
      if (end < 0) throw new StatementParseError('Malformed XML: unterminated end tag');
      const qname = s.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top.qname !== qname) throw new StatementParseError(`Malformed XML: unexpected </${qname.slice(0, 50)}>`);
      i = end + 1;
      continue;
    }

    // Start tag: find the closing '>' outside attribute quotes.
    let j = lt + 1;
    let quote: string | null = null;
    for (; j < s.length; j++) {
      const c = s[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
      else if (c === '<') throw new StatementParseError('Malformed XML: "<" inside a tag');
    }
    if (j >= s.length) throw new StatementParseError('Malformed XML: unterminated start tag');
    let body = s.slice(lt + 1, j);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    const nameMatch = /^([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?=\s|$)/.exec(body);
    if (!nameMatch) throw new StatementParseError('Malformed XML: invalid element name');
    const qname = nameMatch[1];
    const attrs: Record<string, string> = {};
    const rest = body.slice(qname.length);
    const attrRe = /\s*([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
    let pos = 0;
    while (pos < rest.length) {
      if (/^\s*$/.test(rest.slice(pos))) break;
      attrRe.lastIndex = pos;
      const m = attrRe.exec(rest);
      if (!m) throw new StatementParseError(`Malformed XML: invalid attributes on <${qname}>`);
      const local = m[1].includes(':') ? m[1].slice(m[1].indexOf(':') + 1) : m[1];
      attrs[local] = decodeEntities(m[2] ?? m[3] ?? '');
      pos = attrRe.lastIndex;
    }

    const el: XmlElement = { name: qname.includes(':') ? qname.slice(qname.indexOf(':') + 1) : qname, attrs, children: [], text: '' };
    if (++count > MAX_XML_ELEMENTS) throw new StatementParseError('XML document is too large');
    const parent = stack[stack.length - 1];
    if (parent) parent.el.children.push(el);
    else if (root) throw new StatementParseError('Malformed XML: more than one root element');
    else root = el;
    if (!selfClosing) {
      stack.push({ el, qname });
      if (stack.length > MAX_XML_DEPTH) throw new StatementParseError('XML document is nested too deeply');
    }
    i = j + 1;
  }

  if (stack.length) throw new StatementParseError(`Malformed XML: <${stack[stack.length - 1].qname}> is not closed`);
  if (!root) throw new StatementParseError('Empty XML document');
  return root;
}

/** First descendant following the path of local names. */
export function xmlChild(el: XmlElement | null | undefined, ...path: string[]): XmlElement | null {
  let cur: XmlElement | null | undefined = el;
  for (const name of path) {
    cur = cur?.children.find((c) => c.name === name);
    if (!cur) return null;
  }
  return cur ?? null;
}

export function xmlChildren(el: XmlElement | null | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((c) => c.name === name) : [];
}

export function xmlText(el: XmlElement | null | undefined, ...path: string[]): string | null {
  const t = xmlChild(el, ...path)?.text.trim();
  return t ? t : null;
}

/* ═══════════════════════════════════════════════
   camt.053
   ═══════════════════════════════════════════════ */

function camtDate(el: XmlElement | null): string | null {
  const raw = xmlText(el, 'Dt') ?? xmlText(el, 'DtTm');
  if (!raw) return null;
  const d = parseStatementDate(raw.slice(0, 10));
  if (!d) throw new StatementParseError(`Invalid camt.053 date "${raw.slice(0, 30)}"`);
  return d;
}

function camtSign(indicator: string | null, where: string): 1 | -1 {
  if (indicator === 'CRDT') return 1;
  if (indicator === 'DBIT') return -1;
  throw new StatementParseError(`camt.053 ${where}: CdtDbtInd must be CRDT or DBIT`);
}

function camtParty(tx: XmlElement | null, role: 'Dbtr' | 'Cdtr') {
  const parties = xmlChild(tx, 'RltdPties');
  const name = xmlText(parties, role, 'Nm') ?? xmlText(parties, role, 'Pty', 'Nm');
  const iban = xmlText(parties, `${role}Acct`, 'Id', 'IBAN');
  return { name: clean(name, 200), iban: normalizeReference(iban) };
}

function camtRemittance(tx: XmlElement | null) {
  const rmt = xmlChild(tx, 'RmtInf');
  let reference: string | null = null;
  for (const strd of xmlChildren(rmt, 'Strd')) {
    reference = normalizeReference(xmlText(strd, 'CdtrRefInf', 'Ref'));
    if (reference) break;
  }
  const ustrd = xmlChildren(rmt, 'Ustrd').map((u) => u.text.trim()).filter(Boolean);
  return { reference, text: ustrd.join(' ') };
}

export function parseCamt053(xml: string): ParsedStatement {
  const doc = parseXml(xml);
  const bk = doc.name === 'Document' ? xmlChild(doc, 'BkToCstmrStmt') : null;
  if (!bk) throw new StatementParseError('Not a camt.053 document (Document/BkToCstmrStmt expected)');
  const statements = xmlChildren(bk, 'Stmt');
  if (!statements.length) throw new StatementParseError('camt.053 document without a statement (Stmt)');

  const result: ParsedStatement = {
    format: 'camt053',
    statementRef: clean(xmlText(statements[0], 'Id'), 200),
    iban: normalizeReference(xmlText(statements[0], 'Acct', 'Id', 'IBAN')),
    currency: xmlText(statements[0], 'Acct', 'Ccy'),
    periodFrom: null,
    periodTo: null,
    openingBalanceCents: null,
    closingBalanceCents: null,
    lines: [],
    skippedEntries: 0,
  };

  statements.forEach((stmt, sIdx) => {
    const from = xmlText(stmt, 'FrToDt', 'FrDtTm');
    const to = xmlText(stmt, 'FrToDt', 'ToDtTm');
    if (from && (!result.periodFrom || from.slice(0, 10) < result.periodFrom)) result.periodFrom = parseStatementDate(from.slice(0, 10));
    if (to && (!result.periodTo || to.slice(0, 10) > result.periodTo)) result.periodTo = parseStatementDate(to.slice(0, 10));

    for (const bal of xmlChildren(stmt, 'Bal')) {
      const code = xmlText(bal, 'Tp', 'CdOrPrtry', 'Cd');
      const amt = xmlText(bal, 'Amt');
      if (!amt) continue;
      const cents = parseAmountToCents(amt) * camtSign(xmlText(bal, 'CdtDbtInd'), 'balance');
      if ((code === 'OPBD' || code === 'PRCD') && sIdx === 0 && result.openingBalanceCents === null) result.openingBalanceCents = cents;
      if (code === 'CLBD' && sIdx === statements.length - 1) result.closingBalanceCents = cents;
    }

    for (const ntry of xmlChildren(stmt, 'Ntry')) {
      const status = xmlText(ntry, 'Sts', 'Cd') ?? xmlText(ntry, 'Sts');
      if (status && status !== 'BOOK') {
        result.skippedEntries++;
        continue;
      }
      const amountEl = xmlChild(ntry, 'Amt');
      if (!amountEl?.text.trim()) throw new StatementParseError('camt.053 entry without an amount');
      const entrySign = camtSign(xmlText(ntry, 'CdtDbtInd'), 'entry');
      const bookingDate = camtDate(xmlChild(ntry, 'BookgDt')) ?? camtDate(xmlChild(ntry, 'ValDt'));
      if (!bookingDate) throw new StatementParseError('camt.053 entry without a booking date');
      const valueDate = camtDate(xmlChild(ntry, 'ValDt'));
      const entryRef = clean(xmlText(ntry, 'AcctSvcrRef'), 200);
      const entryInfo = xmlText(ntry, 'AddtlNtryInf');
      const currency = amountEl.attrs.Ccy ?? result.currency;
      const txs = xmlChildren(ntry, 'NtryDtls').flatMap((d) => xmlChildren(d, 'TxDtls'));

      const lineFor = (tx: XmlElement | null, amountCents: number, bankReference: string | null): ParsedStatementLine => {
        const { reference, text } = camtRemittance(tx);
        const party = camtParty(tx, amountCents > 0 ? 'Dbtr' : 'Cdtr');
        return {
          bookingDate,
          valueDate,
          amountCents,
          currency,
          reference,
          remittanceInfo: clean([text, xmlText(tx, 'AddtlTxInf'), entryInfo].filter(Boolean).join(' | ')),
          counterpartyName: party.name,
          counterpartyIban: party.iban,
          bankReference,
        };
      };

      if (txs.length <= 1) {
        const cents = parseAmountToCents(amountEl.text) * entrySign;
        if (cents !== 0) result.lines.push(lineFor(txs[0] ?? null, cents, entryRef ?? clean(xmlText(txs[0], 'Refs', 'AcctSvcrRef'), 200)));
        continue;
      }
      // Collective booking (e.g. a batch of QR payments): one line per transaction.
      txs.forEach((tx, k) => {
        const amt = xmlText(tx, 'Amt') ?? xmlText(tx, 'AmtDtls', 'TxAmt', 'Amt');
        if (!amt) throw new StatementParseError('camt.053 batch transaction without an amount');
        const txSign = xmlText(tx, 'CdtDbtInd') ? camtSign(xmlText(tx, 'CdtDbtInd'), 'transaction') : entrySign;
        const cents = parseAmountToCents(amt) * txSign;
        const txRef = clean(xmlText(tx, 'Refs', 'AcctSvcrRef'), 200) ?? (entryRef ? `${entryRef}/${k + 1}` : null);
        if (cents !== 0) result.lines.push(lineFor(tx, cents, txRef));
      });
    }
  });

  return result;
}

/* ═══════════════════════════════════════════════
   CSV
   ═══════════════════════════════════════════════ */

type CsvField = 'date' | 'valueDate' | 'amount' | 'credit' | 'debit' | 'reference' | 'text' | 'counterparty' | 'iban' | 'currency' | 'bankReference';

/** Normalised header (lower case, accents and punctuation removed) → field. */
const CSV_HEADERS: Record<CsvField, string[]> = {
  date: ['date', 'booking date', 'date comptable', 'date de comptabilisation', 'date de transaction', 'date operation',
    'date d operation', 'transaction date', 'buchungsdatum', 'datum', 'abschlussdatum'],
  valueDate: ['value date', 'valuta', 'valutadatum', 'valuta datum', 'date valeur', 'date de valeur'],
  amount: ['amount', 'amount chf', 'montant', 'montant chf', 'betrag', 'betrag chf', 'transaction amount'],
  credit: ['credit', 'credit chf', 'credit amount', 'gutschrift', 'gutschrift chf', 'gutschrift in chf', 'entree', 'entrees'],
  debit: ['debit', 'debit chf', 'debit amount', 'belastung', 'belastung chf', 'belastung in chf', 'lastschrift', 'sortie', 'sorties'],
  reference: ['reference', 'qr reference', 'reference qr', 'payment reference', 'creditor reference', 'reference number',
    'referenz', 'qr referenz', 'referenznummer', 'zahlungsreferenz', 'esr referenz', 'bvr reference', 'no de reference',
    'numero de reference', 'reference de paiement'],
  text: ['description', 'libelle', 'text', 'texte', 'buchungstext', 'communication', 'details', 'avis', 'mitteilung',
    'motif', 'purpose', 'verwendungszweck', 'remittance information', 'informations'],
  counterparty: ['counterparty', 'counterparty name', 'contrepartie', 'nom', 'name', 'auftraggeber', 'begunstigter',
    'debtor', 'payer', 'donneur d ordre', 'emetteur'],
  iban: ['iban', 'counterparty iban', 'iban contrepartie', 'iban auftraggeber', 'iban du donneur d ordre'],
  currency: ['currency', 'devise', 'wahrung', 'monnaie', 'ccy'],
  bankReference: ['bank reference', 'transaction id', 'transaktions id', 'transaktionsnummer', 'reference banque', 'reference bancaire'],
};

function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function splitCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new StatementParseError('Malformed CSV: unterminated quoted field');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function detectSeparator(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 30).join('\n');
  const count = (sep: string) => firstLines.split(sep).length - 1;
  return [';', '\t', ','].reduce((best, sep) => (count(sep) > count(best) ? sep : best), ';');
}

export function parseCsvStatement(content: string): ParsedStatement {
  const text = content.replace(/^﻿/, '');
  const rows = splitCsv(text, detectSeparator(text));

  // The header is the first row (within the first 30, after any preamble) naming a date and an amount.
  let headerIdx = -1;
  let columns: Partial<Record<CsvField, number>> = {};
  for (let r = 0; r < Math.min(rows.length, 30) && headerIdx < 0; r++) {
    const map: Partial<Record<CsvField, number>> = {};
    rows[r].forEach((cell, idx) => {
      const h = normalizeHeader(cell);
      for (const [field, names] of Object.entries(CSV_HEADERS) as [CsvField, string[]][]) {
        if (map[field] === undefined && names.includes(h)) {
          map[field] = idx;
          break;
        }
      }
    });
    if (map.date !== undefined && (map.amount !== undefined || map.credit !== undefined || map.debit !== undefined)) {
      headerIdx = r;
      columns = map;
    }
  }
  if (headerIdx < 0) {
    throw new StatementParseError('CSV statement: no header row with a date column and an amount (or credit/debit) column');
  }

  const cell = (row: string[], field: CsvField) => {
    const idx = columns[field];
    return idx === undefined ? '' : (row[idx] ?? '').trim();
  };

  const lines: ParsedStatementLine[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => c.trim() === '')) continue;
    const rawDate = cell(row, 'date');
    const rawAmount = cell(row, 'amount');
    const rawCredit = cell(row, 'credit');
    const rawDebit = cell(row, 'debit');
    // Rows without a date (totals, footers) are not transactions.
    if (!rawDate) continue;
    const bookingDate = parseStatementDate(rawDate);
    if (!bookingDate) throw new StatementParseError(`CSV row ${r + 1}: invalid date "${rawDate.slice(0, 30)}"`);
    let amountCents: number;
    try {
      if (rawAmount) amountCents = parseAmountToCents(rawAmount);
      else if (rawCredit || rawDebit) {
        amountCents = (rawCredit ? Math.abs(parseAmountToCents(rawCredit)) : 0) - (rawDebit ? Math.abs(parseAmountToCents(rawDebit)) : 0);
      } else continue;
    } catch (e) {
      throw new StatementParseError(`CSV row ${r + 1}: ${(e as Error).message}`);
    }
    if (amountCents === 0) continue;
    const rawValueDate = cell(row, 'valueDate');
    lines.push({
      bookingDate,
      valueDate: rawValueDate ? parseStatementDate(rawValueDate) : null,
      amountCents,
      currency: clean(cell(row, 'currency'), 3)?.toUpperCase() ?? null,
      reference: normalizeReference(cell(row, 'reference')),
      remittanceInfo: clean(cell(row, 'text')),
      counterpartyName: clean(cell(row, 'counterparty'), 200),
      counterpartyIban: normalizeReference(cell(row, 'iban')),
      bankReference: clean(cell(row, 'bankReference'), 200),
    });
    if (lines.length > MAX_STATEMENT_LINES) break;
  }

  const dates = lines.map((l) => l.bookingDate).sort();
  return {
    format: 'csv',
    statementRef: null,
    iban: null,
    currency: null,
    periodFrom: dates[0] ?? null,
    periodTo: dates[dates.length - 1] ?? null,
    openingBalanceCents: null,
    closingBalanceCents: null,
    lines,
    skippedEntries: 0,
  };
}
