import { describe, it, expect, beforeAll } from 'vitest';
import {
  apiClient, tokenFor, createProject,
  USER_A, PM_A, TEAM_LEAD_A, WORKER_1_A, WORKER_2_A,
} from './setup';

const admin = apiClient(tokenFor(USER_A.authId));
const pm = apiClient(tokenFor(PM_A.authId));
const lead = apiClient(tokenFor(TEAM_LEAD_A.authId));
const worker1 = apiClient(tokenFor(WORKER_1_A.authId));
const worker2 = apiClient(tokenFor(WORKER_2_A.authId));

let projectId: string;
const entry: Record<string, string> = {};

async function clockedEntry(who: ReturnType<typeof apiClient>) {
  const inRes = await who.post('/timekeeping/clock-in', { projectId });
  expect(inRes.status, JSON.stringify(inRes.error)).toBe(201);
  const outRes = await who.post(`/timekeeping/clock-out/${inRes.data.id}`);
  expect(outRes.status, JSON.stringify(outRes.error)).toBeLessThan(300);
  const sub = await who.post('/timekeeping/submit', { entryIds: [inRes.data.id] });
  expect(sub.status, JSON.stringify(sub.error)).toBeLessThan(300);
  return inRes.data.id as string;
}

beforeAll(async () => {
  projectId = await createProject(admin, 'Chantier Permissions');
  entry.worker1 = await clockedEntry(worker1);
  entry.worker2 = await clockedEntry(worker2);
  entry.lead = await clockedEntry(lead);
});

describe('Role access (PRD §3.1–3.2)', () => {
  const officeOnly = ['/offers', '/clients', '/contracts', '/invoices', '/suppliers', '/purchase-orders', '/portal/tokens', '/hr/employees'];
  const adminOnlyRead = ['/accounting/accounts', '/accounting/trial-balance', '/subscription/seats'];

  it.each(officeOnly)('WORKER and TEAM_LEADER are denied GET %s', async (path) => {
    expect((await worker1.get(path)).status).toBe(403);
    expect((await lead.get(path)).status).toBe(403);
  });

  it.each(officeOnly)('PROJECT_MANAGER may GET %s', async (path) => {
    const res = await pm.get(path);
    expect(res.status, JSON.stringify(res.error)).toBe(200);
  });

  it.each(adminOnlyRead)('only ADMIN may GET %s', async (path) => {
    expect((await pm.get(path)).status).toBe(403);
    expect([200, 404]).toContain((await admin.get(path)).status);
  });

  it('PROJECT_MANAGER may export fiduciary data but not change settings or pay rates', async () => {
    expect((await pm.get('/accounting/export/fiduciary?from=2026-01-01&to=2026-12-31')).status).toBe(200);
    expect((await pm.put('/settings', { name: 'x' })).status).toBe(403);
    expect((await pm.put(`/hr/employees/${WORKER_1_A.id}`, { hourlyRateCents: 1 })).status).toBe(403);
  });

  it.each(['/auth/profile', '/companies/me', '/notifications', '/notifications/unread-count', '/projects', '/plans', '/timekeeping', '/timekeeping/summary/weekly', '/expenses', '/daily-reports'])(
    'WORKER may GET %s',
    async (path) => {
      const res = await worker1.get(path);
      expect(res.status, JSON.stringify(res.error)).toBe(200);
    },
  );

  it('WORKER and TEAM_LEADER do not see project financials', async () => {
    for (const who of [worker1, lead]) {
      const list = (await who.get('/projects')).data;
      const detail = (await who.get(`/projects/${projectId}`)).data;
      expect(JSON.stringify([list, detail])).not.toMatch(/Cents"/);
    }
    expect(JSON.stringify((await pm.get(`/projects/${projectId}`)).data)).toMatch(/Cents"/);
  });

  it('TEAM_LEADER may run site meetings and view stock; WORKER may not', async () => {
    expect((await lead.get('/meetings')).status).toBe(200);
    expect((await lead.get('/stock/items')).status).toBe(200);
    expect((await worker1.get('/meetings')).status).toBe(403);
    expect((await worker1.post('/stock/movements', {})).status).toBe(403);
  });

  it('WORKER cannot create clients or approve hours', async () => {
    expect((await worker1.post('/clients', { name: 'x' })).status).toBe(403);
    expect((await worker1.post('/timekeeping/approve', { entryIds: [entry.worker2] })).status).toBe(403);
  });
});

describe('Field data scoping', () => {
  it('WORKER sees only their own time entries', async () => {
    const rows: any[] = (await worker1.get('/timekeeping?limit=100')).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.userId === WORKER_1_A.id)).toBe(true);
    expect((await worker1.get(`/timekeeping/${entry.worker2}`)).status).toBe(404);
  });

  it('WORKER cannot read another user weekly summary', async () => {
    const res = await worker1.get(`/timekeeping/summary/weekly?userId=${WORKER_2_A.id}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.data)).not.toContain(entry.worker2);
  });

  it('TEAM_LEADER sees own and team members entries, not outsiders', async () => {
    const rows: any[] = (await lead.get('/timekeeping?limit=100')).data;
    const users = new Set(rows.map((r) => r.userId));
    expect(users.has(WORKER_1_A.id)).toBe(true);
    expect(users.has(TEAM_LEAD_A.id)).toBe(true);
    expect(users.has(WORKER_2_A.id)).toBe(false);
  });

  it('TEAM_LEADER may approve team members but not outsiders or themselves', async () => {
    expect((await lead.post('/timekeeping/approve', { entryIds: [entry.worker2] })).status).toBe(403);
    expect((await lead.post('/timekeeping/approve', { entryIds: [entry.lead] })).status).toBe(403);
    const ok = await lead.post('/timekeeping/approve', { entryIds: [entry.worker1] });
    expect(ok.status, JSON.stringify(ok.error)).toBeLessThan(300);
    expect((await admin.get(`/timekeeping/${entry.worker1}`)).data.status).toBe('approved');
  });

  it('PROJECT_MANAGER may approve anyone, including the team leader', async () => {
    const res = await pm.post('/timekeeping/approve', { entryIds: [entry.lead, entry.worker2] });
    expect(res.status, JSON.stringify(res.error)).toBeLessThan(300);
  });

  it('WORKER sees only their own expenses', async () => {
    const mine = await worker1.post('/expenses', {
      projectId, date: '2026-09-29', category: 'material', description: 'Vis', amountCents: 1200,
    });
    expect(mine.status, JSON.stringify(mine.error)).toBe(201);
    const theirs = await worker2.post('/expenses', {
      projectId, date: '2026-09-29', category: 'travel', description: 'Train', amountCents: 800,
    });
    const rows: any[] = (await worker1.get('/expenses?limit=100')).data;
    expect(rows.every((r) => r.userId === WORKER_1_A.id)).toBe(true);
    expect((await worker1.get(`/expenses/${theirs.data.id}`)).status).toBe(404);
  });
});

describe('Input validation', () => {
  it('rejects a body missing required fields', async () => {
    const res = await admin.post('/clients', {});
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown fields', async () => {
    const res = await admin.post('/clients', { name: 'Valid', isAdmin: true });
    expect(res.status).toBe(400);
  });

  it('rejects wrong types and negative amounts', async () => {
    expect((await admin.post('/offers', { projectName: 'x', clientId: 'not-a-uuid' })).status).toBe(400);
    expect(
      (await worker1.post('/expenses', { projectId, date: '2026-09-29', category: 'material', description: 'x', amountCents: -5 })).status,
    ).toBe(400);
    expect(
      (await worker1.post('/expenses', { projectId, date: '29.09.2026', category: 'material', description: 'x', amountCents: 5 })).status,
    ).toBe(400);
  });

  it('rejects invoices without lines and journal entries with malformed lines', async () => {
    const clients: any[] = (await admin.get('/clients')).data;
    expect(
      (await admin.post('/invoices', { projectId, clientId: clients[0].id, type: 'invoice', lines: [] })).status,
    ).toBe(400);
    expect(
      (await admin.post('/accounting/entries', { entryDate: '2026-09-29', description: 'x', lines: [{ accountId: 'x' }] })).status,
    ).toBe(400);
  });

  it('rejects enum values outside the allowed set before hitting the database', async () => {
    const res = await admin.post('/offers', { projectName: 'x', clientId: (await admin.get('/clients')).data[0].id, marginFactor: 'high' });
    expect(res.status).toBe(400);
  });
});

describe('List response shape', () => {
  it.each(['/clients', '/offers', '/projects', '/catalogue/articles', '/invoices', '/timekeeping', '/suppliers'])(
    'GET %s returns data as an array with pagination meta',
    async (path) => {
      const res = await admin.get(path);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
      expect(typeof res.raw.meta.total).toBe('number');
      expect(typeof res.raw.meta.page).toBe('number');
      expect(typeof res.raw.meta.limit).toBe('number');
    },
  );
});
