import { describe, it, expect } from 'vitest';
import { computeOffer, computeLine, formatChf, roundToFiveCents, applyPercent } from '../src/index.js';
import { sampleOffer } from './fixtures.js';

describe('money', () => {
  it('rounds to 5 cents (Swiss rounding) half-up', () => {
    expect(roundToFiveCents(1002)).toBe(1000);
    expect(roundToFiveCents(1003)).toBe(1005);
    expect(roundToFiveCents(1007)).toBe(1005);
    expect(roundToFiveCents(1008)).toBe(1010);
  });
  it('applies VAT 8.1% at the cent', () => {
    expect(applyPercent(100000, 8.1)).toBe(8100);
    expect(applyPercent(12345, 8.1)).toBe(1000); // 999.945 → 1000
  });
  it('formats CHF with apostrophe thousands separator', () => {
    expect(formatChf(123456789)).toBe("CHF 1'234'567.89");
    expect(formatChf(-505)).toBe('-CHF 5.05');
  });
});

describe('computeLine — Q23: coût 100 × facteur 1.2 = prix 120', () => {
  it('multiplies, never divides', () => {
    const lt = computeLine({ id: 'x', kind: 'catalogue', code: 'x', label: 'x', unit: 'pce', quantity: 1, cost: { material: 10000, labour: 0, subcontract: 0 } }, 1.2);
    expect(lt.unitPrice).toBe(12000);
    expect(lt.marginAmount).toBe(2000);
  });
  it('honours a per-line factor override', () => {
    const lt = computeLine({ id: 'x', kind: 'custom', code: 'x', label: 'x', unit: 'h', quantity: 2, cost: { material: 0, labour: 5000, subcontract: 0 }, factorOverride: 1.5 }, 1.2);
    expect(lt.unitPrice).toBe(7500);
    expect(lt.totalPrice).toBe(15000);
  });
  it('Q36: an excluded line stays visible but counts zero', () => {
    const lt = computeLine({ id: 'x', kind: 'catalogue', code: 'x', label: 'x', unit: 'pce', quantity: 3, cost: { material: 1000, labour: 0, subcontract: 0 }, excluded: true }, 1.2);
    expect(lt.excluded).toBe(true);
    expect(lt.quantity).toBe(3);
    expect(lt.totalPrice).toBe(0);
  });
});

describe('computeOffer — hierarchy Zone > CFC > Chapitre > Article', () => {
  const t = computeOffer(sampleOffer());
  it('line totals are hand-checkable', () => {
    expect(t.lines.map((l) => l.totalPrice)).toEqual([60000, 48000, 96000, 0]);
  });
  it('rolls up per chapter, CFC, zone', () => {
    expect(t.chapters.map((c) => c.totalPrice)).toEqual([108000, 96000]);
    expect(t.zones.map((z) => z.totalPrice)).toEqual([108000, 96000]);
    expect(t.cfcs).toHaveLength(2);
  });
  it('computes HT, TVA 8.1 %, TTC rounded to 5 cents', () => {
    expect(t.totalExclVat).toBe(204000);            // 2'040.00
    expect(t.vatAmount).toBe(16524);                // 165.24
    expect(t.totalInclVat).toBe(220525);            // 2'205.24 → 2'205.25
    expect(t.roundingAdjustment).toBe(1);
  });
  it('reports margin on sale price', () => {
    expect(t.totalCost).toBe(170000);
    expect(t.marginAmount).toBe(34000);
    expect(t.marginPercentOfPrice).toBe(16.67);
  });
  it('Q21: VAT rate is editable on the whole document', () => {
    const o = sampleOffer(); o.params.vatRatePercent = 0;
    const z = computeOffer(o);
    expect(z.vatAmount).toBe(0);
    expect(z.totalInclVat).toBe(204000);
  });
  it('applies a global discount before VAT', () => {
    const o = sampleOffer(); o.params.discountPercent = 10;
    const d = computeOffer(o);
    expect(d.discountAmount).toBe(20400);
    expect(d.totalExclVat).toBe(183600);
  });
  it('is deterministic', () => {
    expect(computeOffer(sampleOffer())).toEqual(computeOffer(sampleOffer()));
  });
  it('rejects invalid parameters', () => {
    const o = sampleOffer(); o.params.sellFactor = 0;
    expect(() => computeOffer(o)).toThrow();
  });
});
