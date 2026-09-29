/**
 * Offer lines store cost prices; clients see selling prices = cost × margin factor (PRD Q23:
 * 120 = ×1.20). Only BASE lines make up the offer total — variants and options are priced
 * separately, exclusions and open points are listed but not priced into the total.
 */
export const LINES_IN_TOTAL = ['BASE'];

export function sellingUnitCents(costUnitCents: number, marginFactor: number): number {
  return Math.round((costUnitCents * marginFactor) / 100);
}

export function sellingLineCents(quantity: number | string, costUnitCents: number, marginFactor: number): number {
  return Math.round(Number(quantity) * sellingUnitCents(costUnitCents, marginFactor));
}
