export interface Session { token: string; role: string; tenantId: string; fullName: string; email: string; }
const KEY = 'oxacan.session';
export const session = {
  get(): Session | null { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; } },
  set(s: Session) { localStorage.setItem(KEY, JSON.stringify(s)); },
  clear() { localStorage.removeItem(KEY); },
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const s = session.get();
  const res = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...(s ? { authorization: `Bearer ${s.token}` } : {}), ...(init.headers ?? {}) } });
  if (res.status === 401) { session.clear(); location.assign('/login'); throw new Error('session expirée'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((typeof body.message === 'string' && body.message) || body.error || `HTTP ${res.status}`);
  return body as T;
}
export const chf = (cents: number) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: 'CHF', minimumFractionDigits: 2 }).format(cents / 100);
export const qty = (n: number | string) => Number(n).toLocaleString('fr-CH', { maximumFractionDigits: 3 });
