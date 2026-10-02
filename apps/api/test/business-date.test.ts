import { describe, expect, it } from 'vitest';
import { businessDate } from '../src/common/util/business-date';

describe('business dates run on Europe/Zurich (PRD §23.5)', () => {
  it('after midnight Zurich the business day is already tomorrow in UTC terms', () => {
    // 23:30 UTC in summer = 01:30 Zurich next day; in winter = 00:30 next day.
    expect(businessDate(new Date('2026-07-15T23:30:00Z'))).toBe('2026-07-16');
    expect(businessDate(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
    // Before the boundary, both calendars agree.
    expect(businessDate(new Date('2026-07-15T12:00:00Z'))).toBe('2026-07-15');
    expect(businessDate(new Date('2026-01-15T22:30:00Z'))).toBe('2026-01-15');
  });
});
