import { applyPercent, roundCents, roundToFiveCents, type Cents } from './money.js';
import type { Offer } from './types.js';
import { computeLine } from './offer.js';

/**
 * Situation de travaux (état d'avancement), calculée sur les quantités réellement exécutées (Q28).
 * Cumulatif : chaque situation déduit les situations précédentes et les acomptes déjà facturés (Q30).
 * Retenue de garantie : souvent 5 % jusqu'à la réception, selon contrat (Q29).
 */

export interface ExecutedQuantity { lineId: string; executedQuantity: number; }

export interface SituationParams {
  /** Numéro de la situation (1, 2, 3…). */
  number: number;
  /** Quantités exécutées cumulées à la date de la situation. */
  executed: ExecutedQuantity[];
  /** Total HT cumulé des situations précédentes (déjà facturé). */
  previouslyClaimedExclVat: Cents;
  /** Acomptes déjà facturés HT (ils se déduisent). */
  depositsInvoicedExclVat: Cents;
  /** Taux de retenue de garantie en %, ex. 5. 0 si aucune. */
  retentionPercent: number;
  /** Retenue déjà appliquée sur les situations précédentes (pour ne pas la retenir deux fois). */
  previouslyRetained: Cents;
  vatRatePercent: number;
}

export interface SituationLine { lineId: string; code: string; offeredQuantity: number; executedQuantity: number; unitPrice: Cents; cumulativeAmount: Cents; overrun: boolean; }

export interface SituationTotals {
  number: number;
  lines: SituationLine[];
  cumulativeExclVat: Cents;
  previouslyClaimedExclVat: Cents;
  periodExclVat: Cents;
  retentionThisPeriod: Cents;
  depositsDeducted: Cents;
  netExclVat: Cents;
  vatAmount: Cents;
  netInclVat: Cents;
}

export function computeSituation(offer: Offer, params: SituationParams): SituationTotals {
  const executedById = new Map(params.executed.map((e) => [e.lineId, e.executedQuantity]));
  const lines: SituationLine[] = [];
  let cumulative = 0;
  for (const zone of offer.zones) for (const cfc of zone.cfcs) for (const chapter of cfc.chapters) for (const article of chapter.articles) {
    if (article.excluded) continue;
    const lt = computeLine(article, offer.params.sellFactor);
    const executedQuantity = executedById.get(article.id) ?? 0;
    if (executedQuantity < 0) throw new Error(`negative executed quantity on ${article.id}`);
    const cumulativeAmount = roundCents(lt.unitPrice * executedQuantity);
    cumulative += cumulativeAmount;
    lines.push({ lineId: article.id, code: article.code, offeredQuantity: article.quantity, executedQuantity, unitPrice: lt.unitPrice, cumulativeAmount, overrun: executedQuantity > article.quantity });
  }
  const periodExclVat = cumulative - params.previouslyClaimedExclVat;
  if (periodExclVat < 0) throw new Error('cumulative amount is lower than previously claimed — a credit note (avoir) is required, not a negative situation');
  const retentionCumulative = applyPercent(cumulative, params.retentionPercent);
  const retentionThisPeriod = retentionCumulative - params.previouslyRetained;
  // Les acomptes se déduisent une seule fois, dans la limite du montant restant dû.
  const afterRetention = periodExclVat - retentionThisPeriod;
  const depositsDeducted = Math.min(params.depositsInvoicedExclVat, Math.max(afterRetention, 0));
  const netExclVat = afterRetention - depositsDeducted;
  const vatAmount = applyPercent(netExclVat, params.vatRatePercent);
  const netInclVat = roundToFiveCents(netExclVat + vatAmount);
  return { number: params.number, lines, cumulativeExclVat: cumulative, previouslyClaimedExclVat: params.previouslyClaimedExclVat, periodExclVat, retentionThisPeriod, depositsDeducted, netExclVat, vatAmount, netInclVat };
}
