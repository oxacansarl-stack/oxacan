/**
 * Business dates (PRD §23.5): the company's day runs on Europe/Zurich, wherever the server or
 * the device sits. A DATE column written from `new Date().toISOString()` holds the UTC day,
 * which between midnight and 01:00/02:00 Zurich is YESTERDAY — wrong on an invoice, a task
 * completion or a week boundary. Use these helpers for every business-day value.
 */
export const APP_TIME_ZONE = 'Europe/Zurich';

const DAY = new Intl.DateTimeFormat('sv-SE', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Zurich calendar date of an instant, as YYYY-MM-DD. */
export function businessDate(at: Date = new Date()): string {
  return DAY.format(at);
}

/** Today in Zurich, as YYYY-MM-DD. */
export const todayInZurich = (): string => businessDate();
