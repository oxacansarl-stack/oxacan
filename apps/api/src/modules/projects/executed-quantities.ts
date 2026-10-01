/*
 * Executed quantities (PRD §10, §15.2) — pure helpers shared with invoicing. The ledger itself is
 * ExecutedQuantitiesService; InvoicingService.situationPositions() exposes each position's
 * validated cumulative as `executedQuantity` (null while nothing is validated for it).
 */

/** Offer variants that are priced work (same list as invoicing's SITUATION_VARIANTS). */
export const EXECUTED_QUANTITY_VARIANTS = ['BASE', 'VARIANTE', 'OPTION'];

/** Quantities are NUMERIC(18,6): add, subtract and compare at that precision. */
export const roundExecutedQuantity = (q: number): number => Math.round(q * 1e6) / 1e6;

/**
 * Cumulative quantity a situation line bills for an offer position: the one given in the request,
 * else the position's validated executed quantity. undefined when there is neither (createInvoice
 * then asks for it).
 */
export function situationLineCumulativeQuantity(
  requested: number | null | undefined,
  position: { executedQuantity: number | null },
): number | undefined {
  if (requested != null) return requested;
  return position.executedQuantity ?? undefined;
}
