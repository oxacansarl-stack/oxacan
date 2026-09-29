import { spawn, spawnSync, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { TEST_DB, TEST_PORT, COMPANY_A, COMPANY_B, USER_A, USER_B } from './setup';

const ROOT = join(__dirname, '../../..');
const API_DIR = join(__dirname, '..');
config({ path: join(ROOT, '.env') });

const admin = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_MIGRATION_USERNAME || process.env.DB_USERNAME,
  password: process.env.DB_MIGRATION_PASSWORD || process.env.DB_PASSWORD,
};

let server: ChildProcess | undefined;

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
  });

  server = spawn('node', ['dist/main.js'], {
    cwd: API_DIR,
    env: { ...process.env, DB_NAME: TEST_DB, PORT: String(TEST_PORT), NODE_ENV: 'test', SENTRY_DSN: '' },
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

export async function teardown() {
  server?.kill();
}
