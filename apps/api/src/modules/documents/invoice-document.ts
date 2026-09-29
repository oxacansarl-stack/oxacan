import { SwissQRBill } from 'swissqrbill/pdf';
import { mm2pt } from 'swissqrbill/utils';
import {
  addDays, chf, date, Doc, heading, letterhead, newDocument, PAGE, pageNumbers, paragraph, Party, pct, qty,
  Sender, table, titleBlock, toBuffer, totals, COLORS,
} from './pdf-layout';
import { buildQrBill } from './qr-bill';

export interface InvoiceDocumentData {
  sender: Sender;
  iban: string | null;
  paymentTermsDays: number;
  client: Party | null;
  project: { reference: string | null; name: string } | null;
  invoice: {
    type: string;
    invoiceNumber: string;
    status: string;
    issueDate: string | Date;
    dueDate: string | Date | null;
    vatRate: number;
    subtotalHtCents: number;
    vatAmountCents: number;
    retentionAmountCents: number | null;
    priorAcomptesCents: number | null;
    totalTtcCents: number;
    amountPaidCents: number | null;
    notes: string | null;
    paymentTerms: string | null;
    referenceInvoiceNumber: string | null;
  };
  lines: {
    description: string;
    unit: string | null;
    quantity: number;
    unitPriceCents: number;
    totalPriceCents: number;
    cumulativeQuantity: number | null;
    previousQuantity: number | null;
    periodQuantity: number | null;
  }[];
}

const TITLES: Record<string, string> = {
  invoice: 'Facture',
  situation: 'Situation',
  acompte: "Demande d'acompte",
  credit_note: 'Note de crédit',
  final_invoice: 'Facture finale',
};

export async function renderInvoice(d: InvoiceDocumentData): Promise<Buffer> {
  const { invoice, lines } = d;
  const title = `${TITLES[invoice.type] ?? 'Facture'} n° ${invoice.invoiceNumber}`;
  const doc = newDocument(title, d.sender.name);
  const isCredit = invoice.type === 'credit_note';
  const due = invoice.dueDate ?? addDays(invoice.issueDate, d.paymentTermsDays);

  letterhead(doc, d.sender, d.client);
  titleBlock(doc, title, [
    ['Date', date(invoice.issueDate)],
    ['Échéance', isCredit ? '' : date(due)],
    ['Projet', d.project ? [d.project.reference, d.project.name].filter(Boolean).join(' – ') : ''],
    ['Concerne', isCredit && invoice.referenceInvoiceNumber ? `Facture n° ${invoice.referenceInvoiceNumber}` : ''],
  ]);

  const width = PAGE.right - PAGE.left;
  if (invoice.type === 'situation') {
    table(
      doc,
      [
        { header: 'Désignation', width: width - 355 },
        { header: 'Unité', width: 40 },
        { header: 'Cumul', width: 55, align: 'right' },
        { header: 'Précédent', width: 55, align: 'right' },
        { header: 'Période', width: 55, align: 'right' },
        { header: 'Prix unit.', width: 65, align: 'right' },
        { header: 'Montant', width: 85, align: 'right' },
      ],
      lines.map((l) => [
        l.description,
        l.unit ?? '',
        qty(l.cumulativeQuantity),
        qty(l.previousQuantity),
        qty(l.periodQuantity ?? l.quantity),
        chf(l.unitPriceCents),
        chf(l.totalPriceCents),
      ]),
    );
  } else {
    table(
      doc,
      [
        { header: 'Pos.', width: 30 },
        { header: 'Désignation', width: width - 275 },
        { header: 'Quantité', width: 60, align: 'right' },
        { header: 'Unité', width: 40 },
        { header: 'Prix unit.', width: 65, align: 'right' },
        { header: 'Montant', width: 80, align: 'right' },
      ],
      lines.map((l, i) => [String(i + 1), l.description, qty(l.quantity), l.unit ?? '', chf(l.unitPriceCents), chf(l.totalPriceCents)]),
    );
  }

  const paid = invoice.amountPaidCents ?? 0;
  const rounding =
    invoice.totalTtcCents -
    (invoice.subtotalHtCents + invoice.vatAmountCents - (invoice.retentionAmountCents ?? 0) - (invoice.priorAcomptesCents ?? 0));
  const rows = [
    { label: 'Total HT', value: chf(invoice.subtotalHtCents) },
    { label: `TVA ${pct(invoice.vatRate)}`, value: chf(invoice.vatAmountCents) },
    { label: 'Total TTC', value: chf(invoice.subtotalHtCents + invoice.vatAmountCents) },
    ...(invoice.retentionAmountCents ? [{ label: 'Retenue de garantie', value: `– ${chf(invoice.retentionAmountCents)}` }] : []),
    ...(invoice.priorAcomptesCents ? [{ label: 'Acomptes déjà facturés', value: `– ${chf(invoice.priorAcomptesCents)}` }] : []),
    ...(rounding ? [{ label: 'Arrondi', value: chf(rounding) }] : []),
    { label: isCredit ? 'Montant crédité CHF' : 'Montant à payer CHF', value: chf(invoice.totalTtcCents), strong: true },
    ...(paid > 0 && !isCredit
      ? [
          { label: 'Déjà payé', value: `– ${chf(paid)}` },
          { label: 'Solde dû CHF', value: chf(invoice.totalTtcCents - paid), strong: true },
        ]
      : []),
  ];
  totals(doc, rows);

  if (invoice.notes) {
    heading(doc, 'Remarques');
    paragraph(doc, invoice.notes);
  }
  if (!isCredit) {
    heading(doc, 'Conditions de paiement');
    paragraph(doc, invoice.paymentTerms || `Payable net à ${d.paymentTermsDays} jours, jusqu'au ${date(due)}.`);
  }

  if (!isCredit) attachQrBill(doc, d, invoice.totalTtcCents - paid);
  pageNumbers(doc);
  return toBuffer(doc);
}

function attachQrBill(doc: Doc, d: InvoiceDocumentData, amountCents: number) {
  const qr = buildQrBill({
    iban: d.iban,
    creditor: d.sender,
    debtor: d.client,
    amountCents,
    invoiceNumber: d.invoice.invoiceNumber,
  });
  if ('unavailable' in qr) {
    doc.moveDown(1);
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(COLORS.muted).text(qr.unavailable, PAGE.left, doc.y);
    return;
  }
  // The payment part is 105 mm high and must sit at the bottom of an A4 page (not the library's
  // default A6 overflow page, which office printers scale badly).
  const slipTop = PAGE.height - mm2pt(105);
  if (doc.y > slipTop - mm2pt(5)) doc.addPage({ size: 'A4' });
  new SwissQRBill(qr.data, { language: 'FR' }).attachTo(doc, 0, slipTop);
}
