/**
 * Financial alerts (PRD §15.6, Build Strategy Phase 6): budget drift > 10 %, overdue acomptes and
 * detected plus-values, driven through the manual trigger POST /alerts/run.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  apiClient, appRoleClient, setSignedContext, createProject, tokenFor,
  COMPANY_A, COMPANY_B, USER_A, USER_B, PM_A, TEAM_LEAD_A, WORKER_1_A,
} from './setup';

type Api = ReturnType<typeof apiClient>;
const adminA = apiClient(tokenFor(USER_A.authId));
const adminB = apiClient(tokenFor(USER_B.authId));
const pm = apiClient(tokenFor(PM_A.authId));
const lead = apiClient(tokenFor(TEAM_LEAD_A.authId));
const worker1 = apiClient(tokenFor(WORKER_1_A.authId));

async function must<T = any>(p: Promise<{ status: number; data: T; error: any }>, label = ''): Promise<T> {
  const r = await p;
  if (r.status >= 300) throw new Error(`${label} HTTP ${r.status}: ${JSON.stringify(r.error)}`);
  return r.data;
}

const runAlerts = () => must(adminA.post('/alerts/run'), 'alerts/run');

/** The caller's notifications of one type about one record. */
async function alertsOf(api: Api, type: string, referenceId: string): Promise<any[]> {
  const list = await must(api.get('/notifications?limit=200'), 'notifications');
  const items: any[] = Array.isArray(list) ? list : (list as any)?.data ?? [];
  return items.filter((n) => n.type === type && n.referenceId === referenceId);
}

async function approvedExpense(projectId: string, amountCents: number) {
  const e = await must(worker1.post('/expenses', {
    projectId, date: '2026-09-30', category: 'material', description: 'Matériel alerte', amountCents,
  }), 'expense');
  await must(worker1.post('/expenses/submit', { expenseIds: [e.id] }), 'submit');
  await must(pm.post('/expenses/approve', { expenseIds: [e.id] }), 'approve');
}

async function signAmendment(contractId: string, amountDeltaCents: number) {
  const am = await must(adminA.post(`/contracts/${contractId}/amendments`, { description: 'Avenant alerte', amountDeltaCents }));
  await must(adminA.patch(`/contracts/${contractId}/amendments/${am.id}/status`, { status: 'signed' }));
}

let db: Client;
let projectId: string;
let clientId: string;
let contractId: string;

beforeAll(async () => {
  db = await appRoleClient();
  await setSignedContext(db, COMPANY_A, USER_A.id);
  projectId = await createProject(adminA, 'Alertes financières');
  const project = await must(adminA.get(`/projects/${projectId}`));
  clientId = project.clientId;
  contractId = project.contractId;
  await must(adminA.patch(`/projects/${projectId}`, { managerId: PM_A.id }), 'manager');
  await adminA.post('/accounting/accounts/seed'); // may already exist
});

afterAll(async () => {
  await db?.end();
});

describe('manual trigger', () => {
  it('is admin-only and scoped to the caller company', async () => {
    expect((await pm.post('/alerts/run')).status).toBe(403);
    expect((await lead.post('/alerts/run')).status).toBe(403);
    expect((await worker1.post('/alerts/run')).status).toBe(403);
    expect((await must(adminA.post('/alerts/run'))).companyId).toBe(COMPANY_A);
    expect((await must(adminB.post('/alerts/run'))).companyId).toBe(COMPANY_B);
  });
});

describe('budget drift', () => {
  let budget: number;

  it('stays silent up to 10 % over budget', async () => {
    await signAmendment(contractId, 100_000);
    budget = Number((await must(adminA.get(`/projects/${projectId}`))).budgetHtCents);
    expect(budget).toBeGreaterThan(0);

    await approvedExpense(projectId, Math.floor(budget * 1.05));
    await must(adminA.post(`/projects/${projectId}/recalculate`));
    await runAlerts();
    expect(await alertsOf(adminA, 'budget_drift', projectId)).toHaveLength(0);
  });

  it('notifies the manager and admins once when costs exceed the budget by more than 10 %', async () => {
    await approvedExpense(projectId, Math.ceil(budget * 0.15));
    await must(adminA.post(`/projects/${projectId}/recalculate`));
    await runAlerts();
    await runAlerts();

    const forAdmin = await alertsOf(adminA, 'budget_drift', projectId);
    const forPm = await alertsOf(pm, 'budget_drift', projectId);
    expect({ admin: forAdmin.length, pm: forPm.length }).toEqual({ admin: 1, pm: 1 });
    expect(forAdmin[0].title).toMatch(/^Dérive financière : /);
    expect(forAdmin[0].body).toMatch(/dépassent le budget/);
    expect(forAdmin[0].referenceType).toBe('project');
    // Field roles never get money alerts, and other tenants see nothing.
    expect(await alertsOf(worker1, 'budget_drift', projectId)).toHaveLength(0);
    expect(await alertsOf(adminB, 'budget_drift', projectId)).toHaveLength(0);
  });

  it('re-arms after the project is back under the threshold', async () => {
    // A signed amendment raises the budget (raw SQL, so only the run notices).
    await signAmendment(contractId, budget * 2);
    const resolved = await runAlerts();
    expect(resolved.driftResolved).toBeGreaterThanOrEqual(1);
    expect(await alertsOf(adminA, 'budget_drift', projectId)).toHaveLength(1);

    const raised = Number((await must(adminA.get(`/projects/${projectId}`))).budgetHtCents);
    const cost = Number((await must(adminA.get(`/projects/${projectId}`))).actualCostCents);
    await approvedExpense(projectId, Math.ceil(raised * 1.2) - cost);
    await must(adminA.post(`/projects/${projectId}/recalculate`));
    await runAlerts();
    expect(await alertsOf(adminA, 'budget_drift', projectId)).toHaveLength(2);
  });
});

describe('overdue acompte', () => {
  it('notifies once for an issued, unpaid acompte past its due date', async () => {
    const acompte = await must(adminA.post('/invoices', {
      projectId, clientId, type: 'acompte',
      lines: [{ description: 'Acompte 30 %', unit: 'forfait', quantity: 1, unitPriceCents: 300_000 }],
    }), 'acompte');

    // Drafts and invoices not yet due are not alerted.
    await runAlerts();
    await must(adminA.patch(`/invoices/${acompte.id}/status`, { status: 'sent' }), 'send');
    await runAlerts();
    expect(await alertsOf(adminA, 'acompte_overdue', acompte.id)).toHaveLength(0);

    await db.query(
      `UPDATE invoice SET due_date = CURRENT_DATE - 1 WHERE id = $1 AND company_id = $2`,
      [acompte.id, COMPANY_A],
    );
    const first = await runAlerts();
    await runAlerts();
    expect(first.acompteOverdue).toBe(1);

    const forAdmin = await alertsOf(adminA, 'acompte_overdue', acompte.id);
    expect(forAdmin).toHaveLength(1);
    expect(forAdmin[0].title).toBe(`Acompte en retard : ${acompte.invoiceNumber}`);
    expect(forAdmin[0].referenceType).toBe('invoice');
    expect(await alertsOf(pm, 'acompte_overdue', acompte.id)).toHaveLength(1);
    expect(await alertsOf(worker1, 'acompte_overdue', acompte.id)).toHaveLength(0);
  });

  it('ignores a paid acompte and a standard invoice', async () => {
    const paid = await must(adminA.post('/invoices', {
      projectId, clientId, type: 'acompte',
      lines: [{ description: 'Acompte payé', quantity: 1, unitPriceCents: 10_000 }],
    }));
    await must(adminA.patch(`/invoices/${paid.id}/status`, { status: 'sent' }));
    const sent = await must(adminA.get(`/invoices/${paid.id}`));
    await must(adminA.post(`/invoices/${paid.id}/payments`, {
      amountCents: Number(sent.totalTtcCents), paymentDate: '2026-10-01', paymentMethod: 'bank_transfer',
    }));
    const standard = await must(adminA.post('/invoices', {
      projectId, clientId, type: 'invoice',
      lines: [{ description: 'Travaux', quantity: 1, unitPriceCents: 10_000 }],
    }));
    await must(adminA.patch(`/invoices/${standard.id}/status`, { status: 'sent' }));
    await db.query(
      `UPDATE invoice SET due_date = CURRENT_DATE - 1 WHERE id = ANY($1::uuid[]) AND company_id = $2`,
      [[paid.id, standard.id], COMPANY_A],
    );

    await runAlerts();
    expect(await alertsOf(adminA, 'acompte_overdue', paid.id)).toHaveLength(0);
    expect(await alertsOf(adminA, 'acompte_overdue', standard.id)).toHaveLength(0);
  });
});

describe('plus-value detected', () => {
  it('notifies the office once per detected plus-value', async () => {
    const pv = await must(adminA.post('/invoices/plus-values', {
      projectId, description: 'Saignée supplémentaire', amountCents: 45_000,
    }), 'plus-value');

    const first = await runAlerts();
    await runAlerts();
    expect(first.plusValueDetected).toBe(1);

    const forPm = await alertsOf(pm, 'plus_value_detected', pv.id);
    expect(forPm).toHaveLength(1);
    expect(forPm[0].title).toMatch(/^Plus-value détectée : /);
    expect(forPm[0].body).toContain("CHF 450.00");
    expect(forPm[0].body).toContain('Saignée supplémentaire');
    expect(await alertsOf(adminA, 'plus_value_detected', pv.id)).toHaveLength(1);
    expect(await alertsOf(lead, 'plus_value_detected', pv.id)).toHaveLength(0);
  });

  it('keeps alert state tenant-isolated', async () => {
    const b = await appRoleClient();
    try {
      await setSignedContext(b, COMPANY_B, USER_B.id);
      const { rows } = await b.query('SELECT count(*)::int AS n FROM financial_alert WHERE project_id = $1', [projectId]);
      expect(rows[0].n).toBe(0);
    } finally {
      await b.end();
    }
    const { rows } = await db.query('SELECT count(*)::int AS n FROM financial_alert WHERE project_id = $1', [projectId]);
    expect(rows[0].n).toBeGreaterThanOrEqual(3);
  });
});
