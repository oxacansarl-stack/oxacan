import { SWISS_ROUNDING_STEP } from '@oxacan/shared-types';

/** Swiss 5-centime rounding of an amount in centimes. */
export function swissRound(cents: number): number {
  return Math.round(cents / SWISS_ROUNDING_STEP) * SWISS_ROUNDING_STEP;
}

/** TTC for an HT amount at a VAT rate in basis points (810 = 8.1%), rounded like offer totals. */
export function ttcFromHt(htCents: number, vatRateBps: number): number {
  return swissRound(htCents + Math.round((htCents * vatRateBps) / 10_000));
}
