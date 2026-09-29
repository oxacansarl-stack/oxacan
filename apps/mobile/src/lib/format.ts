export function hours(minutes: number): string {
  return `${(Math.max(0, minutes) / 60).toFixed(1)}h`;
}

export function hhmm(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 'HH:MM:SS' elapsed since `from`. */
export function elapsed(from: Date, now = new Date()): string {
  const total = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** 'Today' / 'Yesterday' / 'Mon 22.09' for an entry date 'YYYY-MM-DD'. */
export function dayLabel(isoDate: string, now = new Date()): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  return `${wd} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`;
}

/** 'HH:MM:SS' → 'HH:MM' */
export function shortTime(t: string | null): string {
  return t ? t.slice(0, 5) : '...';
}
