import { describe, it, expect } from 'vitest';
import { formatDocumentNumber, findGaps, offerToWorkLots } from '../src/index.js';
import { sampleOffer } from './fixtures.js';

describe('Q20 numbering', () => {
  it('formats F-YYYY-NNNNN and AV- for credit notes', () => {
    expect(formatDocumentNumber('invoice', 2026, 42)).toBe('F-2026-00042');
    expect(formatDocumentNumber('credit_note', 2026, 7)).toBe('AV-2026-00007');
  });
  it('detects gaps in an issued sequence', () => {
    expect(findGaps([1, 2, 3, 5, 8])).toEqual([4, 6, 7]);
    expect(findGaps([1, 2, 3])).toEqual([]);
  });
});

describe('Q34 offer → work lots (continuité numérique)', () => {
  it('groups non-excluded lines by zone/chapter with hour budgets', () => {
    const lots = offerToWorkLots(sampleOffer(), 9500); // CHF 95/h
    expect(lots).toHaveLength(2);
    expect(lots[0]).toMatchObject({ zoneLabel: 'Rez-de-chaussée', chapterCode: '511', lineIds: ['a1', 'a2'], budgetLabourCents: 54000, budgetHours: 5.68 });
    expect(lots[1]?.lineIds).toEqual(['a3']);
  });
});
