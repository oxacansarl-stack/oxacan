/**
 * Reads a soumission PDF (Swiss CAN/NPK tender layout: Numéro · Texte · CI · Quantité · Unité ·
 * Prix unitaire · Prix total) into the same rows POST /catalogue/import takes from a CSV.
 *
 * The PDF has no table structure, only positioned text, so columns are found from the column
 * header printed at the top of each page and every text run is placed by its x position.
 * Section (231.2), location (A / PARK) and room (1.) headings are carried down to the positions
 * below them; "Total …" lines are subtotals and are skipped; a total printed in parentheses is a
 * variant ("non comptabilisée") and is imported as a negative, non-added line, like the CSV path.
 */

/** One text run as pdf.js reports it, in PDF points (origin bottom-left). */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Row shape accepted by POST /catalogue/import (CsvRowDto). Prices in centimes. */
export interface PdfImportRow {
  lineNumber: number;
  rawText: string;
  page: number;
  npkNumber?: string;
  description?: string;
  unit?: string;
  quantity?: number;
  unitPriceCents?: number;
  totalPriceCents?: number;
  sectionCode?: string;
  roomType?: string;
  floor?: string;
  isVariant?: boolean;
}

export interface ParsedSoumission {
  rows: PdfImportRow[];
  pageCount: number;
  /** Soumission number printed in the page header (e.g. "000443"). */
  reference: string | null;
  /** Issue date (YYYY-MM-DD) printed next to "Date" on the first page. */
  documentDate: string | null;
  /** The "Concerne" line of the first page. */
  projectName: string | null;
}

// Same limits as CsvRowDto, so the rows always pass the import validation.
const MAX = { npkNumber: 50, description: 1000, unit: 20, roomType: 100, floor: 50, sectionCode: 50, rawText: 5000 };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** "2 176,70", "1'234.50", "(1 251,90)" → number; undefined when the text is not an amount. */
export function parseAmount(raw: string): number | undefined {
  let s = raw.trim();
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/^\(|\)$/g, '').replace(/^-/, '').replace(/^(CHF|SFr\.?|Fr\.?)\s*/i, '').replace(/['’\s  ]/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return undefined;
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  else if (comma >= 0) s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

const toCents = (n: number | undefined) => {
  if (n === undefined) return undefined;
  const c = Math.round(n * 100);
  return Math.abs(c) <= 100_000_000_000 ? c : undefined;
};

interface Columns {
  textX: number;
  /** Left edge of the first numeric column (CI or Quantité): text starting before it is text. */
  numericX: number;
  ciX: number | null;
  qtyRight: number;
  unitX: number;
  unitPriceRight: number;
  totalRight: number;
}

interface Line {
  y: number;
  items: PdfTextItem[];
}

/** Groups runs sharing a baseline into lines, top to bottom, left to right. */
function toLines(items: PdfTextItem[]): Line[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= 2) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** The printed column header ("Numéro Texte CI Quantité Unité Prix unitaire Prix total"). */
function readHeader(line: Line): Columns | null {
  const find = (...keys: string[]) => line.items.find((i) => keys.includes(norm(i.str)));
  const text = find('texte', 'designation', 'description', 'libelle');
  const qty = find('quantite', 'qte', 'quantity');
  const unit = find('unite', 'unit', 'ut');
  const pu = find('prixunitaire', 'pu', 'unitprice', 'prixunit');
  const total = find('prixtotal', 'total', 'montant');
  if (!text || !qty || !unit || !pu || !total) return null;
  const ci = find('ci');
  return {
    textX: text.x,
    numericX: Math.min(ci?.x ?? Infinity, qty.x),
    ciX: ci?.x ?? null,
    qtyRight: qty.x + qty.width,
    unitX: unit.x,
    unitPriceRight: pu.x + pu.width,
    totalRight: total.x + total.width,
  };
}

interface Cells {
  code: string;
  text: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
  totalInParentheses: boolean;
  raw: string;
}

/** Places each run of a line in its column. */
function readCells(line: Line, c: Columns): Cells {
  const code: string[] = [];
  const text: string[] = [];
  const cells: Cells = { code: '', text: '', totalInParentheses: false, raw: '' };
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  for (const it of line.items) {
    const s = it.str.trim();
    const right = it.x + it.width;
    if (it.x < c.textX - 3) { code.push(s); continue; }
    if (it.x < c.numericX - 3) { text.push(s); continue; }
    if (/^[.\s…_]+$/.test(s)) continue; // dot leaders where prices are to be filled in
    const amount = parseAmount(s);
    if (c.ciX !== null && near(it.x, c.ciX, 6) && /^\d{1,3}$/.test(s)) continue; // CI index
    if (amount === undefined && near(it.x, c.unitX, 8) && s.length <= MAX.unit) { cells.unit = s; continue; }
    if (amount !== undefined) {
      const slots: [keyof Cells, number][] = [['quantity', c.qtyRight], ['unitPrice', c.unitPriceRight], ['total', c.totalRight]];
      const [slot, edge] = slots.reduce((best, cur) => (Math.abs(cur[1] - right) < Math.abs(best[1] - right) ? cur : best));
      if (near(right, edge, 15)) {
        (cells as any)[slot] = amount;
        if (slot === 'total') cells.totalInParentheses = /^\(.*\)$/.test(s);
        continue;
      }
    }
    text.push(s);
  }
  cells.code = squash(code.join(' '));
  cells.text = squash(text.join(' '));
  cells.raw = line.items.map((i) => i.str.trim()).join('  ');
  return cells;
}

const SECTION_CODE = /^\d{3}(\.\d{1,3})?$/; // 231.2, 232.12
const ROOM_CODE = /^\d{1,3}\.$/; // 1.
const LOCATION_CODE = /^[A-Z][A-Z0-9]{0,7}$/; // A, PARK, ASCE
const SUBTOTAL = /^(total|sous-total|report|a reporter|à reporter|transport)\b/i;
const DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

function readMeta(firstPage: Line[]) {
  let reference: string | null = null;
  let documentDate: string | null = null;
  let projectName: string | null = null;
  for (const l of firstPage) {
    l.items.forEach((it, i) => {
      const s = it.str.trim();
      const next = l.items[i + 1]?.str.trim() ?? '';
      const ref = /^Soumission\s+(\d{3,})$/i.exec(s) ?? (/^Soumission$/i.test(s) && /^\d{3,}$/.test(next) ? [s, next] : null);
      if (ref && !reference) reference = ref[1];
      if (/^date$/i.test(s) && !documentDate) {
        const m = DATE.exec(next);
        if (m) documentDate = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      }
      if (/^concerne$/i.test(s) && !projectName) {
        const rest = squash(l.items.slice(i + 1).map((x) => x.str).join(' '));
        if (rest) projectName = clip(rest, 200);
      }
    });
  }
  return { reference, documentDate, projectName };
}

/** Pages of positioned text → import rows and document metadata. */
export function parseSoumission(pages: PdfTextItem[][]): ParsedSoumission {
  const rows: PdfImportRow[] = [];
  let columns: Columns | null = null;
  let lineNumber = 0;
  let sectionCode: string | undefined;
  let floor: string | undefined;
  let roomType: string | undefined;
  let variantSection = false;

  // The position being read, its description lines and the y of its last line.
  let open: { row: PdfImportRow; text: string[]; raw: string[]; lastY: number; lineGap: number } | null = null;
  const close = () => {
    if (!open) return;
    const description = squash(open.text.join(' '));
    if (description) open.row.description = clip(description, MAX.description);
    open.row.rawText = clip(open.raw.join('\n'), MAX.rawText);
    rows.push(open.row);
    open = null;
  };

  const pageLines = pages.map(toLines);
  pageLines.forEach((lines, p) => {
    const headerAt = lines.findIndex((l) => readHeader(l) !== null);
    if (headerAt >= 0) columns = readHeader(lines[headerAt]);
    lineNumber += headerAt + 1; // page header lines are counted, not read
    if (!columns) {
      lineNumber += lines.length - headerAt - 1;
      return;
    }
    const cols: Columns = columns;
    for (const line of lines.slice(headerAt + 1)) {
      lineNumber++;
      const cells = readCells(line, cols);
      const isPosition = cells.quantity !== undefined && cells.unit !== undefined;

      if (isPosition) {
        close();
        const total = cells.total;
        const variant = cells.totalInParentheses || variantSection;
        const lineHeight = Math.max(...line.items.map((i) => i.height || 0), 8);
        open = {
          row: {
            lineNumber,
            rawText: '',
            page: p + 1,
            npkNumber: cells.code ? clip(cells.code, MAX.npkNumber) : undefined,
            unit: clip(cells.unit!, MAX.unit),
            quantity: cells.quantity,
            unitPriceCents: toCents(cells.unitPrice),
            // A variant total is never part of the base sum: kept negative, like the CSV exports.
            totalPriceCents: toCents(total === undefined ? undefined : variant ? -Math.abs(total) : total),
            sectionCode: sectionCode ? clip(sectionCode, MAX.sectionCode) : undefined,
            roomType,
            floor,
            isVariant: variant,
          },
          text: cells.text ? [cells.text] : [],
          raw: [cells.raw],
          lastY: line.y,
          lineGap: lineHeight * 1.6,
        };
        continue;
      }

      if (SUBTOTAL.test(cells.text)) { close(); continue; }

      if (cells.code) {
        // A heading: section, location or room. It ends the position above it.
        close();
        if (SECTION_CODE.test(cells.code)) {
          sectionCode = cells.code;
          variantSection = /variante/i.test(cells.text);
        } else if (ROOM_CODE.test(cells.code)) {
          roomType = cells.text ? clip(cells.text, MAX.roomType) : undefined;
        } else if (LOCATION_CODE.test(cells.code)) {
          floor = clip(cells.text ? `${cells.code} - ${cells.text}` : cells.code, MAX.floor);
          roomType = undefined;
        }
        continue;
      }

      // Text only: the next line of the open position's description, or free text under a heading.
      const pos = open as { lastY: number; lineGap: number; text: string[]; raw: string[] } | null;
      if (pos && cells.text && pos.lastY - line.y <= pos.lineGap) {
        pos.text.push(cells.text);
        pos.raw.push(cells.raw);
        pos.lastY = line.y;
        continue;
      }
      close();
      if (/variante\s+non[\s-]*comptabilis/i.test(cells.text)) variantSection = true;
    }
    close(); // positions do not run across pages
  });
  close();

  return { rows, pageCount: pages.length, ...readMeta(pageLines[0] ?? []) };
}
