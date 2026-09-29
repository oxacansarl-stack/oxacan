import { getAccessToken, UNAUTHORIZED_EVENT } from './auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
}

function isEnvelope(v: unknown): v is Envelope<unknown> {
  return !!v && typeof v === 'object' && 'data' in v && 'error' in v;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<Envelope<T>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (res.status === 204) return { data: undefined as T, meta: {}, error: null };

  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON (e.g. CSV export) */
  }

  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const err = isEnvelope(body) ? body.error : null;
    throw new ApiError(
      res.status,
      err?.message || (typeof body === 'string' && body) || res.statusText,
      err?.code,
      err?.details,
    );
  }

  return isEnvelope(body) ? (body as Envelope<T>) : { data: body as T, meta: {}, error: null };
}

/** Returns the unwrapped `data` of the { data, meta, error } envelope. */
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  return (await request<T>(path, options)).data;
}

/** For paginated lists: returns the rows plus pagination meta. */
export async function apiList<T = unknown>(path: string): Promise<{ items: T[]; meta: PageMeta }> {
  const env = await request<T[]>(path);
  return { items: env.data ?? [], meta: env.meta as unknown as PageMeta };
}

/** Downloads a file endpoint (e.g. a PDF) with the caller's token, using the server's filename. */
export async function apiDownload(path: string, fallbackName = 'document.pdf'): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    const body = await res.json().catch(() => null);
    const err = isEnvelope(body) ? body.error : null;
    throw new ApiError(res.status, err?.message || res.statusText, err?.code, err?.details);
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const withBody = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body != null ? JSON.stringify(body) : undefined,
});

export const apiGet = <T = unknown>(path: string) => api<T>(path);
export const apiPost = <T = unknown>(path: string, body?: unknown) => api<T>(path, withBody('POST', body));
export const apiPut = <T = unknown>(path: string, body?: unknown) => api<T>(path, withBody('PUT', body));
export const apiPatch = <T = unknown>(path: string, body?: unknown) => api<T>(path, withBody('PATCH', body));
export const apiDelete = <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' });

/** @deprecated Use formatAmount / formatMoney from './format'. Kept so existing pages keep working. */
export { formatAmount as formatCHF } from './format';
