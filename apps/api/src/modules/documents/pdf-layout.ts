import PDFDocument from 'pdfkit';
import { mm2pt } from 'swissqrbill/utils';

export type Doc = InstanceType<typeof PDFDocument>;

export const PAGE = { width: 595.28, height: 841.89, left: mm2pt(20), right: 595.28 - mm2pt(20), top: mm2pt(15) };
export const COLORS = { text: '#111827', muted: '#6b7280', line: '#d1d5db', accent: '#1f2937', band: '#f3f4f6' };

const amountFmt = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 });

export const chf = (cents: number | null | undefined) => amountFmt.format((cents ?? 0) / 100);
export const qty = (value: number | string | null | undefined) =>
  value == null || value === '' ? '' : qtyFmt.format(Number(value));
export const pct = (basisPoints: number) => `${amountFmt.format(basisPoints / 100)} %`;

/** "2026-09-29" / Date → "29.09.2026" (Swiss format, no time-zone shift for date-only values). */
export function date(value: string | Date | null | undefined): string {
  if (!value) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

export function addDays(value: string | Date, days: number): string {
  const d = new Date(`${date(value).split('.').reverse().join('-')}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function newDocument(title: string, author: string): Doc {
  return new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.top, bottom: mm2pt(15), left: PAGE.left, right: mm2pt(20) },
    bufferPages: true,
    info: { Title: title, Author: author, Creator: 'OXACAN' },
  });
}

export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export interface Party {
  name: string;
  contact?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
}

export function addressLines(p: Party): string[] {
  return [
    p.name,
    p.contact ?? '',
    p.addressLine1 ?? '',
    p.addressLine2 ?? '',
    [p.postalCode, p.city].filter(Boolean).join(' '),
    p.country && p.country !== 'CH' ? p.country : '',
  ].filter(Boolean);
}

export interface Sender extends Party {
  vatNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

/** Sender block top-left and recipient in the right-hand C5 window position (SN 010130). */
export function letterhead(doc: Doc, sender: Sender, recipient: Party | null) {
  doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(14).text(sender.name, PAGE.left, PAGE.top, { width: 250 });
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted);
  const details = [
    ...addressLines({ ...sender, name: '' }).filter(Boolean),
    sender.phone ? `Tél. ${sender.phone}` : '',
    sender.email ?? '',
    sender.website ?? '',
    sender.vatNumber ? `N° TVA ${sender.vatNumber}` : '',
  ].filter(Boolean);
  doc.text(details.join('\n'), { width: 250 });

  if (recipient) {
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(10);
    doc.text(addressLines(recipient).join('\n'), mm2pt(118), mm2pt(50), { width: mm2pt(80) });
  }
  doc.x = PAGE.left;
  doc.y = Math.max(doc.y, mm2pt(95));
}

export function titleBlock(doc: Doc, title: string, meta: [string, string][]) {
  doc.moveDown(0.5);
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(16).text(title, PAGE.left, doc.y);
  doc.moveDown(0.4);
  doc.fontSize(9);
  for (const [label, value] of meta.filter(([, v]) => v)) {
    const y = doc.y;
    doc.font('Helvetica').fillColor(COLORS.muted).text(label, PAGE.left, y, { width: 110 });
    doc.font('Helvetica').fillColor(COLORS.text).text(value, PAGE.left + 115, y, { width: PAGE.right - PAGE.left - 115 });
  }
  doc.moveDown(0.8);
}

export function heading(doc: Doc, text: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.6);
  doc.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(11).text(text, PAGE.left, doc.y);
  doc.moveDown(0.3);
}

export function paragraph(doc: Doc, text: string | null | undefined, empty = '—') {
  doc.fillColor(COLORS.text).font('Helvetica').fontSize(9.5).text(text?.trim() || empty, PAGE.left, doc.y, {
    width: PAGE.right - PAGE.left,
  });
}

export function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > PAGE.height - mm2pt(20)) {
    doc.addPage();
    doc.y = PAGE.top + 20;
  }
}

export interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

/** Table with a repeated header on each page; row heights follow wrapped text. */
export function table(doc: Doc, columns: Column[], rows: string[][], opts: { boldRows?: Set<number> } = {}) {
  const padding = 3;
  const drawHeader = () => {
    const y = doc.y;
    doc.rect(PAGE.left, y, PAGE.right - PAGE.left, 16).fill(COLORS.band);
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(8);
    let x = PAGE.left;
    for (const c of columns) {
      doc.text(c.header, x + padding, y + 4, { width: c.width - 2 * padding, align: c.align ?? 'left' });
      x += c.width;
    }
    doc.y = y + 18;
  };

  drawHeader();
  rows.forEach((row, i) => {
    doc.font(opts.boldRows?.has(i) ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    const height =
      Math.max(...row.map((cell, j) => doc.heightOfString(cell || ' ', { width: columns[j].width - 2 * padding }))) + 2 * padding;
    if (doc.y + height > PAGE.height - mm2pt(20)) {
      doc.addPage();
      doc.y = PAGE.top + 20;
      drawHeader();
      doc.font(opts.boldRows?.has(i) ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    }
    const y = doc.y;
    let x = PAGE.left;
    doc.fillColor(COLORS.text);
    row.forEach((cell, j) => {
      doc.text(cell ?? '', x + padding, y + padding, { width: columns[j].width - 2 * padding, align: columns[j].align ?? 'left' });
      x += columns[j].width;
    });
    doc.moveTo(PAGE.left, y + height).lineTo(PAGE.right, y + height).lineWidth(0.5).strokeColor(COLORS.line).stroke();
    doc.y = y + height;
  });
  doc.x = PAGE.left;
}

/** Right-aligned label/amount pairs; `strong` rows are bold with a rule above. */
export function totals(doc: Doc, rows: { label: string; value: string; strong?: boolean }[]) {
  ensureSpace(doc, rows.length * 16 + 10);
  doc.moveDown(0.5);
  const labelX = PAGE.right - 260;
  for (const r of rows) {
    const y = doc.y;
    if (r.strong) {
      doc.moveTo(labelX, y - 2).lineTo(PAGE.right, y - 2).lineWidth(0.8).strokeColor(COLORS.accent).stroke();
    }
    doc.font(r.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(r.strong ? 10.5 : 9.5).fillColor(COLORS.text);
    doc.text(r.label, labelX, y + (r.strong ? 2 : 0), { width: 170 });
    doc.text(r.value, labelX + 170, y + (r.strong ? 2 : 0), { width: 90, align: 'right' });
    doc.y = y + (r.strong ? 20 : 15);
  }
  doc.x = PAGE.left;
}

/** "Page x / y" in the top-right corner (the bottom is reserved for the QR-bill slip). */
export function pageNumbers(doc: Doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
    doc.text(`Page ${i + 1} / ${range.count}`, PAGE.right - 80, mm2pt(8), { width: 80, align: 'right', lineBreak: false });
  }
}

export function safeFilename(...parts: (string | number | null | undefined)[]): string {
  return (
    parts
      .filter((p) => p !== null && p !== undefined && p !== '')
      .join('-')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-+/g, '-') + '.pdf'
  );
}
