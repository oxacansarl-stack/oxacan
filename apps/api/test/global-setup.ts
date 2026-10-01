import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportJWK, generateKeyPair } from 'jose';
import { config } from 'dotenv';
import { Client } from 'pg';
import {
  TEST_DB, TEST_PORT, COMPANY_A, COMPANY_B, USER_A, USER_B,
  PM_A, TEAM_LEAD_A, WORKER_1_A, WORKER_2_A, TEAM_A,
  MOCK_SUPABASE_URL, MOCK_SUPABASE_PORT, MOCK_SUPABASE_KEY_FILE,
} from './setup';

const ROOT = join(__dirname, '../../..');
const API_DIR = join(__dirname, '..');
config({ path: join(ROOT, '.env') });

const admin = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_MIGRATION_USERNAME || process.env.DB_USERNAME,
  password: process.env.DB_MIGRATION_PASSWORD || process.env.DB_PASSWORD,
};

/** Service role key the spawned API sends to the mock Supabase Admin API (test-only value). */
const MOCK_SUPABASE_SERVICE_KEY = 'test-only-supabase-service-role-key';

let server: ChildProcess | undefined;
let jwksServer: Server | undefined;

async function withClient<T>(database: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ ...admin, database });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd = API_DIR) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
}

export async function setup() {
  await withClient('postgres', async (c) => {
    await c.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB],
    );
    await c.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await c.query(`CREATE DATABASE ${TEST_DB}`);
  });

  run('node', ['dist/config/run-migrations.js'], { DB_NAME: TEST_DB, NODE_ENV: 'test' });
  run(
    'psql',
    ['-q', '-h', admin.host!, '-p', String(admin.port), '-U', admin.user!, '-d', TEST_DB,
      '-v', `app_password=${process.env.DB_PASSWORD}`, '-f', join(ROOT, 'scripts/db/app-role.sql')],
    { PGPASSWORD: admin.password },
  );

  await withClient(TEST_DB, async (c) => {
    for (const [company, name, user, authId, email] of [
      [COMPANY_A, 'Test Bau A AG', USER_A.id, USER_A.authId, 'admin-a@test.local'],
      [COMPANY_B, 'Test Bau B AG', USER_B.id, USER_B.authId, 'admin-b@test.local'],
    ]) {
      await c.query(`INSERT INTO company (id, name) VALUES ($1, $2)`, [company, name]);
      await c.query(
        `INSERT INTO app_user (id, company_id, supabase_auth_id, email, first_name, last_name, role, licence_tier)
         VALUES ($1, $2, $3, $4, 'Test', 'Admin', 'ADMIN', 'saas')`,
        [user, company, authId, email],
      );
    }
    for (const [u, email] of [
      [PM_A, 'pm-a@test.local'],
      [TEAM_LEAD_A, 'lead-a@test.local'],
      [WORKER_1_A, 'worker1-a@test.local'],
      [WORKER_2_A, 'worker2-a@test.local'],
    ] as const) {
      await c.query(
        `INSERT INTO app_user (id, company_id, supabase_auth_id, email, first_name, last_name, role, licence_tier)
         VALUES ($1, $2, $3, $4, 'Test', $5, $5, 'saas')`,
        [u.id, COMPANY_A, u.authId, email, u.role],
      );
    }
    await c.query(`INSERT INTO team (id, company_id, name, leader_id) VALUES ($1, $2, 'Équipe Nord', $3)`, [
      TEAM_A,
      COMPANY_A,
      TEAM_LEAD_A.id,
    ]);
    await c.query(`INSERT INTO team_member (team_id, user_id, company_id) VALUES ($1, $2, $3)`, [
      TEAM_A,
      WORKER_1_A.id,
      COMPANY_A,
    ]);
  });

  jwksServer = await startMockSupabaseJwks();

  server = spawn('node', ['dist/main.js'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DB_NAME: TEST_DB,
      PORT: String(TEST_PORT),
      NODE_ENV: 'test',
      SENTRY_DSN: '',
      ALLOW_DEV_TOKENS: 'true',
      SUPABASE_URL: MOCK_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: MOCK_SUPABASE_SERVICE_KEY,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${TEST_PORT}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('API did not become healthy within 30s');
}

/** Serves a JWKS like Supabase Auth does, so ES256 session tokens can be verified end to end. */
async function startMockSupabaseJwks(): Promise<Server> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), alg: 'ES256', kid: 'test-key', use: 'sig' };
  writeFileSync(MOCK_SUPABASE_KEY_FILE, JSON.stringify({ ...(await exportJWK(privateKey)), alg: 'ES256', kid: 'test-key' }));
  const srv = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
    } else if (!handleMockAdminApi(req, res)) {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => srv.listen(MOCK_SUPABASE_PORT, resolve));
  return srv;
}

/*
 * Mock of the Supabase Auth invite endpoint (POST /auth/v1/invite), plus test controls:
 *   GET  /__mock/invites           every invite request received, in order
 *   POST /__mock/invite-failures   {"count": n}: the next n invites answer 500
 *   POST /__mock/confirm           {"email": e}: e has accepted; further invites answer 422
 * Like Supabase, re-inviting an unconfirmed email returns the same user id. Emails at
 * @already-registered.test answer 422 email_exists, at @rate-limited.test 429.
 */
const mockAuthUsers = new Map<string, { id: string; confirmed: boolean }>();
const mockInviteLog: { email: string; data: unknown; redirectTo: string | null; userId: string }[] = [];
let mockInviteFailures = 0;

function handleMockAdminApi(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', MOCK_SUPABASE_URL);
  const route = `${req.method} ${url.pathname}`;
  if (!['POST /auth/v1/invite', 'GET /__mock/invites', 'POST /__mock/invite-failures', 'POST /__mock/confirm'].includes(route)) {
    return false;
  }
  const json = (status: number, body?: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    let body: any = {};
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      return json(400, { code: 400, msg: 'invalid JSON' });
    }
    if (route === 'GET /__mock/invites') return json(200, { invites: mockInviteLog });
    if (route === 'POST /__mock/invite-failures') {
      mockInviteFailures = Number(body.count) || 0;
      return json(204);
    }
    if (route === 'POST /__mock/confirm') {
      const u = mockAuthUsers.get(String(body.email).toLowerCase());
      if (u) u.confirmed = true;
      return json(u ? 204 : 404);
    }

    // POST /auth/v1/invite
    if (req.headers.apikey !== MOCK_SUPABASE_SERVICE_KEY || req.headers.authorization !== `Bearer ${MOCK_SUPABASE_SERVICE_KEY}`) {
      return json(401, { code: 401, error_code: 'no_authorization', msg: 'This endpoint requires a valid service role key' });
    }
    if (mockInviteFailures > 0) {
      mockInviteFailures--;
      return json(500, { code: 500, error_code: 'unexpected_failure', msg: 'mock failure' });
    }
    const email = typeof body.email === 'string' ? body.email.toLowerCase() : '';
    if (!email) return json(400, { code: 400, error_code: 'validation_failed', msg: 'email is required' });
    if (email.endsWith('@rate-limited.test')) {
      return json(429, { code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' });
    }
    const existing = mockAuthUsers.get(email);
    if (email.endsWith('@already-registered.test') || existing?.confirmed) {
      return json(422, { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
    }
    const user = existing ?? { id: randomUUID(), confirmed: false };
    mockAuthUsers.set(email, user);
    mockInviteLog.push({ email, data: body.data ?? null, redirectTo: url.searchParams.get('redirect_to'), userId: user.id });
    return json(200, {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      invited_at: new Date().toISOString(),
      user_metadata: body.data ?? {},
    });
  });
  return true;
}

export async function teardown() {
  server?.kill();
  jwksServer?.close();
}
