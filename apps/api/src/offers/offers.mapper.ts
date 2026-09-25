import type { Offer as EngineOffer } from '@oxacan/engine';
import type { Prisma } from '@prisma/client';

export type OfferWithTree = Prisma.OfferGetPayload<{ include: { zones: { include: { cfcs: { include: { chapters: { include: { lines: true } } } } } } } }>;

/** Projette l'entité persistée vers le modèle du moteur (pur, sans I/O). */
export function toEngineOffer(o: OfferWithTree): EngineOffer {
  return {
    id: o.id, reference: o.reference, currency: 'CHF',
    params: { sellFactor: Number(o.sellFactor), vatRatePercent: Number(o.vatRate), discountPercent: Number(o.discountPercent), roundTotalToFiveCents: true },
    zones: [...o.zones].sort((a, b) => a.position - b.position).map((z) => ({
      id: z.id, label: z.label,
      cfcs: [...z.cfcs].sort((a, b) => a.position - b.position).map((c) => ({
        id: c.id, code: c.code, label: c.label,
        chapters: [...c.chapters].sort((a, b) => a.position - b.position).map((ch) => ({
          id: ch.id, code: ch.code, label: ch.label,
          articles: [...ch.lines].sort((a, b) => a.position - b.position).map((l) => ({
            id: l.id, kind: l.kind === 'CATALOGUE' ? 'catalogue' : l.kind === 'COMPOSED' ? 'composed' : 'custom', code: l.code, label: l.label, unit: l.unit,
            quantity: Number(l.quantity), cost: { material: l.material, labour: l.labour, subcontract: l.subcontract },
            ...(l.factorOverride !== null ? { factorOverride: Number(l.factorOverride) } : {}), excluded: l.excluded,
          })),
        })),
      })),
    })),
  };
}
