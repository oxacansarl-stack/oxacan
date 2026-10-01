import {
  addDays, chf, date, ensureSpace, heading, letterhead, newDocument, PAGE, pageNumbers, paragraph, Party, pct, qty,
  Sender, table, titleBlock, toBuffer, totals, COLORS,
} from './pdf-layout';
import { sellingLineCents, sellingUnitCents, variantLabel, variantSemantics } from '../offers/offer-pricing';

export interface OfferDocumentData {
  sender: Sender;
  client: Party | null;
  offer: {
    reference: string | null;
    projectName: string;
    version: number | null;
    date: string | Date;
    validityDays: number | null;
    vatRate: number;
    marginFactor: number;
    totalHtCents: number;
    totalVatCents: number;
    totalTtcCents: number;
    notes: string | null;
  };
  lines: {
    positionNumber: number | null;
    description: string;
    unit: string | null;
    quantity: number;
    unitPriceCents: number | null;
    totalPriceCents: number | null;
    variantType: string;
    roomType: string | null;
  }[];
  assumptions: { type: string; description: string; impactAmountCents: number | null; status: string }[];
}


export async function renderOffer(d: OfferDocumentData): Promise<Buffer> {
  const { offer } = d;
  const number = [offer.reference, offer.version && offer.version > 1 ? `v${offer.version}` : null].filter(Boolean).join(' ');
  const title = number ? `Offre n° ${number}` : 'Offre';
  const doc = newDocument(title, d.sender.name);
  const width = PAGE.right - PAGE.left;

  letterhead(doc, d.sender, d.client);
  titleBlock(doc, title, [
    ['Date', date(offer.date)],
    ['Objet', offer.projectName],
    ['Validité', offer.validityDays ? `jusqu'au ${date(addDays(offer.date, offer.validityDays))}` : ''],
  ]);

  // Where each line type goes is defined once in offer-pricing.ts (VARIANT_SEMANTICS, PRD §7.8).
  const byType = (t: string) => d.lines.filter((l) => l.variantType === t);
  const inSection = (section: string) => d.lines.filter((l) => variantSemantics(l.variantType).pdfSection === section);
  const reserveNote = (l: OfferDocumentData['lines'][number]) => variantLabel(l.variantType).toLowerCase();
  const columns = [
    { header: 'Pos.', width: 35 },
    { header: 'Désignation', width: width - 280 },
    { header: 'Quantité', width: 60, align: 'right' as const },
    { header: 'Unité', width: 40 },
    { header: 'Prix unit. HT', width: 65, align: 'right' as const },
    { header: 'Total HT', width: 80, align: 'right' as const },
  ];
  const row = (l: OfferDocumentData['lines'][number], i: number) => [
    String(l.positionNumber ?? i + 1),
    // A hypothesis is priced into the total but flagged, so the client sees it is still to confirm.
    [variantSemantics(l.variantType).pdfReserve ? `${l.description} (${reserveNote(l)})` : l.description, l.roomType]
      .filter(Boolean)
      .join('\n'),
    qty(l.quantity),
    l.unit ?? '',
    // Stored prices are costs; the client sees selling prices (cost × margin factor).
    l.unitPriceCents == null ? 'prix à compléter' : chf(sellingUnitCents(l.unitPriceCents, offer.marginFactor)),
    l.unitPriceCents == null ? '' : chf(sellingLineCents(l.quantity, l.unitPriceCents, offer.marginFactor)),
  ];

  // Main table: exactly the lines counted in the total (BASE and hypotheses), so it adds up.
  table(doc, columns, inSection('main').map(row));
  const rounding = offer.totalTtcCents - offer.totalHtCents - offer.totalVatCents;
  totals(doc, [
    { label: 'Total HT', value: chf(offer.totalHtCents) },
    { label: `TVA ${pct(offer.vatRate)}`, value: chf(offer.totalVatCents) },
    ...(rounding ? [{ label: 'Arrondi', value: chf(rounding) }] : []),
    { label: 'Total TTC CHF', value: chf(offer.totalTtcCents), strong: true },
  ]);

  for (const [type, label] of [
    ['OPTION', 'Options (non comprises dans le total)'],
    ['VARIANTE', 'Variantes (non comprises dans le total)'],
  ] as const) {
    const lines = byType(type);
    if (lines.length === 0) continue;
    heading(doc, label);
    table(doc, columns, lines.map(row));
  }

  const excluded = inSection('exclusions');
  if (excluded.length) {
    heading(doc, 'Prestations non comprises');
    paragraph(doc, excluded.map((l) => `• ${l.description}`).join('\n'));
  }

  const openPoints = [
    // Hypotheses (also in the main table) and missing information (not priced in) are reserves.
    ...d.lines
      .filter((l) => variantSemantics(l.variantType).pdfReserve)
      .map(
        (l) =>
          `• ${l.description} (${reserveNote(l)})` +
          (variantSemantics(l.variantType).inTotal || l.unitPriceCents == null
            ? ''
            : ` (estimation ${chf(sellingLineCents(l.quantity, l.unitPriceCents, offer.marginFactor))} CHF HT, non comprise dans le total)`),
      ),
    ...d.assumptions
      .filter((a) => a.status !== 'rejected')
      .map(
        (a) =>
          `• ${variantLabel(a.type)} : ${a.description}` +
          (a.impactAmountCents ? ` (incidence ${chf(a.impactAmountCents)} CHF HT)` : ''),
      ),
  ];
  if (openPoints.length) {
    heading(doc, 'Hypothèses et réserves');
    paragraph(doc, openPoints.join('\n'));
  }

  if (offer.notes) {
    heading(doc, 'Remarques');
    paragraph(doc, offer.notes);
  }

  ensureSpace(doc, 110);
  heading(doc, 'Bon pour accord');
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
  const y = doc.y + 30;
  doc.moveTo(PAGE.left, y).lineTo(PAGE.left + 200, y).lineWidth(0.5).strokeColor(COLORS.line).stroke();
  doc.moveTo(PAGE.right - 200, y).lineTo(PAGE.right, y).stroke();
  doc.text('Lieu et date', PAGE.left, y + 4);
  doc.text("Signature du maître d'ouvrage", PAGE.right - 200, y + 4);

  pageNumbers(doc);
  return toBuffer(doc);
}
