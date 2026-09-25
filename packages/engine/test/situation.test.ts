import { describe, it, expect } from 'vitest';
import { computeSituation } from '../src/index.js';
import { sampleOffer } from './fixtures.js';

describe('situation de travaux — Q28/Q29/Q30', () => {
  const offer = sampleOffer();
  it('S1: quantities executed × unit price, 5% retention, deposit deducted', () => {
    const s1 = computeSituation(offer, { number: 1, executed: [{ lineId: 'a1', executedQuantity: 5 }, { lineId: 'a2', executedQuantity: 2 }], previouslyClaimedExclVat: 0, depositsInvoicedExclVat: 20000, retentionPercent: 5, previouslyRetained: 0, vatRatePercent: 8.1 });
    expect(s1.cumulativeExclVat).toBe(54000);      // 5×60 + 2×120 = 540.00
    expect(s1.periodExclVat).toBe(54000);
    expect(s1.retentionThisPeriod).toBe(2700);     // 5 %
    expect(s1.depositsDeducted).toBe(20000);       // acompte 200.00 déduit
    expect(s1.netExclVat).toBe(31300);
    expect(s1.vatAmount).toBe(2535);               // 25.353 → 25.35
    expect(s1.netInclVat).toBe(33835);             // 338.35 (already at 5 cents)
  });
  it('S2 is cumulative and deducts S1 and retention already applied', () => {
    const s2 = computeSituation(offer, { number: 2, executed: [{ lineId: 'a1', executedQuantity: 10 }, { lineId: 'a2', executedQuantity: 4 }, { lineId: 'a3', executedQuantity: 1 }], previouslyClaimedExclVat: 54000, depositsInvoicedExclVat: 0, retentionPercent: 5, previouslyRetained: 2700, vatRatePercent: 8.1 });
    expect(s2.cumulativeExclVat).toBe(204000);
    expect(s2.periodExclVat).toBe(150000);
    expect(s2.retentionThisPeriod).toBe(7500);     // 10'200 cumul − 2'700
    expect(s2.netExclVat).toBe(142500);
  });
  it('flags quantity overruns (base for plus-values) without blocking', () => {
    const s = computeSituation(offer, { number: 1, executed: [{ lineId: 'a1', executedQuantity: 12 }], previouslyClaimedExclVat: 0, depositsInvoicedExclVat: 0, retentionPercent: 0, previouslyRetained: 0, vatRatePercent: 8.1 });
    expect(s.lines.find((l) => l.lineId === 'a1')?.overrun).toBe(true);
  });
  it('refuses a negative period — corrections go through a credit note', () => {
    expect(() => computeSituation(offer, { number: 2, executed: [{ lineId: 'a1', executedQuantity: 1 }], previouslyClaimedExclVat: 54000, depositsInvoicedExclVat: 0, retentionPercent: 5, previouslyRetained: 2700, vatRatePercent: 8.1 })).toThrow(/avoir/);
  });
});
