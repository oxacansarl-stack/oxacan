// TODO: wire up Supabase Auth — replace localStorage token with Supabase session token
// For now, reads a JWT from localStorage('oxacan_token') for Authorization header.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  try {
    return localStorage.getItem('oxacan_token');
  } catch {
    return null;
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    let message: string;
    try {
      const json = JSON.parse(body);
      message = json.message || json.error || res.statusText;
    } catch {
      message = body || res.statusText;
    }
    throw new ApiError(res.status, message);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

// Convenience methods
export const apiGet = <T = unknown>(path: string) => api<T>(path);

export const apiPost = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'POST',
    body: body != null ? JSON.stringify(body) : undefined,
  });

export const apiPut = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, {
    method: 'PUT',
    body: body != null ? JSON.stringify(body) : undefined,
  });

export const apiDelete = <T = unknown>(path: string) =>
  api<T>(path, { method: 'DELETE' });

/** Format centimes to CHF string (e.g. 12345 → "123.45") */
export function formatCHF(centimes: number): string {
  return (centimes / 100).toFixed(2);
}
