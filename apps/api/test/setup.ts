import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { config } from 'dotenv';
import jwt from 'jsonwebtoken';
import { Client } from 'pg';

config({ path: join(__dirname, '../../../.env') });

export const MOCK_SUPABASE_PORT = 3199;
export const MOCK_SUPABASE_URL = `http://localhost:${MOCK_SUPABASE_PORT}`;
export const MOCK_SUPABASE_KEY_FILE = join(tmpdir(), 'oxacan-test-supabase-key.json');

export const TEST_DB = 'oxacan_test';
export const TEST_PORT = 3101;
export const BASE_URL = `http://localhost:${TEST_PORT}`;

export const COMPANY_A = 'aaaaaaaa-0000-4000-8000-000000000001';
export const COMPANY_B = 'bbbbbbbb-0000-4000-8000-000000000001';
export const USER_A = { id: 'aaaaaaaa-0000-4000-8000-000000000002', authId: 'aaaaaaaa-0000-4000-8000-000000000003' };
export const USER_B = { id: 'bbbbbbbb-0000-4000-8000-000000000002', authId: 'bbbbbbbb-0000-4000-8000-000000000003' };

// Company A staff, one per role. TEAM_LEAD leads TEAM_A, which contains WORKER_1 but not WORKER_2.
export const PM_A = { id: 'aaaaaaaa-0000-4000-8000-000000000012', authId: 'aaaaaaaa-0000-4000-8000-000000000013', role: 'PROJECT_MANAGER' };
export const TEAM_LEAD_A = { id: 'aaaaaaaa-0000-4000-8000-000000000022', authId: 'aaaaaaaa-0000-4000-8000-000000000023', role: 'TEAM_LEADER' };
export const WORKER_1_A = { id: 'aaaaaaaa-0000-4000-8000-000000000032', authId: 'aaaaaaaa-0000-4000-8000-000000000033', role: 'WORKER' };
export const WORKER_2_A = { id: 'aaaaaaaa-0000-4000-8000-000000000042', authId: 'aaaaaaaa-0000-4000-8000-000000000043', role: 'WORKER' };
export const TEAM_A = 'aaaaaaaa-0000-4000-8000-000000000050';

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

/** Runs offer → accept → contract → sign as an office user and returns the created project id. */
export async function createProject(api: ReturnType<typeof apiClient>, name: string): Promise<string> {
  const must = async (p: Promise<ApiResult>) => {
    const r = await p;
    if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.error)}`);
    return r.data;
  };
  const client = await must(api.post('/clients', { name: `${name} client` }));
  const offer = await must(api.post('/offers', { projectName: name, clientId: client.id }));
  await must(api.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
  await must(api.patch(`/offers/${offer.id}/status`, { status: 'accepted' }));
  const contract = await must(api.post('/contracts/from-offer', { offerId: offer.id }));
  await must(api.patch(`/contracts/${contract.id}/status`, { status: 'signed' }));
  const projects: any[] = await must(api.get('/projects?limit=100'));
  return projects.find((p) => p.contractId === contract.id).id;
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
