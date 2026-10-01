import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  BASE_URL, COMPANY_A, PM_A, TEST_DB, USER_A, USER_B,
  apiClient, appRoleClient, setSignedContext, tokenFor,
} from './setup';
import {
  MAX_AUDIT_CHARS, REDACTED, REDACTED_IBAN, isValidIban, sanitiseForAudit,
} from '../src/modules/admin/audit-redaction';
import {
  PROTECTED_TABLES, RETENTION_RULES, applySql, previewSql,
} from '../src/modules/admin/retention.policy';

const API_DIR = join(__dirname, '..');
const admin = apiClient(tokenFor(USER_A.authId));
const pm = apiClient(tokenFor(PM_A.authId));
const adminB = apiClient(tokenFor(USER_B.authId));

/** Valid IBANs (mod-97): the standard Swiss example and a Swiss QR-IBAN. */
const CH_IBAN = 'CH93 0076 2011 6238 5295 7';
const QR_IBAN = 'CH44 3199 9123 0008 8901 2';

let db: Client;

async function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  await setSignedContext(db, '', '', 'on');
  return fn();
}

async function must<T = any>(p: Promise<{ status: number; data: T; error: any }>): Promise<T> {
  const r = await p;
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.error)}`);
  return r.data;
}

beforeAll(async () => {
  db = await appRoleClient();
});

afterAll(async () => {
  await db.end();
});

/* ─────────────── Redaction (pure) ─────────────── */
describe('audit body redaction', () => {
  it('redacts sensitive fields at any depth, including inside arrays', () => {
    const out = sanitiseForAudit({
      name: 'Bau AG',
      password: 'hunter2',
      nested: { accessToken: 't', clientSecret: 's', deep: { qrIban: 'x', IBAN: 'y', apiKey: 'k' } },
      signers: [{ name: 'A', signature: 'data:image/png;base64,xx' }],
      passwordConfirmation: null,
    });
    expect(out).toEqual({
      name: 'Bau AG',
      password: REDACTED,
      nested: { accessToken: REDACTED, clientSecret: REDACTED, deep: { qrIban: REDACTED, IBAN: REDACTED, apiKey: REDACTED } },
      signers: [{ name: 'A', signature: REDACTED }],
      passwordConfirmation: null,
    });
  });

  it('masks valid IBANs inside free text but keeps look-alike codes', () => {
    expect(isValidIban(CH_IBAN)).toBe(true);
    expect(isValidIban(QR_IBAN)).toBe(true);
    expect(isValidIban('CH93 0076 2011 6238 5295 8')).toBe(false);
    const out = sanitiseForAudit({
      notes: `Payer sur ${CH_IBAN} et ${QR_IBAN.replace(/ /g, '')} merci`,
      article: 'EN12345678901234',
    })!;
    expect(out.notes).toBe(`Payer sur ${REDACTED_IBAN} et ${REDACTED_IBAN} merci`);
    expect(out.article).toBe('EN12345678901234');
  });

  it('replaces binary data by its size and caps strings, arrays and the whole document', () => {
    expect(sanitiseForAudit(Buffer.alloc(1234))).toEqual({ _binary: true, bytes: 1234 });
    const long = sanitiseForAudit({ text: 'x'.repeat(10_000) })!;
    expect((long.text as string).length).toBeLessThan(2_100);
    const many = sanitiseForAudit({ lines: Array.from({ length: 500 }, (_, i) => i) })!;
    expect((many.lines as unknown[]).length).toBe(101);

    const huge = sanitiseForAudit(
      Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, 'y'.repeat(1_500)])),
    )!;
    expect(huge._truncated).toBe(true);
    expect(JSON.stringify(huge).length).toBeLessThan(MAX_AUDIT_CHARS);
  });

  it('survives circular and deeply nested bodies', () => {
    const a: any = { name: 'a' };
    a.self = a;
    expect(sanitiseForAudit(a)).toEqual({ name: 'a', self: '[Circular]' });
    let deep: any = { v: 1 };
    for (let i = 0; i < 20; i++) deep = { deep };
    expect(JSON.stringify(sanitiseForAudit(deep))).toContain('[Truncated]');
    expect(sanitiseForAudit(undefined)).toBeNull();
  });
});

/* ─────────────── Retention policy (pure) ─────────────── */
describe('retention policy', () => {
  it('never targets financial or legal records', () => {
    for (const t of ['invoice', 'invoice_line', 'payment', 'journal_entry', 'journal_entry_line', 'contract', 'audit_log']) {
      expect(PROTECTED_TABLES).toContain(t);
    }
    for (const rule of RETENTION_RULES) {
      expect(PROTECTED_TABLES).not.toContain(rule.table);
      expect(applySql(rule, false)).not.toMatch(/\b(invoice|journal_entry|payment)\b\s+(SET|WHERE)/);
    }
    // Users are anonymised, never deleted (their ids are referenced by accounting records).
    expect(RETENTION_RULES.filter((r) => r.table === 'app_user').map((r) => r.action)).toEqual(['anonymise']);
  });

  it('a company-scoped statement filters on $1', () => {
    for (const rule of RETENTION_RULES) {
      expect(previewSql(rule, true)).toContain('AND company_id = $1');
      expect(applySql(rule, true)).toContain('AND company_id = $1');
      expect(previewSql(rule, false)).not.toContain('$1');
    }
  });
});

/* ─────────────── Audit log writes ─────────────── */
async function auditRows(companyId: string, where: string, params: unknown[]) {
  return asSystem(async () =>
    (await db.query(`SELECT * FROM audit_log WHERE company_id = $1 AND ${where} ORDER BY created_at DESC`, [companyId, ...params])).rows,
  );
}

describe('audit log entries', () => {
  it('is written before the response, with IBANs in free text masked', async () => {
    const created = await must(admin.post('/clients', { name: `Audit ${randomUUID()}`, notes: `Compte ${CH_IBAN}` }));
    const rows = await auditRows(COMPANY_A, 'entity_id = $2', [created.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'CREATE', entity_type: 'clients', user_id: USER_A.id });
    expect(rows[0].new_values.notes).toBe(`Compte ${REDACTED_IBAN}`);
    expect(JSON.stringify(rows[0].new_values)).not.toContain('6238');
  });

  it('never stores the company IBAN', async () => {
    const before = await must(admin.get('/settings'));
    const since = new Date();
    try {
      await must(admin.put('/settings', { iban: QR_IBAN }));
      const rows = await auditRows(COMPANY_A, `entity_type = 'settings' AND created_at >= $2`, [since]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].new_values.iban).toBe(REDACTED);
      expect(JSON.stringify(rows.map((r) => r.new_values))).not.toContain('3199');
    } finally {
      await must(admin.put('/settings', { iban: before.iban ?? '' }));
    }
  });

  it('records the uploaded plan file by its metadata, not its bytes', async () => {
    const plan = await must(admin.post('/plans', { name: 'Audit plan', fileUrl: 'https://files.example.ch/a.pdf', fileType: 'pdf' }));
    const res = await fetch(`${BASE_URL}/plans/${plan.id}/file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenFor(USER_A.authId)}`, 'Content-Type': 'application/pdf' },
      body: Buffer.from('%PDF-1.7\naudit\n'),
    });
    expect(res.status).toBeLessThan(300);
    const rows = await auditRows(COMPANY_A, `entity_id = $2 AND new_values ? 'sha256'`, [plan.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].new_values).toEqual({ contentType: 'application/pdf', sizeBytes: 15, sha256: expect.any(String) });
  });
});

/* ─────────────── GET /admin/audit-log ─────────────── */
describe('GET /admin/audit-log', () => {
  let clientId = '';

  beforeAll(async () => {
    clientId = (await must(admin.post('/clients', { name: `Audit list ${randomUUID()}` }))).id;
    await must(admin.patch(`/clients/${clientId}`, { name: `Audit list renamed ${randomUUID()}` }));
  });

  it('is for admins only', async () => {
    expect((await pm.get('/admin/audit-log')).status).toBe(403);
    expect((await apiClient().get('/admin/audit-log')).status).toBe(401);
  });

  it('filters by entity and returns the acting user, newest first', async () => {
    const res = await admin.get(`/admin/audit-log?entityType=clients&entityId=${clientId}`);
    expect(res.status).toBe(200);
    expect(res.data.map((r: any) => r.action)).toEqual(['UPDATE', 'CREATE']);
    expect(res.data[0]).toMatchObject({ entityType: 'clients', entityId: clientId, userId: USER_A.id });
    expect(res.data[0].user).toMatchObject({ email: 'admin-a@test.local' });
    expect(res.raw.meta).toMatchObject({ page: 1, total: 2 });
  });

  it('filters by user and date, and paginates', async () => {
    const byPm = await admin.get(`/admin/audit-log?userId=${PM_A.id}&entityId=${clientId}`);
    expect(byPm.data).toEqual([]);
    const future = await admin.get(`/admin/audit-log?entityId=${clientId}&from=2099-01-01`);
    expect(future.data).toEqual([]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
    const day = await admin.get(`/admin/audit-log?entityId=${clientId}&from=${today}&to=${today}`);
    expect(day.data).toHaveLength(2);
    const page2 = await admin.get(`/admin/audit-log?entityId=${clientId}&limit=1&page=2`);
    expect(page2.data.map((r: any) => r.action)).toEqual(['CREATE']);
    expect(page2.raw.meta).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });
  });

  it('shows only the caller’s company and validates filters', async () => {
    expect((await adminB.get(`/admin/audit-log?entityId=${clientId}`)).data).toEqual([]);
    for (const q of ['entityId=nope', 'userId=1', 'from=2026-02-30', 'to=yesterday', "entityType=a';--"]) {
      const r = await admin.get(`/admin/audit-log?${q}`);
      expect(r.status, q).toBe(400);
    }
  });
});

/* ─────────────── Retention ─────────────── */
const C = {
  company: 'c0c0c0c0-0000-4000-8000-000000000001',
  admin: { id: 'c0c0c0c0-0000-4000-8000-000000000002', authId: 'c0c0c0c0-0000-4000-8000-000000000003' },
  oldLeaver: 'c0c0c0c0-0000-4000-8000-000000000012',
  recentLeaver: 'c0c0c0c0-0000-4000-8000-000000000022',
  client: 'c0c0c0c0-0000-4000-8000-000000000030',
  project: 'c0c0c0c0-0000-4000-8000-000000000031',
};
const D = {
  company: 'dddddddd-0000-4000-8000-000000000001',
  user: 'dddddddd-0000-4000-8000-000000000002',
  client: 'dddddddd-0000-4000-8000-000000000030',
};
const E = { company: 'eeeeeeee-0000-4000-8000-000000000001', user: 'eeeeeeee-0000-4000-8000-000000000002' };

function runRetention(...args: string[]) {
  const r = spawnSync('node', ['dist/config/run-retention.js', ...args], {
    cwd: API_DIR,
    env: { ...process.env, DB_NAME: TEST_DB, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`run-retention failed:\n${r.stdout}\n${r.stderr}`);
  const line = r.stdout.split('\n').find((l) => l.startsWith('{"retention"'));
  return JSON.parse(line!).retention as { dryRun: boolean; totalAffected: number; rules: { key: string; affected: number }[] };
}

const affected = (report: { rules: { key: string; affected: number }[] }) =>
  Object.fromEntries(report.rules.map((r) => [r.key, r.affected]));

describe('data retention', () => {
  const adminC = apiClient(tokenFor(C.admin.authId));

  beforeAll(async () => {
    await asSystem(async () => {
      for (const [id, name] of [[C.company, 'Retention C'], [D.company, 'Departed D'], [E.company, 'Leaving E']]) {
        await db.query(`INSERT INTO company (id, name) VALUES ($1, $2)`, [id, name]);
      }
      const user = (id: string, company: string, email: string, extra = '') =>
        db.query(
          `INSERT INTO app_user (id, company_id, supabase_auth_id, email, first_name, last_name, phone, role, licence_tier, hire_date${extra ? ', is_active, deactivated_at' : ''})
           VALUES ($1, $2, $3, $4, 'Real', 'Person', '+41 79 000 00 00', 'ADMIN', 'saas', '2010-01-01'${extra})`,
          [id, company, id === C.admin.id ? C.admin.authId : randomUUID(), email],
        );
      await user(C.admin.id, C.company, 'admin@c.test');
      await user(C.oldLeaver, C.company, 'old@c.test', `, false, now() - interval '11 years'`);
      await user(C.recentLeaver, C.company, 'recent@c.test', `, false, now() - interval '1 year'`);
      await user(D.user, D.company, 'admin@d.test');
      await user(E.user, E.company, 'admin@e.test');

      const notify = (u: string, read: boolean, age: string) =>
        db.query(
          `INSERT INTO notification (company_id, user_id, type, title, is_read, created_at)
           VALUES ($1, $2, 'test', 'Retention', $3, now() - $4::interval)`,
          [C.company, u, read, age],
        );
      await notify(C.oldLeaver, false, '1 day');
      await notify(C.admin.id, true, '200 days');
      await notify(C.admin.id, false, '400 days');
      await notify(C.admin.id, false, '10 days');

      await db.query(
        `INSERT INTO push_device (company_id, user_id, platform, device_token, is_active, last_used_at) VALUES
           ($1, $2, 'ios', 'tok-old-leaver', true, now()),
           ($1, $3, 'ios', 'tok-admin-off', false, now() - interval '100 days'),
           ($1, $3, 'android', 'tok-admin-on', true, now())`,
        [C.company, C.oldLeaver, C.admin.id],
      );
      await db.query(
        `INSERT INTO idempotency_key (company_id, user_id, key, method, path, request_hash, expires_at) VALUES
           ($1, $2, $3, 'POST', '/x', 'h', now() - interval '1 hour'),
           ($1, $2, $4, 'POST', '/x', 'h', now() + interval '1 hour')`,
        [C.company, C.admin.id, randomUUID(), randomUUID()],
      );
      await db.query(`INSERT INTO client (id, company_id, name) VALUES ($1, $2, 'Client C')`, [C.client, C.company]);
      await db.query(
        `INSERT INTO project (id, company_id, client_id, reference, name) VALUES ($1, $2, $3, 'RET-1', 'Retention project')`,
        [C.project, C.company, C.client],
      );
      await db.query(
        `INSERT INTO portal_token (company_id, project_id, token, expires_at) VALUES
           ($1, $2, $3, now() - interval '40 days'), ($1, $2, $4, now() + interval '40 days')`,
        [C.company, C.project, `ret-${randomUUID()}`, `ret-${randomUUID()}`],
      );

      // D left 100 days ago (past the 90-day export window), E 10 days ago (still inside it).
      for (const [company, days] of [[D.company, 100], [E.company, 10]] as const) {
        await db.query(
          `INSERT INTO subscription (company_id, stripe_customer_id, tier, status, cancelled_at)
           VALUES ($1, 'cus_test', 'equipe', 'cancelled', now() - make_interval(days => $2))`,
          [company, days],
        );
      }
      await db.query(
        `INSERT INTO client (id, company_id, name, contact_person, email, phone) VALUES ($1, $2, 'Client D SA', 'Jean Dupont', 'jean@d.test', '021 000 00 00')`,
        [D.client, D.company],
      );
      await db.query(
        `INSERT INTO client_contact (client_id, company_id, first_name, last_name, email) VALUES ($1, $2, 'Marie', 'Martin', 'marie@d.test')`,
        [D.client, D.company],
      );
    });
  });

  it('the dry-run endpoint reports what would change, for admins only', async () => {
    expect((await pm.get('/admin/retention/dry-run')).status).toBe(403);
    const res = await adminC.get('/admin/retention/dry-run');
    expect(res.status, JSON.stringify(res.error)).toBe(200);
    expect(res.data).toMatchObject({ dryRun: true, companyId: C.company });
    expect(res.data.protectedTables).toEqual(expect.arrayContaining(['invoice', 'journal_entry', 'payment']));
    expect(affected(res.data)).toEqual({
      'notification.anonymised_user': 1,
      'push_device.anonymised_user': 1,
      'app_user.anonymise': 1,
      'client_contact.departed_company': 0,
      'client.departed_company': 0,
      'portal_token.expired': 1,
      'notification.old': 2,
      'push_device.inactive': 1,
      'idempotency_key.expired': 1,
    });
    // Only the caller's company is counted.
    expect(Object.keys(res.data.byCompany)).toEqual([C.company]);
  });

  it('the script with --dry-run changes nothing', async () => {
    const report = runRetention('--dry-run', '--company', C.company);
    expect(report.dryRun).toBe(true);
    expect(report.totalAffected).toBe(8);
    const { rows } = await asSystem(() => db.query(`SELECT email, anonymised_at FROM app_user WHERE id = $1`, [C.oldLeaver]));
    expect(rows[0]).toEqual({ email: 'old@c.test', anonymised_at: null });
  });

  it('anonymises long-deactivated employees and purges expired technical data', async () => {
    const report = runRetention('--company', C.company);
    expect(report.dryRun).toBe(false);
    expect(report.totalAffected).toBe(8);

    await asSystem(async () => {
      const users = (await db.query(
        `SELECT id, email, first_name, last_name, phone, supabase_auth_id, hire_date, anonymised_at FROM app_user WHERE company_id = $1`,
        [C.company],
      )).rows;
      const old = users.find((u) => u.id === C.oldLeaver);
      expect(old).toMatchObject({
        email: `anonymised-${C.oldLeaver}@anonymised.invalid`, first_name: 'Utilisateur', last_name: 'Anonymisé',
        phone: null, supabase_auth_id: null, hire_date: null,
      });
      expect(old.anonymised_at).not.toBeNull();
      expect(users.find((u) => u.id === C.recentLeaver)).toMatchObject({ email: 'recent@c.test', anonymised_at: null });
      expect(users.find((u) => u.id === C.admin.id)).toMatchObject({ email: 'admin@c.test', anonymised_at: null });

      const left = async (sql: string) => (await db.query(sql, [C.company])).rows;
      expect(await left(`SELECT user_id, is_read FROM notification WHERE company_id = $1`)).toEqual([{ user_id: C.admin.id, is_read: false }]);
      expect((await left(`SELECT device_token FROM push_device WHERE company_id = $1`)).map((r) => r.device_token)).toEqual(['tok-admin-on']);
      expect(await left(`SELECT count(*)::int n FROM idempotency_key WHERE company_id = $1`)).toEqual([{ n: 1 }]);
      expect(await left(`SELECT count(*)::int n FROM portal_token WHERE company_id = $1`)).toEqual([{ n: 1 }]);

      const audit = await left(`SELECT user_id, new_values FROM audit_log WHERE company_id = $1 AND action = 'RETENTION'`);
      expect(audit).toHaveLength(1);
      expect(audit[0].new_values.rules).toMatchObject({ 'app_user.anonymise': 1, 'notification.old': 2 });
    });

    // Idempotent: nothing left to do.
    expect((await must(adminC.get('/admin/retention/dry-run'))).totalAffected).toBe(0);
  });

  it('anonymises a departed company after the 90-day export window, not before', async () => {
    expect(runRetention('--dry-run', '--company', E.company).totalAffected).toBe(0);

    const report = runRetention('--company', D.company);
    expect(affected(report)).toMatchObject({
      'app_user.anonymise': 1, 'client_contact.departed_company': 1, 'client.departed_company': 1,
    });
    await asSystem(async () => {
      const [u] = (await db.query(`SELECT email, is_active, anonymised_at FROM app_user WHERE id = $1`, [D.user])).rows;
      expect(u.email).toBe(`anonymised-${D.user}@anonymised.invalid`);
      expect(u.is_active).toBe(false);
      const [contact] = (await db.query(`SELECT first_name, last_name, email FROM client_contact WHERE client_id = $1`, [D.client])).rows;
      expect(contact).toEqual({ first_name: 'Contact', last_name: 'Anonymisé', email: null });
      const [client] = (await db.query(`SELECT name, contact_person, email, phone FROM client WHERE id = $1`, [D.client])).rows;
      expect(client).toEqual({ name: 'Client D SA', contact_person: null, email: null, phone: null });
      const [e] = (await db.query(`SELECT anonymised_at FROM app_user WHERE id = $1`, [E.user])).rows;
      expect(e.anonymised_at).toBeNull();
    });
  });

  it('the script rejects bad arguments', () => {
    const r = spawnSync('node', ['dist/config/run-retention.js', '--company', 'nope'], {
      cwd: API_DIR, env: { ...process.env, DB_NAME: TEST_DB }, encoding: 'utf8',
    });
    expect(r.status).toBe(1);
  });
});
