/**
 * Continuité numérique : transformation d'une offre adjugée en structure de projet (Q34).
 * Les postes sont regroupés en lots de travail (par chapitre, dans chaque zone) ; chaque lot
 * devient une tâche chantier avec ses quantités et son budget d'heures (dérivé du coût main-d'œuvre).
 * Aucune ressaisie : la structure de l'offre EST la structure du chantier.
 */
import type { Offer } from './types.js';
import { computeLine } from './offer.js';

export interface WorkLot { id: string; zoneId: string; zoneLabel: string; chapterCode: string; chapterLabel: string; lineIds: string[]; budgetLabourCents: number; budgetHours: number; budgetMaterialCents: number; }

export function offerToWorkLots(offer: Offer, hourlyRateCents: number): WorkLot[] {
  if (!(hourlyRateCents > 0)) throw new Error('hourlyRateCents must be > 0');
  const lots: WorkLot[] = [];
  for (const zone of offer.zones) for (const cfc of zone.cfcs) for (const chapter of cfc.chapters) {
    const lines = chapter.articles.filter((a) => !a.excluded);
    if (!lines.length) continue;
    const labour = lines.reduce((s, a) => s + Math.round(a.cost.labour * a.quantity), 0);
    const material = lines.reduce((s, a) => s + Math.round(a.cost.material * a.quantity), 0);
    void computeLine; // available for per-line budgets in later iterations
    lots.push({ id: `${zone.id}:${chapter.id}`, zoneId: zone.id, zoneLabel: zone.label, chapterCode: chapter.code, chapterLabel: chapter.label, lineIds: lines.map((a) => a.id), budgetLabourCents: labour, budgetHours: Math.round((labour / hourlyRateCents) * 100) / 100, budgetMaterialCents: material });
  }
  return lots;
}
