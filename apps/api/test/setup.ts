import { join } from 'node:path';
import { config } from 'dotenv';
import jwt from 'jsonwebtoken';
import { Client } from 'pg';

config({ path: join(__dirname, '../../../.env') });

export const TEST_DB = 'oxacan_test';
export const TEST_PORT = 3101;
export const BASE_URL = `http://localhost:${TEST_PORT}`;

export const COMPANY_A = 'aaaaaaaa-0000-4000-8000-000000000001';
export const COMPANY_B = 'bbbbbbbb-0000-4000-8000-000000000001';
export const USER_A = { id: 'aaaaaaaa-0000-4000-8000-000000000002', authId: 'aaaaaaaa-0000-4000-8000-000000000003' };
export const USER_B = { id: 'bbbbbbbb-0000-4000-8000-000000000002', authId: 'bbbbbbbb-0000-4000-8000-000000000003' };

export function tokenFor(authId: string): string {
  return jwt.sign({ sub: authId }, process.env.JWT_SECRET!, { expiresIn: '15m' });
}

export interface ApiResult<T = any> {
  status: number;
  data: T;
  error: { code: string; message: string } | null;
  raw: any;
}

/** Calls the API and unwraps the { data, meta, error } envelope. */
export function apiClient(token?: string) {
  const call = async <T = any>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let raw: any = text;
    try {
      raw = JSON.parse(text);
    } catch {
      /* non-JSON body, e.g. CSV export */
    }
    const enveloped = raw && typeof raw === 'object' && 'data' in raw && 'error' in raw;
    return {
      status: res.status,
      data: enveloped ? raw.data : raw,
      error: enveloped ? raw.error : null,
      raw,
    };
  };
  return {
    get: <T = any>(p: string) => call<T>('GET', p),
    post: <T = any>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
    put: <T = any>(p: string, b?: unknown) => call<T>('PUT', p, b ?? {}),
    patch: <T = any>(p: string, b?: unknown) => call<T>('PATCH', p, b ?? {}),
    del: <T = any>(p: string) => call<T>('DELETE', p),
  };
}

/** Connects to the test DB as the non-superuser app role, so RLS policies apply. */
export async function appRoleClient(): Promise<Client> {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: TEST_DB,
  });
  await c.connect();
  return c;
}
