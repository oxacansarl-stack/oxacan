/**
 * Builds soumission PDFs the way a tendering tool prints them, so the import can be tested against
 * documents rather than against pre-extracted rows.
 *
 * These are generated rather than committed as binaries so the layout being tested is readable and
 * can be varied: the things that actually differ between real soumissions are the language of the
 * column header, whether the numeric headers sit left or right over their data, whether prices are
 * filled in or left to be priced, and how sections, rooms and variants are printed. Real documents
 * are still the final word — `corpus-acceptance.test.ts` runs against them when the GEE corpus is
 * present — but nothing here depends on that corpus being available.
 */
import PDFDocument from 'pdfkit';

/** Column origins in PDF points, close to a real A4 CAN/NPK sheet. */
const COL = {
  num: 40,
  texte: 95,
  ci: 300,
  qte: 330,
  qteWidth: 50,
  unite: 395,
  pu: 430,
  puWidth: 55,
  total: 500,
  totalWidth: 60,
};

export interface HeaderWords {
  num: string;
  texte: string;
  ci?: string;
  qte: string;
  unite: string;
  pu: string;
  total: string;
}

export const HEADERS: Record<'fr' | 'frShort' | 'de' | 'it', HeaderWords> = {
  fr: { num: 'Numéro', texte: 'Texte', ci: 'CI', qte: 'Quantité', unite: 'Unité', pu: 'Prix unitaire', total: 'Prix total' },
  frShort: { num: 'N°', texte: 'Désignation', qte: 'Qté', unite: 'Unité', pu: 'PU', total: 'Montant' },
  de: { num: 'Nummer', texte: 'Text', ci: 'CI', qte: 'Menge', unite: 'Einheit', pu: 'Einheitspreis', total: 'Gesamtpreis' },
  it: { num: 'Numero', texte: 'Descrizione', qte: 'Quantità', unite: 'Unità', pu: 'Prezzo unitario', total: 'Importo' },
};

export type SoumissionLine =
  | { kind: 'section'; code: string; text: string }
  | { kind: 'room'; code: string; text: string }
  | { kind: 'location'; code: string; text: string }
  | { kind: 'subtotal'; text: string; total: string }
  | { kind: 'note'; text: string }
  | { kind: 'pageBreak' }
  | {
      kind: 'position';
      code: string;
      text: string;
      ci?: string;
      qte: string;
      unite: string;
      pu?: string;
      total?: string;
    };

export interface SoumissionOptions {
  header?: HeaderWords;
  /** How the numeric column headers sit over their data. Both occur in the wild. */
  headerAlign?: 'right' | 'left';
  lines: SoumissionLine[];
  /** Printed on page 1 and read back as the document's metadata. */
  reference?: string | null;
  date?: string | null;
  concerne?: string | null;
  /** Leaves the text layer out entirely, as a scan of a paper soumission would. */
  scanned?: boolean;
}

/** A small, ordinary French soumission: two sections, a room heading, a continuation line. */
export const SAMPLE_LINES: SoumissionLine[] = [
  { kind: 'section', code: '231.2', text: 'Installations électriques' },
  { kind: 'location', code: 'A', text: 'Bâtiment principal' },
  { kind: 'room', code: '1.', text: 'Salle de gymnastique' },
  {
    kind: 'position',
    code: '571.201',
    text: 'Tube TT 20 mm, posé encastré sous crépi',
    ci: '1',
    qte: "1'250.00",
    unite: 'm',
    pu: '4.85',
    total: "6'062.50",
  },
  { kind: 'note', text: 'y compris boîtes de dérivation et fixations' },
  {
    kind: 'position',
    code: '573.112',
    text: 'Prise T13 complète, encastrée',
    ci: '2',
    qte: '48.00',
    unite: 'pce',
    pu: '46.50',
    total: "2'232.00",
  },
  {
    kind: 'position',
    code: '575.021',
    text: 'Luminaire LED 36 W, posé',
    ci: '3',
    qte: '24.00',
    unite: 'pce',
    pu: '185.00',
    total: "4'440.00",
  },
  { kind: 'subtotal', text: 'Total Installations électriques', total: "12'734.50" },
];

/** Quantities and prices of SAMPLE_LINES, in the units the import stores them in. */
export const SAMPLE_EXPECTED = [
  { npkNumber: '571.201', quantity: 1250, unit: 'm', unitPriceCents: 485, totalPriceCents: 606250 },
  { npkNumber: '573.112', quantity: 48, unit: 'pce', unitPriceCents: 4650, totalPriceCents: 223200 },
  { npkNumber: '575.021', quantity: 24, unit: 'pce', unitPriceCents: 18500, totalPriceCents: 444000 },
];

export async function buildSoumissionPdf(opts: SoumissionOptions): Promise<Buffer> {
  const {
    header = HEADERS.fr,
    headerAlign = 'right',
    lines,
    reference = '000443',
    date = '17.04.2025',
    concerne = 'Rénovation école Vinet, Lausanne',
    scanned = false,
  } = opts;

  const doc = new PDFDocument({ size: 'A4', margin: 30 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve) => doc.on('end', () => resolve()));

  if (scanned) {
    // A scan carries no text layer at all — a grey block stands in for the page image.
    doc.rect(40, 40, 500, 700).fill('#d9d9d9');
    doc.end();
    await finished;
    return Buffer.concat(chunks);
  }

  doc.font('Helvetica').fontSize(8);
  let y = 40;

  if (reference) { doc.text(`Soumission ${reference}`, COL.num, y); y += 12; }
  if (date) { doc.text('Date', COL.num, y); doc.text(date, COL.num + 60, y); y += 12; }
  if (concerne) { doc.text('Concerne', COL.num, y); doc.text(concerne, COL.num + 60, y); y += 12; }
  y += 8;

  const right = headerAlign === 'right';
  const printHeader = () => {
    doc.text(header.num, COL.num, y);
    doc.text(header.texte, COL.texte, y);
    if (header.ci) doc.text(header.ci, COL.ci, y);
    doc.text(header.qte, COL.qte, y, right ? { width: COL.qteWidth, align: 'right' } : {});
    doc.text(header.unite, COL.unite, y);
    doc.text(header.pu, COL.pu, y, right ? { width: COL.puWidth, align: 'right' } : {});
    doc.text(header.total, COL.total, y, right ? { width: COL.totalWidth, align: 'right' } : {});
    y += 16;
  };
  printHeader();

  for (const line of lines) {
    if (line.kind === 'pageBreak') {
      doc.addPage();
      y = 40;
      printHeader();
      continue;
    }
    if (y > 760) { doc.addPage(); y = 40; printHeader(); }

    switch (line.kind) {
      case 'section':
      case 'room':
      case 'location':
        doc.text(line.code, COL.num, y);
        doc.text(line.text, COL.texte, y, { width: 190 });
        y += 14;
        break;
      case 'subtotal':
        doc.text(line.text, COL.texte, y, { width: 190 });
        doc.text(line.total, COL.total, y, { width: COL.totalWidth, align: 'right' });
        y += 14;
        break;
      case 'note':
        doc.text(line.text, COL.texte, y, { width: 190 });
        y += 10;
        break;
      case 'position':
        doc.text(line.code, COL.num, y);
        doc.text(line.text, COL.texte, y, { width: 190 });
        if (line.ci && header.ci) doc.text(line.ci, COL.ci, y);
        doc.text(line.qte, COL.qte, y, { width: COL.qteWidth, align: 'right' });
        doc.text(line.unite, COL.unite, y);
        // Dot leaders are what a soumission prints where a price is still to be filled in.
        doc.text(line.pu ?? '............', COL.pu, y, { width: COL.puWidth, align: 'right' });
        doc.text(line.total ?? '............', COL.total, y, { width: COL.totalWidth, align: 'right' });
        y += 14;
        break;
    }
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}
