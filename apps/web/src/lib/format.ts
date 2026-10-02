import i18n from '../i18n';

// Swiss business conventions, shared by every page: CHF 1’234.50 and 29.09.2026.
const amount = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 3 });
const dateFmt = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('de-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Zurich',
});

/** 123456 centimes → "1’234.56" (no currency). */
export function formatAmount(cents: number | null | undefined): string {
  return amount.format((cents ?? 0) / 100);
}

/** 123456 centimes → "CHF 1’234.56". */
export function formatMoney(cents: number | null | undefined): string {
  return `CHF ${formatAmount(cents)}`;
}

export function formatNumber(value: number | null | undefined): string {
  return value == null ? '—' : decimal.format(value);
}

/** "2026-09-29" or an ISO timestamp → "29.09.2026". Date-only strings are not shifted by time zone. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}.${m}.${y}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFmt.format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFmt.format(date);
}

/**
 * Today's date in Switzerland as YYYY-MM-DD.
 *
 * `new Date().toISOString().slice(0, 10)` gives the UTC date, so between midnight and
 * 01:00 (02:00 in summer) Swiss time it returns YESTERDAY — a daily report, expense or
 * payment filed late in the evening would be dated a day early. The business day is
 * Europe/Zurich regardless of where the user's device is (PRD §23.5); 'sv-SE' formats
 * as YYYY-MM-DD.
 */
const isoDateInZurich = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' });

export function todayIso(): string {
  return isoDateInZurich.format(new Date());
}

/** 450 → "7:30". */
export function formatMinutes(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(minutes ?? 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Translated label for a DB status value, e.g. statusLabel('invoice', 'paid') → "Payée". */
export function statusLabel(domain: string, value: string | null | undefined): string {
  if (!value) return '—';
  return i18n.t(`status.${domain}.${value}`, { ns: 'common', defaultValue: value });
}

/** Translated label for a DB enum value, e.g. enumLabel('expenseCategory', 'travel') → "Déplacement". */
export function enumLabel(group: string, value: string | null | undefined): string {
  if (!value) return '—';
  return i18n.t(`enum.${group}.${value}`, { ns: 'common', defaultValue: value });
}
