import { t } from '../i18n';

// Swiss conventions, same as the web app: dates 29.09.2026, durations 7:30, times 08:05.

const pad = (n: number) => String(n).padStart(2, '0');

/** Duration in minutes → 'h:mm' (450 → "7:30"). */
export function hours(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

/** Local time → 'HH:mm'. */
export function hhmm(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 'HH:MM:SS' elapsed since `from`. */
export function elapsed(from: Date, now = new Date()): string {
  const total = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** 'YYYY-MM-DD' (or an ISO string starting with it) → 'DD.MM.YYYY', without time-zone shift. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : t('state.notAvailable');
}

/** "Aujourd'hui" / "Hier" / "lun. 22.09.2026" for an entry date 'YYYY-MM-DD'. */
export function dayLabel(isoDate: string, now = new Date()): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return t('day.today');
  if (diff === 1) return t('day.yesterday');
  const wd = t('day.weekdays').split('|')[date.getDay()];
  return `${wd} ${pad(d)}.${pad(m)}.${y}`;
}

/** 'HH:MM:SS' → 'HH:MM' */
export function shortTime(time: string | null): string {
  return time ? time.slice(0, 5) : '…';
}
