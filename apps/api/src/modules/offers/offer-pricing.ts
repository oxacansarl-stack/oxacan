/**
 * Offer lines store cost prices; clients see selling prices = cost × margin factor (PRD Q23:
 * 120 = ×1.20).
 *
 * The six line types of PRD §7.8 / Annexe B criterion 9, and what each means for the offer:
 *
 *  type                   | in total | must be priced | blocks sending | offer PDF
 *  -----------------------|----------|----------------|----------------|------------------------------------
 *  BASE                   | yes      | yes            | no             | main table
 *  HYPOTHESE_A_VALIDER    | yes      | yes            | yes            | main table, flagged + "réserves"
 *  VARIANTE               | no       | no             | no             | "Variantes" table (alternatives)
 *  OPTION                 | no       | no             | no             | "Options" table (extra, chiffrable)
 *  INFORMATION_MANQUANTE  | no       | no             | yes            | "Hypothèses et réserves" list
 *  EXCLU                  | no       | no             | no             | "Prestations non comprises" list
 *
 * A hypothesis is scope priced on an assumption still to be confirmed: it is part of what the
 * client would pay, so it counts in the total and falls under the 100 % rule (§7.9). Once
 * decided it becomes BASE (confirmed) or EXCLU (refused). Missing information cannot be priced
 * yet, so it stays out of the total. Both block sending (R005), so a sent offer only ever holds
 * BASE, VARIANTE, OPTION and EXCLU lines.
 */
export const VARIANT_TYPES = [
  'BASE',
  'VARIANTE',
  'OPTION',
  'HYPOTHESE_A_VALIDER',
  'INFORMATION_MANQUANTE',
  'EXCLU',
] as const;
export type VariantType = (typeof VARIANT_TYPES)[number];

export interface VariantSemantics {
  /** Counts in the offer total (HT / TVA / TTC). */
  inTotal: boolean;
  /** Must carry a price before sending (100 % rule, §7.9); implies inTotal. */
  mustBePriced: boolean;
  /** Still needs a decision; the offer cannot be sent while such a line exists (R005). */
  blocksSubmission: boolean;
  /** Where the offer PDF shows the line. */
  pdfSection: 'main' | 'alternatives' | 'reserves' | 'exclusions';
  /** Also listed under "Hypothèses et réserves" in the PDF. */
  pdfReserve: boolean;
  /** French label used on documents. */
  label: string;
}

export const VARIANT_SEMANTICS: Record<VariantType, VariantSemantics> = {
  BASE: { inTotal: true, mustBePriced: true, blocksSubmission: false, pdfSection: 'main', pdfReserve: false, label: 'Base' },
  HYPOTHESE_A_VALIDER: {
    inTotal: true, mustBePriced: true, blocksSubmission: true, pdfSection: 'main', pdfReserve: true, label: 'Hypothèse à valider',
  },
  VARIANTE: { inTotal: false, mustBePriced: false, blocksSubmission: false, pdfSection: 'alternatives', pdfReserve: false, label: 'Variante' },
  OPTION: { inTotal: false, mustBePriced: false, blocksSubmission: false, pdfSection: 'alternatives', pdfReserve: false, label: 'Option' },
  INFORMATION_MANQUANTE: {
    inTotal: false, mustBePriced: false, blocksSubmission: true, pdfSection: 'reserves', pdfReserve: true, label: 'Information manquante',
  },
  EXCLU: { inTotal: false, mustBePriced: false, blocksSubmission: false, pdfSection: 'exclusions', pdfReserve: false, label: 'Exclu' },
};

/** Semantics of a stored type; an unknown value is treated like an exclusion (never priced in). */
export function variantSemantics(type: string): VariantSemantics {
  return VARIANT_SEMANTICS[type as VariantType] ?? VARIANT_SEMANTICS.EXCLU;
}

/** Document label of a line or assumption type; the raw value if unknown. */
export function variantLabel(type: string): string {
  return VARIANT_SEMANTICS[type as VariantType]?.label ?? type;
}

/** Line types that make up the offer total. */
export const LINES_IN_TOTAL: string[] = VARIANT_TYPES.filter((t) => VARIANT_SEMANTICS[t].inTotal);

/** Line types that still need a decision before the offer can be sent (R005, §14). */
export const PENDING_LINE_TYPES: string[] = VARIANT_TYPES.filter((t) => VARIANT_SEMANTICS[t].blocksSubmission);

export function sellingUnitCents(costUnitCents: number, marginFactor: number): number {
  return Math.round((costUnitCents * marginFactor) / 100);
}

export function sellingLineCents(quantity: number | string, costUnitCents: number, marginFactor: number): number {
  return Math.round(Number(quantity) * sellingUnitCents(costUnitCents, marginFactor));
}
