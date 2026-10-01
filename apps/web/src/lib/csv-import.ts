/**
 * Reads a soumission / catalogue CSV into import rows for POST /catalogue/import.
 * Handles what Swiss exports actually look like: ';' or ',' or tab separators, quoted fields
 * (with separators, quotes or line breaks inside), UTF-8 / UTF-16 / Windows-1252 files, and
 * numbers written 1'234.50, 1 234,50, 1.234,50, 1,234.50 or "CHF 50.00".
 */

/** Row shape accepted by POST /catalogue/import (CsvRowDto). Prices in centimes. */
export interface ImportRow {
  lineNumber: number;
  rawText: string;
  npkNumber?: string;
  description?: string;
  unit?: string;
  quantity?: number;
  unitPriceCents?: number;
  totalPriceCents?: number;
  roomType?: string;
  floor?: string;
  page?: number;
  sectionCode?: string;
  isVariant?: boolean;
}

type Field = keyof Omit<ImportRow, 'lineNumber' | 'rawText'>;

/** A file the importer cannot read; `code` selects the message shown to the user. */
export class CsvImportError extends Error {
  constructor(public readonly code: 'NO_HEADER' | 'NO_ROWS') {
    super(code);
  }
}

// Header aliases (normalised: lower-case, no accents/spaces/punctuation) → import field.
const HEADER_ALIASES: Record<string, Field> = {
  npk: 'npkNumber', npknumber: 'npkNumber', nonpk: 'npkNumber', position: 'npkNumber', pos: 'npkNumber',
  numero: 'npkNumber', code: 'npkNumber', can: 'npkNumber', codecan: 'npkNumber', codecannpk: 'npkNumber',
  description: 'description', designation: 'description', libelle: 'description', texte: 'description',
  unit: 'unit', unite: 'unit', ut: 'unit', u: 'unit',
  quantity: 'quantity', quantite: 'quantity', qte: 'quantity', qty: 'quantity',
  unitprice: 'unitPriceCents', prixunitaire: 'unitPriceCents', pu: 'unitPriceCents', prix: 'unitPriceCents',
  prixunitairechf: 'unitPriceCents',
  total: 'totalPriceCents', totalprice: 'totalPriceCents', montant: 'totalPriceCents', prixtotal: 'totalPriceCents',
  prixtotalchf: 'totalPriceCents',
  room: 'roomType', roomtype: 'roomType', local: 'roomType', piece: 'roomType', typelocal: 'roomType',
  floor: 'floor', etage: 'floor', niveau: 'floor', zone: 'floor', localzone: 'floor',
  page: 'page',
  section: 'sectionCode', sectioncode: 'sectionCode', cfc: 'sectionCode', sectioncfccan: 'sectionCode',
  variante: 'isVariant', variant: 'isVariant', isvariant: 'isVariant',
};

const MAX = { npkNumber: 50, description: 1000, unit: 20, roomType: 100, floor: 50, sectionCode: 50, rawText: 5000 };

const normaliseHeader = (h: string) =>
  h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** Decodes file bytes: BOM first, then strict UTF-8, falling back to Windows-1252 (Excel on Windows). */
export function decodeCsv(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

/** Swiss / European number → number, or undefined if the cell is not a number. */
export function parseSwissNumber(v: string): number | undefined {
  let s = v.trim().replace(/^(CHF|SFr\.?|Fr\.?)\s*/i, '').replace(/['’\s  ]/g, '');
  if (!s) return undefined;
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    // Both present: the last one is the decimal separator, the other groups thousands.
    s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  } else if (comma >= 0) {
    s = s.replace(',', '.'); // "1,000" in a soumission is one unit, written with a decimal comma
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? n : undefined;
}

interface CsvRecord {
  cells: string[];
  raw: string;
  line: number;
}

/** RFC 4180 records: quoted cells may contain the delimiter, doubled quotes and line breaks. */
function readRecords(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let start = 0;
  let line = 1;
  let startLine = 1;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else if (c === undefined) { quoted = false; i--; } // unterminated quote: close at end of file
      else { if (c === '\n') line++; cell += c; }
      continue;
    }
    if (c === '"' && cell.trim() === '') { cell = ''; quoted = true; }
    else if (c === delimiter) { cells.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r' || c === undefined) {
      const end = i;
      if (c === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell);
      records.push({ cells, raw: text.slice(start, end), line: startLine });
      cells = []; cell = '';
      line++;
      start = i + 1;
      startLine = line;
    } else cell += c;
  }
  return records.filter((r) => r.cells.some((x) => x.trim()));
}

const headerFields = (cells: string[]) => cells.map((h) => HEADER_ALIASES[normaliseHeader(h)]);

/** Parses CSV text into import rows. Throws CsvImportError when no usable header is found. */
export function parseCsv(text: string): ImportRow[] {
  const body = text.replace(/^﻿/, '');
  // Pick the separator that makes the most header cells recognisable.
  let best: { delimiter: string; records: CsvRecord[]; fields: (Field | undefined)[]; known: number } | null = null;
  for (const delimiter of [';', ',', '\t']) {
    const records = readRecords(body, delimiter);
    if (!records.length) continue;
    const fields = headerFields(records[0].cells);
    const known = fields.filter(Boolean).length;
    if (!best || known > best.known) best = { delimiter, records, fields, known };
  }
  if (!best || best.known < 2 || !best.fields.some((f) => f === 'npkNumber' || f === 'description')) {
    throw new CsvImportError('NO_HEADER');
  }

  const rows: ImportRow[] = [];
  for (const rec of best.records.slice(1)) {
    const row: ImportRow = { lineNumber: rec.line, rawText: rec.raw.slice(0, MAX.rawText) };
    best.fields.forEach((field, i) => {
      const value = (rec.cells[i] ?? '').trim();
      if (!field || !value) return;
      switch (field) {
        case 'quantity': {
          const n = parseSwissNumber(value);
          if (n !== undefined) row.quantity = n;
          break;
        }
        case 'unitPriceCents':
        case 'totalPriceCents': {
          const n = parseSwissNumber(value);
          if (n !== undefined) row[field] = Math.round(n * 100);
          break;
        }
        case 'page': {
          const n = parseInt(value, 10);
          if (n > 0) row.page = n;
          break;
        }
        case 'isVariant':
          row.isVariant = /^(1|x|oui|yes|true|vrai|variante?)$/i.test(value);
          break;
        default:
          row[field] = value.slice(0, MAX[field]);
      }
    });
    if (row.npkNumber || row.description) rows.push(row);
  }
  if (!rows.length) throw new CsvImportError('NO_ROWS');
  return rows;
}
