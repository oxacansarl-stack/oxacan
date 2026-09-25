import { applyFactor, applyPercent, roundCents, roundToFiveCents, type Cents } from './money.js';
import type { ArticleLine, LineTotals, NodeTotals, Offer, OfferTotals } from './types.js';

function unitCostOf(line: ArticleLine): Cents {
  return line.cost.material + line.cost.labour + line.cost.subcontract;
}

function marginPercentOfPrice(price: Cents, cost: Cents): number {
  if (price === 0) return 0;
  return Math.round(((price - cost) / price) * 10000) / 100;
}

/** Calcule une ligne. Le prix unitaire = coût unitaire × facteur, arrondi au centime, puis × quantité. */
export function computeLine(line: ArticleLine, sellFactor: number): LineTotals {
  const unitCost = unitCostOf(line);
  const factor = line.factorOverride ?? sellFactor;
  const unitPrice = applyFactor(unitCost, factor);
  const excluded = line.excluded === true;
  const qty = excluded ? 0 : line.quantity;
  const totalCost = roundCents(unitCost * qty);
  const totalPrice = roundCents(unitPrice * qty);
  return {
    id: line.id,
    code: line.code,
    quantity: line.quantity,
    unitCost,
    unitPrice,
    totalCost,
    totalPrice,
    marginAmount: totalPrice - totalCost,
    excluded,
  };
}

function node(id: string, label: string, totalCost: Cents, totalPrice: Cents): NodeTotals {
  return { id, label, totalCost, totalPrice, marginAmount: totalPrice - totalCost, marginPercentOfPrice: marginPercentOfPrice(totalPrice, totalCost) };
}

/**
 * Calcule l'offre complète : lignes → chapitres → CFC → zones → totaux.
 * Déterministe : même entrée, même sortie. Aucune écriture, aucune I/O.
 */
export function computeOffer(offer: Offer): OfferTotals {
  const { sellFactor, vatRatePercent, discountPercent = 0, roundTotalToFiveCents = true } = offer.params;
  if (!(sellFactor > 0)) throw new Error('sellFactor must be > 0');
  if (vatRatePercent < 0 || vatRatePercent > 100) throw new Error('vatRatePercent out of range');
  if (discountPercent < 0 || discountPercent > 100) throw new Error('discountPercent out of range');

  const lines: LineTotals[] = [];
  const chapters: NodeTotals[] = [];
  const cfcs: NodeTotals[] = [];
  const zones: NodeTotals[] = [];

  for (const zone of offer.zones) {
    let zCost = 0, zPrice = 0;
    for (const cfc of zone.cfcs) {
      let cCost = 0, cPrice = 0;
      for (const chapter of cfc.chapters) {
        let chCost = 0, chPrice = 0;
        for (const article of chapter.articles) {
          const lt = computeLine(article, sellFactor);
          lines.push(lt);
          chCost += lt.totalCost; chPrice += lt.totalPrice;
        }
        chapters.push(node(chapter.id, `${chapter.code} ${chapter.label}`, chCost, chPrice));
        cCost += chCost; cPrice += chPrice;
      }
      cfcs.push(node(cfc.id, `${cfc.code} ${cfc.label}`, cCost, cPrice));
      zCost += cCost; zPrice += cPrice;
    }
    zones.push(node(zone.id, zone.label, zCost, zPrice));
  }

  const totalCost = zones.reduce((s, z) => s + z.totalCost, 0);
  const subtotalBeforeDiscount = zones.reduce((s, z) => s + z.totalPrice, 0);
  const discountAmount = applyPercent(subtotalBeforeDiscount, discountPercent);
  const totalExclVat = subtotalBeforeDiscount - discountAmount;
  const vatAmount = applyPercent(totalExclVat, vatRatePercent);
  const rawIncl = totalExclVat + vatAmount;
  const totalInclVat = roundTotalToFiveCents ? roundToFiveCents(rawIncl) : rawIncl;
  const roundingAdjustment = totalInclVat - rawIncl;
  const marginAmount = totalExclVat - totalCost;

  return {
    lines, chapters, cfcs, zones,
    totalCost, subtotalBeforeDiscount, discountAmount, totalExclVat, vatAmount, totalInclVat, roundingAdjustment,
    marginAmount, marginPercentOfPrice: marginPercentOfPrice(totalExclVat, totalCost),
  };
}
