import { API_URL } from './config';
import { getAccessToken } from './supabase';

/* ── Envelope + error types ──────────────────────────────── */

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Envelope<T> {
  data: T;
  meta: Record<string, unknown> | null;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
}

/**
 * Thrown for every failed API call.
 * `status === 0` means the request never got an HTTP response (offline, DNS,
 * timeout) — the only case the offline queue retries.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly rule?: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.rule = typeof details?.rule === 'string' ? details.rule : undefined;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.isNetwork;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.isNetwork ? 'No connection to the server.' : err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/* ── 401 handling ────────────────────────────────────────── */

type UnauthorizedHandler = (path: string) => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Registered by the auth provider: a 401 anywhere signs the user out. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

/* ── Core request ────────────────────────────────────────── */

const TIMEOUT_MS = 15000;

async function request<T>(path: string, options: RequestInit = {}): Promise<Envelope<T>> {
  // Read the token on every call so replayed/queued requests use the current session.
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, signal: controller.signal });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
  } finally {
    clearTimeout(timer);
  }

  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    body = null;
  }

  if (!res.ok || body?.error) {
    const err = body?.error;
    const apiError = new ApiError(
      res.status,
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `Request failed (${res.status})`,
      err?.details,
    );
    if (res.status === 401 && onUnauthorized) onUnauthorized(path);
    throw apiError;
  }

  if (!body) throw new ApiError(res.status, 'BAD_RESPONSE', 'The server returned an invalid response.');
  return body;
}

/** Performs a request and returns the envelope's `data`. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const body = await request<T>(path, options);
  return body.data;
}

/** For list endpoints: returns `{ items, meta }`. */
export async function apiList<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ items: T[]; meta: PageMeta }> {
  const body = await request<T[]>(path, options);
  const items = Array.isArray(body.data) ? body.data : [];
  const m = (body.meta ?? {}) as Partial<PageMeta>;
  return {
    items,
    meta: {
      page: m.page ?? 1,
      limit: m.limit ?? items.length,
      total: m.total ?? items.length,
      totalPages: m.totalPages ?? 1,
    },
  };
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}
