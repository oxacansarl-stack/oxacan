import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import { apiClient, appRoleClient, tokenFor, USER_A, USER_B, COMPANY_A, COMPANY_B } from './setup';

const a = apiClient(tokenFor(USER_A.authId));
const b = apiClient(tokenFor(USER_B.authId));

let clientA: string;
let projectA: string;

async function ok(p: Promise<{ status: number; data: any; error: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}

function list(data: any): any[] {
  return Array.isArray(data) ? data : data?.items ?? data?.data ?? [];
}

beforeAll(async () => {
  clientA = (await ok(a.post('/clients', { name: 'Tenant A private client' }))).id;
  const offer = await ok(a.post('/offers', { projectName: 'Tenant A project', clientId: clientA }));
  await ok(a.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
  await ok(a.patch(`/offers/${offer.id}/status`, { status: 'accepted' }));
  const contract = await ok(a.post('/contracts/from-offer', { offerId: offer.id }));
  await ok(a.patch(`/contracts/${contract.id}/status`, { status: 'signed' }));
  projectA = list(await ok(a.get('/projects'))).find((p: any) => p.contractId === contract.id).id;
});

describe('Tenant isolation over HTTP', () => {
  it('tenant B does not see tenant A clients in lists', async () => {
    const clients = list(await ok(b.get('/clients')));
    expect(clients.find((c: any) => c.id === clientA)).toBeUndefined();
  });

  it('tenant B cannot read tenant A records by id', async () => {
    expect((await b.get(`/clients/${clientA}`)).status).toBe(404);
    expect((await b.get(`/projects/${projectA}`)).status).toBe(404);
  });

  it('tenant B cannot modify tenant A records', async () => {
    const res = await b.patch(`/clients/${clientA}`, { name: 'hijacked' });
    expect(res.status).toBe(404);
    expect((await ok(a.get(`/clients/${clientA}`))).name).toBe('Tenant A private client');
  });

  it('tenant B cannot reference tenant A records in its own writes', async () => {
    const offer = await b.post('/offers', { projectName: 'Cross-tenant', clientId: clientA });
    expect(offer.status).toBeGreaterThanOrEqual(400);
    expect(offer.status).toBeLessThan(500);
    const token = await b.post('/portal/tokens', { projectId: projectA });
    expect(token.status).toBeGreaterThanOrEqual(400);
    expect(token.status).toBeLessThan(500);
  });

  it('tenant B does not see tenant A data in the company profile', async () => {
    expect((await ok(b.get('/companies/me'))).id).toBe(COMPANY_B);
  });
});

describe('Tenant isolation in the database (RLS as the app role)', () => {
  let db: Client;
  let tenantTables: string[];

  beforeAll(async () => {
    db = await appRoleClient();
    const { rows } = await db.query(
      `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t USING (table_schema, table_name)
       WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND t.table_type = 'BASE TABLE'
       ORDER BY 1`,
    );
    tenantTables = rows.map((r) => r.table_name);
  });

  afterAll(async () => {
    await db.end();
  });

  it('connects as a role that cannot bypass RLS', async () => {
    const { rows } = await db.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('every table with company_id has RLS enabled and forced', async () => {
    const { rows } = await db.query(
      `SELECT relname FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)
         AND NOT (relrowsecurity AND relforcerowsecurity)`,
      [tenantTables],
    );
    expect(tenantTables.length).toBeGreaterThan(40);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('without a tenant context no rows are visible', async () => {
    await db.query(`SELECT set_config('app.company_id', '', false), set_config('app.rls_bypass', 'off', false)`);
    for (const table of [...tenantTables, 'company']) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM "${table}"`);
      expect({ table, n: rows[0].n }).toEqual({ table, n: 0 });
    }
  });

  it('with tenant B context no tenant A row is visible in any table', async () => {
    await db.query(`SELECT set_config('app.company_id', $1, false)`, [COMPANY_B]);
    for (const table of tenantTables) {
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM "${table}" WHERE company_id = $1`,
        [COMPANY_A],
      );
      expect({ table, n: rows[0].n }).toEqual({ table, n: 0 });
    }
  });

  it('with tenant B context writing a tenant A row is rejected', async () => {
    await db.query(`SELECT set_config('app.company_id', $1, false)`, [COMPANY_B]);
    await expect(
      db.query(`INSERT INTO client (company_id, name) VALUES ($1, 'cross-tenant write')`, [COMPANY_A]),
    ).rejects.toThrow(/row-level security/);
  });
});
