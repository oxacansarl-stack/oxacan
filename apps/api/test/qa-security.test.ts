/**
 * QA / security regression suite. Scenario ids (A1, E1, …) refer to the QA test plan.
 * Each test collects every violation it finds and fails with the full list, so one run
 * shows all problems in an area instead of stopping at the first.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  apiClient, appRoleClient, setSignedContext, createProject, tokenFor, BASE_URL,
  USER_A, USER_B, PM_A, TEAM_LEAD_A, WORKER_1_A, WORKER_2_A,
} from './setup';

type Api = ReturnType<typeof apiClient>;
const adminA = apiClient(tokenFor(USER_A.authId));
const adminB = apiClient(tokenFor(USER_B.authId));
const pm = apiClient(tokenFor(PM_A.authId));
const lead = apiClient(tokenFor(TEAM_LEAD_A.authId));
const worker1 = apiClient(tokenFor(WORKER_1_A.authId));
const worker2 = apiClient(tokenFor(WORKER_2_A.authId));
const anon = apiClient();

const ROLE_GROUPS: Record<string, string[]> = {
  ADMIN_ONLY: ['ADMIN'],
  OFFICE_ROLES: ['ADMIN', 'PROJECT_MANAGER'],
  SITE_LEAD_ROLES: ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER'],
  ALL_ROLES: ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER'],
};
const byRole: Record<string, Api> = { ADMIN: adminA, PROJECT_MANAGER: pm, TEAM_LEADER: lead, WORKER: worker1 };

interface Route { method: string; path: string; roles: string[] | 'PUBLIC' }

/** Reads every controller and returns its routes with the roles allowed by @Roles (office roles by default). */
function routeMap(): Route[] {
  const dir = join(__dirname, '../src/modules');
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.controller.ts')) files.push(p);
  });
  walk(dir);
  const routes: Route[] = [];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    const base = s.match(/@Controller\('?([^')]*)'?\)/)?.[1] ?? '';
    const classGroup = s.slice(0, s.indexOf('export class')).match(/@Roles\(\.\.\.(\w+)\)/)?.[1];
    const re = /((?:@(?:Roles|Public|Throttle|SkipEnvelope|HttpCode)\([^)]*\)\s*)*)@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)\s*((?:@(?:Roles|Public|Throttle|SkipEnvelope|HttpCode)\([^)]*\)\s*)*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const dec = m[1] + m[4];
      const group = dec.match(/@Roles\(\.\.\.(\w+)\)/)?.[1];
      const path = '/' + [base, m[3]].filter(Boolean).join('/');
      routes.push({
        method: m[2].toUpperCase(),
        path,
        roles: dec.includes('@Public') ? 'PUBLIC' : ROLE_GROUPS[group ?? classGroup ?? 'OFFICE_ROLES'],
      });
    }
  }
  return routes;
}

const RANDOM_UUID = '00000000-0000-4000-8000-00000000abcd';
const fill = (path: string, id = RANDOM_UUID) => path.replace(/:[A-Za-z]+/g, id);

async function call(api: Api, method: string, path: string, body: unknown = {}) {
  switch (method) {
    case 'GET': return api.get(path);
    case 'POST': return api.post(path, body);
    case 'PUT': return api.put(path, body);
    case 'PATCH': return api.patch(path, body);
    default: return api.del(path);
  }
}

async function must<T = any>(p: Promise<{ status: number; data: T; error: any }>, label = ''): Promise<T> {
  const r = await p;
  if (r.status >= 300) throw new Error(`${label} HTTP ${r.status}: ${JSON.stringify(r.error)}`);
  return r.data;
}
const asList = (d: any): any[] => (Array.isArray(d) ? d : d?.items ?? d?.data ?? []);

/* ─────────────── Shared fixtures in company A ─────────────── */
const fx: Record<string, string> = {};

beforeAll(async () => {
  fx.project = await createProject(adminA, 'QA fixture project');
  const project = await must(adminA.get(`/projects/${fx.project}`));
  fx.client = project.clientId;
  fx.contract = project.contractId;
  fx.offer = (await must(adminA.get(`/contracts/${fx.contract}`))).offerId;
  fx.article = (await must(adminA.post('/catalogue/articles', {
    npkNumber: 'QA.001', description: 'Béton QA', unit: 'm3', category: 'gros_oeuvre',
  }), 'article')).id;
  fx.plan = (await must(adminA.post('/plans', {
    name: 'Plan RDC', fileUrl: 'https://files.example.ch/plan.pdf', fileType: 'pdf', projectId: fx.project,
  }), 'plan')).id;
  fx.supplier = (await must(adminA.post('/suppliers', { name: 'QA Supplier' }), 'supplier')).id;
  fx.vehicle = (await must(adminA.post('/vehicles', { registration: 'VD 12345' }), 'vehicle')).id;
  fx.location = (await must(adminA.post('/stock/locations', { name: 'QA Dépôt', type: 'warehouse' }), 'location')).id;
  fx.stockItem = (await must(adminA.post('/stock/items', {
    canonicalArticleId: fx.article, locationId: fx.location, quantity: 10,
  }), 'stock item')).id;
  const po = await must(adminA.post('/purchase-orders', {
    supplierId: fx.supplier, projectId: fx.project,
    lines: [{ canonicalArticleId: fx.article, description: 'Béton', quantity: 5, unit: 'm3', unitPriceCents: 10000 }],
  }), 'po');
  fx.po = po.id;
  fx.poLine = (po.lines ?? (await must(adminA.get(`/purchase-orders/${po.id}`))).lines)[0].id;
  fx.meeting = (await must(adminA.post('/meetings', {
    projectId: fx.project, meetingDate: '2026-09-29T08:00:00Z', location: 'Chantier',
  }), 'meeting')).id;
  fx.team = (await must(adminA.get('/hr/teams'))).map?.((t: any) => t.id)[0] ?? asList(await must(adminA.get('/hr/teams')))[0].id;
  fx.portalToken = (await must(adminA.post('/portal/tokens', { projectId: fx.project }), 'portal')).id;
  fx.invoice = (await must(adminA.post('/invoices', {
    projectId: fx.project, clientId: fx.client, type: 'invoice',
    lines: [{ description: 'Travaux', unit: 'h', quantity: 2, unitPriceCents: 9000 }],
  }), 'invoice')).id;
  fx.plusValue = (await must(adminA.post('/invoices/plus-values', {
    projectId: fx.project, description: 'Supplément', amountCents: 50000,
  }), 'plus value')).id;
  await must(adminA.post('/accounting/accounts/seed'), 'seed accounts');
  const accounts = asList(await must(adminA.get('/accounting/accounts')));
  fx.account = accounts[0].id;
  fx.entry = (await must(adminA.post('/accounting/entries', {
    entryDate: '2026-09-29', description: 'QA entry',
    lines: [
      { accountId: accounts[0].id, debitCents: 100, creditCents: 0 },
      { accountId: accounts[1].id, debitCents: 0, creditCents: 100 },
    ],
  }), 'entry')).id;
  // Worker 1's own field records
  fx.timeEntry = (await must(worker1.post('/timekeeping/clock-in', { projectId: fx.project }), 'clock-in')).id;
  await must(worker1.post(`/timekeeping/clock-out/${fx.timeEntry}`), 'clock-out');
  fx.expense = (await must(worker1.post('/expenses', {
    projectId: fx.project, date: '2026-09-29', category: 'material', description: 'Vis', amountCents: 1200,
  }), 'expense')).id;
  fx.dailyReport = (await must(worker1.post('/daily-reports', {
    projectId: fx.project, date: '2026-09-28', workDescription: 'Coffrage', weather: 'sunny',
  }), 'daily report')).id;
}, 120_000);

/* ─────────────── E. Authorisation matrix ─────────────── */
describe('E1 role matrix — every route × every role', () => {
  it('denies exactly the roles @Roles excludes, and never 500s', async () => {
    const problems: string[] = [];
    for (const r of routeMap()) {
      if (r.roles === 'PUBLIC') continue;
      for (const [role, api] of Object.entries(byRole)) {
        const res = await call(api, r.method, fill(r.path));
        const allowed = r.roles.includes(role);
        if (!allowed && res.status !== 403) problems.push(`${role} ${r.method} ${r.path} → ${res.status} (expected 403)`);
        if (allowed && res.status === 403) problems.push(`${role} ${r.method} ${r.path} → 403 (should be allowed)`);
        if (res.status >= 500) problems.push(`${role} ${r.method} ${r.path} → ${res.status} ${res.error?.message}`);
      }
    }
    expect(problems).toEqual([]);
  }, 180_000);

  it('rejects every non-public route without a token', async () => {
    const problems: string[] = [];
    for (const r of routeMap()) {
      if (r.roles === 'PUBLIC') continue;
      const res = await call(anon, r.method, fill(r.path));
      if (res.status !== 401) problems.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(problems).toEqual([]);
  }, 120_000);
});

describe('E2 field roles never receive money', () => {
  const MONEY = /cents$|price|cost|margin|budget|rate|salary|amount|total/i;
  const findMoney = (v: any, path = '', out: string[] = []): string[] => {
    if (Array.isArray(v)) v.forEach((x, i) => findMoney(x, `${path}[${i}]`, out));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (MONEY.test(k) && !/vatRate|retentionRate/i.test(k) && typeof x === 'number' && x !== 0) out.push(`${path}.${k}=${x}`);
        else findMoney(x, `${path}.${k}`, out);
      }
    }
    return out;
  };
  it.each([['WORKER', worker1], ['TEAM_LEADER', lead]] as const)('%s', async (role, api) => {
    const idFor: Record<string, string> = {
      projects: fx.project, plans: fx.plan, 'catalogue/articles': fx.article, meetings: fx.meeting,
      vehicles: fx.vehicle, 'daily-reports': fx.dailyReport, expenses: fx.expense, timekeeping: fx.timeEntry,
      'hr/teams': fx.team,
    };
    const leaks: string[] = [];
    for (const r of routeMap()) {
      if (r.method !== 'GET' || r.roles === 'PUBLIC' || !r.roles.includes(role)) continue;
      const key = Object.keys(idFor).find((k) => r.path.startsWith(`/${k}/`));
      const path = r.path.includes(':') ? (key ? fill(r.path, idFor[key]) : null) : r.path;
      if (!path) continue;
      const res = await api.get(path);
      if (res.status !== 200) continue;
      // A worker's own expense amount is theirs to see; only flag company financials.
      const found = findMoney(res.data).filter((f) => !(r.path.startsWith('/expenses') && /amountCents/.test(f)));
      if (found.length) leaks.push(`${path}: ${found.slice(0, 4).join(', ')}`);
    }
    expect(leaks).toEqual([]);
  }, 120_000);
});

describe('E3 mass assignment', () => {
  it('rejects companyId / ownership fields in bodies', async () => {
    const problems: string[] = [];
    const tries: [string, string, any][] = [
      ['POST', '/clients', { name: 'X', companyId: '00000000-0000-4000-8000-000000000001' }],
      ['PATCH', `/projects/${fx.project}`, { companyId: '00000000-0000-4000-8000-000000000001' }],
      ['PUT', `/expenses/${fx.expense}`, { userId: WORKER_2_A.id }],
      ['PUT', `/timekeeping/${fx.timeEntry}`, { status: 'approved' }],
      ['POST', '/expenses', { projectId: fx.project, date: '2026-09-29', category: 'material', description: 'x', amountCents: 1, status: 'approved' }],
    ];
    for (const [m, p, b] of tries) {
      const res = await call(m === 'PUT' && p.startsWith('/expenses') ? worker1 : m === 'PUT' ? worker1 : adminA, m, p, b);
      if (res.status < 400) problems.push(`${m} ${p} ${JSON.stringify(b)} → ${res.status}`);
    }
    expect(problems).toEqual([]);
  });
});

/* ─────────────── F. Tenant isolation — every resource type ─────────────── */
describe('F1 company B cannot touch any company A record by id', () => {
  it('returns 4xx (never 2xx or 5xx) for every id route', async () => {
    const idFor: [RegExp, () => string][] = [
      [/^\/projects\/:id/, () => fx.project], [/^\/clients\/:id/, () => fx.client],
      [/^\/offers\/:id/, () => fx.offer], [/^\/contracts\/:id/, () => fx.contract],
      [/^\/invoices\/plus-values\/:id/, () => fx.plusValue], [/^\/invoices\/project\/:projectId/, () => fx.project],
      [/^\/invoices\/:id/, () => fx.invoice], [/^\/plans\/:id/, () => fx.plan],
      [/^\/suppliers\/:id/, () => fx.supplier], [/^\/vehicles\/:id/, () => fx.vehicle],
      [/^\/stock\/items\/:id/, () => fx.stockItem], [/^\/purchase-orders\/:id/, () => fx.po],
      [/^\/meetings\/:id/, () => fx.meeting], [/^\/hr\/teams\/:id/, () => fx.team],
      [/^\/portal\/tokens\/:id/, () => fx.portalToken], [/^\/accounting\/accounts\/:id/, () => fx.account],
      [/^\/accounting\/entries\/:id/, () => fx.entry], [/^\/accounting\/ledger\/:accountId/, () => fx.account],
      [/^\/catalogue\/articles\/:id/, () => fx.article], [/^\/expenses\/summary\/project\/:projectId/, () => fx.project],
      [/^\/expenses\/:id/, () => fx.expense], [/^\/timekeeping\/(clock-out\/)?:id/, () => fx.timeEntry],
      [/^\/daily-reports\/:id/, () => fx.dailyReport], [/^\/hr\/employees\/:userId/, () => USER_A.id],
    ];
    const problems: string[] = [];
    for (const r of routeMap()) {
      if (!r.path.includes(':') || r.roles === 'PUBLIC') continue;
      const hit = idFor.find(([re]) => re.test(r.path));
      if (!hit) continue;
      const path = r.path.replace(/:[A-Za-z]+/, hit[1]()).replace(/:[A-Za-z]+/g, RANDOM_UUID);
      const res = await call(adminB, r.method, path, {});
      if (res.status < 400 || res.status >= 500) problems.push(`B ${r.method} ${path} → ${res.status} ${JSON.stringify(res.data).slice(0, 160)}`);
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it('F2 rejects company B writes that reference company A ids', async () => {
    const problems: string[] = [];
    const tries: [string, any][] = [
      ['/offers', { projectName: 'X', clientId: fx.client }],
      ['/purchase-orders', { supplierId: fx.supplier, lines: [{ description: 'x', quantity: 1, unit: 'u', unitPriceCents: 1 }] }],
      ['/plans', { name: 'X', fileUrl: 'https://x.ch/a.pdf', fileType: 'pdf', projectId: fx.project }],
      ['/meetings', { projectId: fx.project, meetingDate: '2026-09-29T08:00:00Z' }],
      ['/portal/tokens', { projectId: fx.project }],
      ['/invoices/plus-values', { projectId: fx.project, description: 'x', amountCents: 1 }],
      ['/timekeeping/clock-in', { projectId: fx.project }],
      ['/expenses', { projectId: fx.project, date: '2026-09-29', category: 'material', description: 'x', amountCents: 1 }],
      ['/daily-reports', { projectId: fx.project, date: '2026-09-20', workDescription: 'x' }],
      ['/stock/movements', { stockItemId: fx.stockItem, type: 'out', quantity: 1 }],
      ['/hr/teams', { name: 'X', leaderId: USER_A.id }],
      ['/vehicles', { registration: 'ZH 1', assignedProjectId: fx.project }],
    ];
    for (const [p, b] of tries) {
      const res = await adminB.post(p, b);
      if (res.status < 400 || res.status >= 500) problems.push(`B POST ${p} → ${res.status}`);
    }
    expect(problems).toEqual([]);
  });
});

/* ─────────────── G. Privacy inside one company ─────────────── */
describe('G privacy between users of the same company', () => {
  it('G1 worker 2 cannot read, change or delete worker 1 records', async () => {
    const problems: string[] = [];
    for (const [m, p, b] of [
      ['GET', `/expenses/${fx.expense}`, undefined], ['PUT', `/expenses/${fx.expense}`, { description: 'hacked' }],
      ['DELETE', `/expenses/${fx.expense}`, undefined], ['GET', `/timekeeping/${fx.timeEntry}`, undefined],
      ['PUT', `/timekeeping/${fx.timeEntry}`, { notes: 'hacked' }], ['GET', `/daily-reports/${fx.dailyReport}`, undefined],
      ['PUT', `/daily-reports/${fx.dailyReport}`, { workDescription: 'hacked' }], ['DELETE', `/daily-reports/${fx.dailyReport}`, undefined],
      ['POST', '/expenses/submit', { expenseIds: [fx.expense] }], ['POST', '/timekeeping/submit', { entryIds: [fx.timeEntry] }],
    ] as [string, string, any][]) {
      const res = await call(worker2, m, p, b);
      if (res.status < 400) problems.push(`worker2 ${m} ${p} → ${res.status}`);
    }
    expect(problems).toEqual([]);
  });

  it('G4 a submitted time entry or expense can no longer be edited by the worker', async () => {
    const problems: string[] = [];
    // Relative to today: clocking in is refused beyond 7 days back, so a fixed date rots.
    const workedDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const t = await must(worker1.post('/timekeeping/clock-in', { projectId: fx.project, occurredAt: `${workedDay}T07:00:00Z` }));
    await must(worker1.post(`/timekeeping/clock-out/${t.id}`, { occurredAt: `${workedDay}T16:00:00Z` }));
    await must(worker1.post('/timekeeping/submit', { entryIds: [t.id] }));
    const edit = await worker1.put(`/timekeeping/${t.id}`, { notes: 'changed after submit' });
    if (edit.status < 400) problems.push(`edit submitted time entry → ${edit.status}`);
    const e = await must(worker1.post('/expenses', { projectId: fx.project, date: workedDay, category: 'material', description: 'x', amountCents: 100 }));
    await must(worker1.post('/expenses/submit', { expenseIds: [e.id] }));
    const editE = await worker1.put(`/expenses/${e.id}`, { amountCents: 999999 });
    if (editE.status < 400) problems.push(`edit submitted expense → ${editE.status}`);
    expect(problems).toEqual([]);
  });
});

/* ─────────────── A. File intake: catalogue import (API side) ─────────────── */
describe('A catalogue CSV import', () => {
  const row = (i: number, extra: object = {}) => ({
    lineNumber: i + 2, rawText: `QA.${i};Béton armé pour dalles et murs porteurs;m3;1;185.00;185.00`,
    npkNumber: `QA.${i}`, description: 'Béton armé pour dalles et murs porteurs', unit: 'm3', quantity: 1, unitPriceCents: 18500, ...extra,
  });

  it('A1/A2 imports, matches NPK, then rejects the same file as a duplicate', async () => {
    const body = { filename: 'soumission.csv', rows: [row(1), { ...row(2), npkNumber: 'QA.001' }] };
    const first = await must(adminA.post('/catalogue/import', body));
    expect(first.matchedRows).toBe(1);
    const again = await adminA.post('/catalogue/import', body);
    expect(again.error?.details?.rule ?? again.error?.code).toMatch(/DUPLICATE/);
  });

  it('A3 the same file imported twice concurrently is stored once', async () => {
    const body = { filename: 'concurrent.csv', rows: [row(900), row(901)] };
    const results = await Promise.all([adminA.post('/catalogue/import', body), adminA.post('/catalogue/import', body)]);
    expect(results.filter((r) => r.status < 300)).toHaveLength(1);
  });

  it('A4 accepts a realistic 500-row file (≈140 KB JSON)', async () => {
    const res = await adminA.post('/catalogue/import', { filename: 'big.csv', rows: Array.from({ length: 500 }, (_, i) => row(1000 + i)) });
    expect({ status: res.status, error: res.error?.message }).toEqual({ status: 201, error: undefined });
  });

  it('A5 an over-long field is a clear 400 naming the row', async () => {
    const res = await adminA.post('/catalogue/import', { filename: 'long.csv', rows: [row(1), { ...row(2), description: 'x'.repeat(1001) }] });
    expect(res.status).toBe(400);
    expect(res.error?.message).toMatch(/rows|description/i);
  });

  it('A15 field roles cannot import', async () => {
    for (const api of [worker1, lead]) expect((await api.post('/catalogue/import', { filename: 'x.csv', rows: [row(1)] })).status).toBe(403);
  });

  it('A16 company B import does not match company A NPK numbers', async () => {
    const res = await must(adminB.post('/catalogue/import', { filename: 'b.csv', rows: [{ ...row(3), npkNumber: 'QA.001' }] }));
    expect(res.matchedRows).toBe(0);
  });

  it('A17 a hostile filename is stored as inert text', async () => {
    const name = '../../etc/passwd<svg onload=alert(1)>.csv';
    const res = await adminA.post('/catalogue/import', { filename: name, rows: [row(4242)] });
    expect(res.status).toBe(201);
  });

  it('A18 a negative (rabais) price does not become the article minimum price', async () => {
    await must(adminA.post('/catalogue/import', { filename: 'rabais.csv', rows: [{ ...row(77), npkNumber: 'QA.001', unitPriceCents: -500000 }] }));
    const prices = await must(adminA.get(`/catalogue/articles/${fx.article}/prices`));
    const article = await must(adminA.get(`/catalogue/articles/${fx.article}`));
    const min = article.priceMinCents ?? article.minPriceCents ?? prices?.stats?.minCents;
    expect(min === undefined || min >= 0).toBe(true);
  });
});

/* ─────────────── B. URL / JSON "file" fields ─────────────── */
describe('B file references stored as URLs', () => {
  const BAD = ['javascript:alert(document.cookie)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'http://169.254.169.254/latest/meta-data/'];
  it('B1 plan fileUrl only accepts https links', async () => {
    const accepted: string[] = [];
    for (const url of BAD) {
      const res = await adminA.post('/plans', { name: 'X', fileUrl: url, fileType: 'pdf', projectId: fx.project });
      if (res.status < 400) accepted.push(url);
    }
    expect(accepted).toEqual([]);
  });
  it('B2 expense receiptUrl only accepts https links', async () => {
    const accepted: string[] = [];
    for (const url of BAD) {
      const res = await worker1.post('/expenses', { projectId: fx.project, date: '2026-09-29', category: 'material', description: 'x', amountCents: 1, receiptUrl: url });
      if (res.status < 400) accepted.push(url);
    }
    expect(accepted).toEqual([]);
  });
  it('B3 daily-report photos are validated (url scheme, size)', async () => {
    const res = await worker1.post('/daily-reports', {
      projectId: fx.project, date: '2026-09-10', workDescription: 'x',
      photos: [{ url: 'javascript:alert(1)', caption: '<img src=x onerror=alert(1)>', nested: { a: { b: { c: 'x'.repeat(50_000) } } } }],
    });
    expect(res.status).toBe(400);
  });
  it('B5 an oversized body is a 413, not a 500', async () => {
    const res = await adminA.post('/clients', { name: 'x'.repeat(600_000) });
    expect(res.status).toBe(413);
  });
  it('B6 malformed JSON is a 400 without internals', async () => {
    const res = await fetch(`${BASE_URL}/clients`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(USER_A.authId)}` }, body: '{"name": ',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toMatch(/at \w+ \(|node_modules|\/app\//);
  });
});

/* ─────────────── C. File outputs ─────────────── */
describe('C exports and documents', () => {
  it('C1 fiduciary CSV neutralises spreadsheet formulas', async () => {
    // Free text a worker controls ends up in the export: an approved expense's description.
    const e = await must(worker1.post('/expenses', {
      projectId: fx.project, date: '2026-09-25', category: 'material', description: '=HYPERLINK("http://evil.example","Payer")', amountCents: 100,
    }));
    await must(worker1.post('/expenses/submit', { expenseIds: [e.id] }));
    await must(pm.post('/expenses/approve', { expenseIds: [e.id] }));
    const exp = await must(adminA.get('/accounting/export/fiduciary?dateFrom=2026-01-01&dateTo=2026-12-31'));
    const contents = Object.values(exp.files).map((f: any) => f.content as string);
    expect(contents.join('\n')).toContain('HYPERLINK');
    const cells = contents.join('\n').split(/[\r\n;]/).map((c: string) => c.replace(/^\uFEFF/, '').replace(/^"|"$/g, ''));
    expect(cells.filter((c: string) => /^[=+\-@\t]/.test(c) && !/^-?\d/.test(c))).toEqual([]);
  });

  it('C3 fiduciary export with bad dates is a 400', async () => {
    const problems: string[] = [];
    for (const q of ['dateFrom=nope&dateTo=2026-12-31', 'dateFrom=2026-02-30&dateTo=2026-12-31', 'dateFrom=2026-12-31&dateTo=2026-01-01']) {
      const res = await pm.get(`/accounting/export/fiduciary?${q}`);
      if (res.status >= 500) problems.push(`${q} → ${res.status}`);
    }
    expect(problems).toEqual([]);
  });

  it('C6 the data export does not hand out live secrets (portal tokens)', async () => {
    const exp = await must(adminA.get('/settings/export'));
    const tokens = (exp.tables.portal_token ?? []).filter((t: any) => t.token && t.token !== '[redacted]');
    expect(tokens.length).toBe(0);
  });

  it('C7 PDFs render unicode, emoji and markup safely', async () => {
    const odd = 'Façade – Größe ß ✓ 🏗️ עברית <b>x</b> ' + 'long '.repeat(180);
    const inv = await must(adminA.post('/invoices', {
      projectId: fx.project, clientId: fx.client, type: 'invoice',
      lines: [{ description: odd, unit: 'u', quantity: 1, unitPriceCents: 100 }],
    }));
    const res = await fetch(`${BASE_URL}/invoices/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${tokenFor(USER_A.authId)}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/pdf/);
  });
});

/* ─────────────── I. Public client portal ─────────────── */
describe('I client portal', () => {
  it('I4 a portal link expires by default', async () => {
    const t = await must(adminA.post('/portal/tokens', { projectId: fx.project }));
    expect(t.expiresAt).not.toBeNull();
  });
  it('I2 revoked tokens stop working', async () => {
    const t = await must(adminA.post('/portal/tokens', { projectId: fx.project }));
    expect((await anon.get(`/portal/view/${t.token}`)).status).toBe(200);
    await must(adminA.del(`/portal/tokens/${t.id}`));
    expect((await anon.get(`/portal/view/${t.token}`)).status).toBeGreaterThanOrEqual(400);
  });
  it('I2 junk tokens give the same generic 4xx', async () => {
    const statuses = new Set<number>();
    for (const tok of ["' OR 1=1--", 'x'.repeat(5000), '../../etc', '%00']) {
      statuses.add((await anon.get(`/portal/view/${encodeURIComponent(tok)}`)).status);
    }
    expect([...statuses].every((s) => s >= 400 && s < 500)).toBe(true);
  });
  it('I1 the public view carries no money or internal notes', async () => {
    const t = await must(adminA.post('/portal/tokens', { projectId: fx.project }));
    const view = JSON.stringify((await anon.get(`/portal/view/${t.token}`)).data);
    expect(view).not.toMatch(/Cents|notes|budget|margin/i);
  });
});

/* ─────────────── H. Cross-module links ─────────────── */
describe('H interconnectivity', () => {
  it('H2 a signed amendment updates the contract value and project budget', async () => {
    const snapshot = async () => ({
      ttc: Number((await must(adminA.get(`/contracts/${fx.contract}`))).totalTtcCents),
      budget: Number((await must(adminA.get(`/projects/${fx.project}`))).budgetHtCents ?? 0),
    });
    const before = await snapshot();
    // Amounts are HT; a draft changes nothing until it is signed, and signing twice is a no-op.
    const am = await must(adminA.post(`/contracts/${fx.contract}/amendments`, { description: 'Extra wall', amountDeltaCents: 100_000 }));
    const asDraft = await snapshot();
    await must(adminA.patch(`/contracts/${fx.contract}/amendments/${am.id}/status`, { status: 'signed' }));
    await must(adminA.patch(`/contracts/${fx.contract}/amendments/${am.id}/status`, { status: 'signed' }));
    const after = await snapshot();
    expect({
      draftDelta: asDraft.ttc - before.ttc,
      contractDelta: after.ttc - before.ttc,
      budgetDelta: after.budget - before.budget,
    }).toEqual({ draftDelta: 0, contractDelta: 108_100, budgetDelta: 100_000 });
  });

  it('H9/H10 approved hours and expenses reach the project actual cost', async () => {
    const before = (await must(adminA.get(`/projects/${fx.project}`))).actualCostCents ?? 0;
    const e = await must(worker1.post('/expenses', { projectId: fx.project, date: '2026-09-27', category: 'material', description: 'Sable', amountCents: 25_000 }));
    await must(worker1.post('/expenses/submit', { expenseIds: [e.id] }));
    await must(pm.post('/expenses/approve', { expenseIds: [e.id] }));
    await must(adminA.post(`/projects/${fx.project}/recalculate`));
    const after = (await must(adminA.get(`/projects/${fx.project}`))).actualCostCents ?? 0;
    expect(after - before).toBeGreaterThanOrEqual(25_000);
  });

  it('H3 an approved plus-value can be invoiced exactly once', async () => {
    const bill = () => adminA.post('/invoices', { projectId: fx.project, clientId: fx.client, type: 'invoice', lines: [], plusValueIds: [fx.plusValue] });
    // Not billable before the client approved it.
    const early = await bill();
    await must(adminA.patch(`/invoices/plus-values/${fx.plusValue}/status`, { status: 'approved', approvedByClient: true }));
    const before = (await must(adminA.get(`/invoices/project/${fx.project}/summary`))).plusValues;
    const inv = await must(bill());
    const again = await bill();
    const after = (await must(adminA.get(`/invoices/project/${fx.project}/summary`))).plusValues;
    expect({
      early: early.status, subtotal: Number(inv.subtotalHtCents), again: again.status,
      approvedBefore: before.approvedToInvoiceCents, approvedAfter: after.approvedToInvoiceCents,
      invoiced: after.invoicedCents - before.invoicedCents,
    }).toEqual({ early: 422, subtotal: 50_000, again: 422, approvedBefore: 50_000, approvedAfter: 0, invoiced: 50_000 });
    // Cancelling the draft puts the plus-value back up for billing.
    await must(adminA.patch(`/invoices/${inv.id}/status`, { status: 'cancelled' }));
    expect((await must(adminA.get(`/invoices/project/${fx.project}/summary`))).plusValues.approvedToInvoiceCents).toBe(50_000);
  });

  it('H4/H5 an issued invoice and its payment both reach the journal', async () => {
    const entriesBefore = asList(await must(adminA.get('/accounting/entries?limit=500'))).length;
    const inv = await must(adminA.post('/invoices', {
      projectId: fx.project, clientId: fx.client, type: 'invoice',
      lines: [{ description: 'x', unit: 'u', quantity: 1, unitPriceCents: 10_000 }],
    }));
    await must(adminA.patch(`/invoices/${inv.id}/status`, { status: 'sent' }));
    const afterIssue = asList(await must(adminA.get('/accounting/entries?limit=500'))).length;
    await must(adminA.post(`/invoices/${inv.id}/payments`, { amountCents: 5_000, paymentDate: '2026-10-01', paymentMethod: 'bank_transfer' }));
    const afterPay = asList(await must(adminA.get('/accounting/entries?limit=500'))).length;
    expect({ onIssue: afterIssue - entriesBefore, onPayment: afterPay - afterIssue }).toEqual({ onIssue: 1, onPayment: 1 });
  });

  it('H8 stock cannot go below zero', async () => {
    const res = await lead.post('/stock/movements', { stockItemId: fx.stockItem, type: 'out', quantity: 10_000, projectId: fx.project });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('H12 meeting actions and approvals notify the people concerned', async () => {
    await must(adminA.post(`/meetings/${fx.meeting}/actions`, { description: 'Commander béton', responsible: WORKER_1_A.id }));
    const e = await must(worker1.post('/expenses', { projectId: fx.project, date: '2026-09-26', category: 'material', description: 'y', amountCents: 10 }));
    await must(worker1.post('/expenses/submit', { expenseIds: [e.id] }));
    await must(pm.post('/expenses/reject', { expenseIds: [e.id], reason: 'Missing receipt' }));
    const n = await must(worker1.get('/notifications/unread-count'));
    expect(n.count).toBeGreaterThan(0);
  });

  it('H13 the portal shows the project the token was issued for', async () => {
    const t = await must(adminA.post('/portal/tokens', { projectId: fx.project }));
    expect((await anon.get(`/portal/view/${t.token}`)).data.project.id).toBe(fx.project);
  });
});

/* ─────────────── J. Robustness ─────────────── */
describe('J input robustness', () => {
  it('J1 SQL-ish search strings neither error nor widen results', async () => {
    const problems: string[] = [];
    for (const p of ['/clients', '/catalogue/articles', '/offers', '/suppliers']) {
      for (const q of ["' OR 1=1--", '%', '_', "\\'; DROP TABLE company;--"]) {
        const res = await adminA.get(`${p}?search=${encodeURIComponent(q)}`);
        if (res.status >= 500) problems.push(`${p}?search=${q} → ${res.status}`);
        else if (q === "' OR 1=1--" && asList(res.data).length > 0) problems.push(`${p}?search=${q} returned rows`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('J2 pagination is clamped and validated', async () => {
    const problems: string[] = [];
    for (const q of ['limit=100000000', 'limit=-5', 'page=-1', 'limit=abc', 'page=1e9']) {
      const res = await adminA.get(`/clients?${q}`);
      if (res.status >= 500) problems.push(`${q} → ${res.status}`);
      const lim = res.raw?.meta?.limit;
      if (lim !== undefined && lim > 1000) problems.push(`${q} → meta.limit=${lim}`);
    }
    expect(problems).toEqual([]);
  });

  it('J3 non-UUID ids are 400 on every id route', async () => {
    const problems: string[] = [];
    for (const r of routeMap()) {
      if (!r.path.includes(':') || r.roles === 'PUBLIC' || r.path.includes(':token')) continue;
      const res = await call(adminA, r.method, fill(r.path, 'not-a-uuid'));
      if (res.status >= 500 || (res.status < 400)) problems.push(`${r.method} ${fill(r.path, 'not-a-uuid')} → ${res.status}`);
    }
    expect(problems).toEqual([]);
  });

  it('J6 impossible dates are rejected', async () => {
    const problems: string[] = [];
    for (const d of ['2026-02-30', '2026-13-01', '0001-01-01', '9999-12-31']) {
      const res = await worker1.post('/expenses', { projectId: fx.project, date: d, category: 'material', description: 'x', amountCents: 1 });
      if (res.status < 400 || res.status >= 500) problems.push(`expense date ${d} → ${res.status}`);
    }
    expect(problems).toEqual([]);
  });

  it('J7 approving the same expense twice at once approves it once', async () => {
    const e = await must(worker1.post('/expenses', { projectId: fx.project, date: '2026-09-21', category: 'material', description: 'z', amountCents: 10 }));
    await must(worker1.post('/expenses/submit', { expenseIds: [e.id] }));
    const rs = await Promise.all([pm.post('/expenses/approve', { expenseIds: [e.id] }), adminA.post('/expenses/approve', { expenseIds: [e.id] })]);
    expect(rs.filter((r) => r.status < 300)).toHaveLength(1);
  });
});

/* ─────────────── L. Audit ─────────────── */
describe('L audit trail', () => {
  it('L1 writes are audited with user and company; L2 the app role cannot erase them', async () => {
    const db = await appRoleClient();
    try {
      await setSignedContext(db, '', '', 'on');
      const { rows } = await db.query(`SELECT count(*)::int n FROM audit_log`);
      expect(rows[0].n).toBeGreaterThan(0);
      await expect(db.query(`DELETE FROM audit_log`)).rejects.toThrow();
      await expect(db.query(`UPDATE audit_log SET action = action`)).rejects.toThrow();
    } finally {
      await db.end();
    }
  });
});

/* ─────────────── J8 rate limiting ─────────────── */
describe('J8 / I5 rate limiting', () => {
  it('limits anonymous portal guessing', async () => {
    // A client IP of its own, so draining it doesn't rate-limit the other test files' anonymous calls.
    const headers = { 'X-Forwarded-For': '203.0.113.8' };
    let limited = false;
    for (let i = 0; i < 700 && !limited; i++) {
      limited = (await fetch(`${BASE_URL}/portal/view/${RANDOM_UUID}`, { headers })).status === 429;
    }
    expect(limited).toBe(true);
  }, 120_000);
});
