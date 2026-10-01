/**
 * Confidence scoring of an offer line (PRD §7.7, Annexe B `offer_line.confidence_score`).
 *
 * Four dimensions, each 0–1, or null when it does not apply to the line:
 *  - classification: certainty that the line's article is the right CAN/NPK article;
 *  - mapping:        certainty that the article belongs in the line's room type;
 *  - price:          reliability of the unit price (number and age of the observations);
 *  - rule:           reliability of the business rule that proposed the line.
 *
 * What the engine estimates gets the engine's score; what a user decided themselves (an article
 * picked from the catalogue, an article placed in a room by hand, a typed price) is a validated
 * value (§7.3 step 10) and scores 1. A line without a price is "prix à compléter" (§7.7 safety
 * rule) and its price scores 0.
 *
 * Combined score (`confidenceScore`): the weakest applicable dimension. A suggestion is only as
 * reliable as its least reliable part, and unlike a product it does not punish a line for having
 * more dimensions assessed (a rule-proposed line vs. a hand-typed one).
 */
export interface ConfidenceDimensions {
  confidenceClassification: number | null;
  confidenceMapping: number | null;
  confidencePrice: number | null;
  confidenceRule: number | null;
}

export const CONFIDENCE_KEYS = [
  'confidenceClassification',
  'confidenceMapping',
  'confidencePrice',
  'confidenceRule',
] as const;

/** Score of a value the user entered or validated themselves. */
export const USER_VALIDATED = 1;
/** Price score of a line without a price ("prix à compléter"). */
export const NO_PRICE = 0;

/** History-based prices never reach a typed price's certainty. */
const HISTORY_MAX = 0.95;
/** Volume: one observation 0.5, +0.1 per extra observation, full from 6. */
const VOLUME_BASE = 0.5;
const VOLUME_STEP = 0.1;
/** Freshness: full for prices up to a year old, then −15 % a year, never below 0.3. */
const FRESH_YEARS = 1;
const AGE_DECAY_PER_YEAR = 0.15;
const FRESHNESS_FLOOR = 0.3;
/**
 * An indexed price has been brought forward with a general index, so it ages half as fast, but
 * the index is an average, not the article's own price change: capped at 0.9.
 */
const INDEXED_AGE_FACTOR = 0.5;
const INDEXED_CAP = 0.9;

/** The combined score: the minimum of the dimensions that apply, null if none applies. */
export function combinedConfidence(d: ConfidenceDimensions): number | null {
  const values = CONFIDENCE_KEYS.map((k) => d[k]).filter((v): v is number => v != null);
  return values.length ? round2(Math.min(...values)) : null;
}

/**
 * Price dimension of a price taken from the article's history (§7.7: "nombre d'observations,
 * ancienneté").
 * @param observationCount observations the price is computed from (1 for LATEST / INDEXED)
 * @param ageYears average age of those observations, in years
 */
export function historyPriceConfidence(observationCount: number, ageYears: number, indexed = false): number {
  if (observationCount <= 0) return NO_PRICE;
  const volume = Math.min(1, VOLUME_BASE + VOLUME_STEP * (observationCount - 1));
  const age = Math.max(0, ageYears) * (indexed ? INDEXED_AGE_FACTOR : 1);
  const freshness = Math.max(FRESHNESS_FLOOR, 1 - AGE_DECAY_PER_YEAR * Math.max(0, age - FRESH_YEARS));
  return round2(Math.min(HISTORY_MAX, volume * freshness * (indexed ? INDEXED_CAP : 1)));
}

/** Clamps to 0–1 with two decimals (the column is a REAL). */
export function round2(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}
