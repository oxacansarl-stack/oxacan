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

/** The horizontal span of one printed column heading. */
interface Label {
  x: number;
  right: number;
}

interface Columns {
  numero: Label | null;
  texte: Label;
  ci: Label | null;
  qty: Label;
  unit: Label;
  unitPrice: Label;
  total: Label;
  /** Left of this nothing is read as a figure, so "20" in a description stays description. */
  numericFloor: number;
}

/** Distance from a point to a column heading's span; 0 when the point sits under it. */
const distance = (l: Label, p: number) => (p < l.x ? l.x - p : p > l.right ? p - l.right : 0);

/** The heading nearest a point, out of the ones given. */
function nearest<K extends string>(point: number, labels: [K, Label | null][]): K | null {
  let best: K | null = null;
  let bestDistance = Infinity;
  for (const [key, label] of labels) {
    if (!label) continue;
    const d = distance(label, point);
    if (d < bestDistance) {
      bestDistance = d;
      best = key;
    }
  }
  return best;
}

/**
 * How far a figure may sit from its own heading before the line is given up on. Generous on
 * purpose: a heading printed at the left of a column of right-aligned figures is several
 * centimetres from them, and the alternative to a slightly wrong column is no position at all.
 */
const NUMERIC_SLACK = 24;

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

/**
 * The printed column header, in any of the three languages a Swiss soumission is issued in
 * ("Numéro Texte CI Quantité Unité Prix unitaire Prix total" and its German and Italian
 * equivalents). Only the headings are matched by wording; where the columns actually sit is read
 * off the page, because a heading may be printed left or right over its figures.
 */
function readHeader(line: Line): Columns | null {
  const find = (...keys: string[]) => {
    const it = line.items.find((i) => keys.includes(norm(i.str)));
    return it ? { x: it.x, right: it.x + it.width } : null;
  };
  const texte = find('texte', 'designation', 'description', 'libelle', 'text', 'bezeichnung', 'descrizione', 'designazione');
  const qty = find('quantite', 'qte', 'quantity', 'menge', 'anzahl', 'quantita', 'qta');
  const unit = find('unite', 'unit', 'ut', 'einheit', 'eh', 'unita', 'um');
  const unitPrice = find('prixunitaire', 'pu', 'unitprice', 'prixunit', 'einheitspreis', 'ehpreis', 'prezzounitario', 'prezzounit');
  const total = find('prixtotal', 'total', 'montant', 'gesamtpreis', 'gesamtbetrag', 'betrag', 'importo', 'totale');
  if (!texte || !qty || !unit || !unitPrice || !total) return null;
  return {
    numero: find('numero', 'nummer', 'n', 'no', 'pos', 'position', 'npk', 'can', 'code', 'artikel'),
    texte,
    ci: find('ci'),
    qty,
    unit,
    unitPrice,
    total,
    numericFloor: Math.min(ci0(find('ci')), qty.x) - NUMERIC_SLACK,
  };
}

const ci0 = (l: Label | null) => l?.x ?? Infinity;

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

/**
 * Places each run of a line in its column.
 *
 * Figures are right-aligned in their column and text is left-aligned, so a figure is placed by
 * where it ends and text by where it starts — each joining the column whose heading is nearest.
 * Measuring against the heading's span rather than one of its edges is what lets the same code
 * read a sheet whose headings are printed left of their figures and one whose are right-aligned
 * over them; both are ordinary, and keying off a single edge silently loses every figure on the
 * layout it was not written for.
 */
function readCells(line: Line, c: Columns): Cells {
  const code: string[] = [];
  const text: string[] = [];
  const cells: Cells = { code: '', text: '', totalInParentheses: false, raw: '' };
  for (const it of line.items) {
    const s = it.str.trim();
    const right = it.x + it.width;
    if (/^[.\s…_]+$/.test(s)) continue; // dot leaders where prices are to be filled in

    // The CI index is a bare one-to-three-digit number under its own heading, not a quantity.
    if (c.ci && /^\d{1,3}$/.test(s) && distance(c.ci, it.x) === 0) continue;

    const amount = parseAmount(s);
    if (amount !== undefined && right >= c.numericFloor) {
      const slot = nearest<'quantity' | 'unitPrice' | 'total'>(right, [
        ['quantity', c.qty],
        ['unitPrice', c.unitPrice],
        ['total', c.total],
      ]);
      if (slot === 'quantity') { cells.quantity = amount; continue; }
      if (slot === 'unitPrice') { cells.unitPrice = amount; continue; }
      if (slot === 'total') {
        cells.total = amount;
        cells.totalInParentheses = /^\(.*\)$/.test(s);
        continue;
      }
    }

    // Not a figure: the number, the description or the unit, whichever heading it starts under.
    const column = c.numero
      ? nearest(it.x, [['numero', c.numero], ['texte', c.texte], ['unit', c.unit]])
      : it.x < c.texte.x - 3
        ? 'numero'
        : nearest(it.x, [['texte', c.texte], ['unit', c.unit]]);
    if (column === 'numero') code.push(s);
    else if (column === 'unit' && amount === undefined && s.length <= MAX.unit && distance(c.unit, it.x) <= 10) cells.unit = s;
    else text.push(s);
  }
  cells.code = squash(code.join(' '));
  cells.text = squash(text.join(' '));
  cells.raw = line.items.map((i) => i.str.trim()).join('  ');
  return cells;
}

const SECTION_CODE = /^\d{3}(\.\d{1,3})?$/; // 231.2, 232.12
const ROOM_CODE = /^\d{1,3}\.$/; // 1.
const LOCATION_CODE = /^[A-Z][A-Z0-9]{0,7}$/; // A, PARK, ASCE
const SUBTOTAL =
  /^(total|sous-total|report|a reporter|à reporter|transport|zwischentotal|zwischensumme|summe|übertrag|ubertrag|totale|riporto)\b/i;
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
          lineGap: Math.max(lineHeight * 2.4, 15),
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
