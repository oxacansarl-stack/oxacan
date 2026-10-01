/**
 * Project actual cost (projectActualCostSql): approved hours + approved expenses HT + the HT value
 * of delivered purchase-order quantities; VAT on expenses computed server-side; the budget-drift
 * alert evaluates the very same formula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  apiClient, appRoleClient, setSignedContext, createProject, tokenFor,
  COMPANY_A, USER_A, PM_A, WORKER_1_A,
} from './setup';
import { projectActualCostSql } from '../src/modules/projects/project-cost';
import { SWISS_VAT_RATES_BPS, vatIncludedCents } from '../src/modules/timekeeping/dto/expense.dto';

const admin = apiClient(tokenFor(USER_A.authId));
const pm = apiClient(tokenFor(PM_A.authId));
const worker = apiClient(tokenFor(WORKER_1_A.authId));

async function must<T = any>(p: Promise<{ status: number; data: T; error: any }>, label = ''): Promise<T> {
  const r = await p;
  if (r.status >= 300) throw new Error(`${label} HTTP ${r.status}: ${JSON.stringify(r.error)}`);
  return r.data;
}

const expenseBody = (projectId: string | undefined, amountCents: number, extra: Record<string, unknown> = {}) => ({
  projectId, date: '2026-09-30', category: 'material', description: 'Frais coût projet', amountCents, ...extra,
});

async function approvedExpense(projectId: string, amountCents: number, vatRateBps?: number | null) {
  const e = await must(worker.post('/expenses', expenseBody(projectId, amountCents,
    vatRateBps === undefined ? {} : { vatRateBps })), 'expense');
  await must(worker.post('/expenses/submit', { expenseIds: [e.id] }), 'submit');
  await must(pm.post('/expenses/approve', { expenseIds: [e.id] }), 'approve');
  return e;
}

/** A sent purchase order for the project; returns the order and its line ids. */
async function sentOrder(projectId: string | undefined, lines: { quantity: number; unitPriceCents: number }[]) {
  const supplier = await must(admin.post('/suppliers', { name: `Fournisseur coût ${Math.random()}` }), 'supplier');
  const po = await must(admin.post('/purchase-orders', {
    supplierId: supplier.id, projectId,
    lines: lines.map((l, i) => ({ description: `Ligne ${i + 1}`, unit: 'pce', ...l })),
  }), 'purchase order');
  await must(admin.put(`/purchase-orders/${po.id}/status`, { status: 'sent' }), 'send');
  return { id: po.id as string, lineIds: (po.lines as any[]).map((l) => l.id as string) };
}

const deliver = (poId: string, lineId: string, deliveredQuantity: number) =>
  must(admin.post(`/purchase-orders/${poId}/lines/${lineId}/delivery`, { deliveredQuantity }), 'delivery');

const recalculatedCost = async (projectId: string) =>
  Number((await must(admin.post(`/projects/${projectId}/recalculate`), 'recalculate')).actualCostCents);

let db: Client;

/** The shared formula evaluated directly against the DB. */
async function sqlCost(projectId: string): Promise<number> {
  const [{ cost }] = (await db.query(`SELECT ${projectActualCostSql('$1', '$2')} AS cost`, [projectId, COMPANY_A])).rows;
  return Number(cost);
}

beforeAll(async () => {
  db = await appRoleClient();
  await setSignedContext(db, COMPANY_A, USER_A.id);
});

afterAll(async () => {
  await db?.end();
});

describe('VAT on expenses', () => {
  it('computes the VAT contained in the TTC amount, rounded to the centime', () => {
    expect(SWISS_VAT_RATES_BPS).toEqual([0, 260, 380, 810]);
    expect(vatIncludedCents(10_810, 810)).toBe(810);
    expect(vatIncludedCents(100, 810)).toBe(7); // 7.49
    expect(vatIncludedCents(1_000, 260)).toBe(25); // 25.34
    expect(vatIncludedCents(1_000, 380)).toBe(37); // 36.61
    expect(vatIncludedCents(5_000, 0)).toBe(0);
    expect(vatIncludedCents(5_000, null)).toBeNull();
    expect(vatIncludedCents(100_000_000_000, 810)).toBe(7_493_061_980); // 7 493 061 979.65, exact at the IsCents bound
  });

  it('stores the rate and the server-computed amount; null means unknown', async () => {
    const withVat = await must(worker.post('/expenses', expenseBody(undefined, 10_810, { vatRateBps: 810 })));
    expect({ rate: withVat.vatRateBps, vat: Number(withVat.vatAmountCents), ttc: Number(withVat.amountCents) })
      .toEqual({ rate: 810, vat: 810, ttc: 10_810 });

    const unknown = await must(worker.post('/expenses', expenseBody(undefined, 5_000)));
    expect({ rate: unknown.vatRateBps, vat: unknown.vatAmountCents }).toEqual({ rate: null, vat: null });

    const explicitNull = await must(worker.post('/expenses', expenseBody(undefined, 5_000, { vatRateBps: null })));
    expect(explicitNull.vatAmountCents).toBeNull();

    const exempt = await must(worker.post('/expenses', expenseBody(undefined, 5_000, { vatRateBps: 0 })));
    expect({ rate: exempt.vatRateBps, vat: Number(exempt.vatAmountCents) }).toEqual({ rate: 0, vat: 0 });
  });

  it('rejects non-Swiss rates and a client-supplied VAT amount', async () => {
    for (const vatRateBps of [770, 8.1, 81, -810, '810']) {
      expect((await worker.post('/expenses', expenseBody(undefined, 1_000, { vatRateBps }))).status).toBe(400);
    }
    expect((await worker.post('/expenses', expenseBody(undefined, 1_000, { vatRateBps: 810, vatAmountCents: 1 }))).status)
      .toBe(400);
  });

  it('recomputes the VAT when the amount or the rate changes', async () => {
    const e = await must(worker.post('/expenses', expenseBody(undefined, 10_810, { vatRateBps: 810 })));

    const amount = await must(worker.put(`/expenses/${e.id}`, { amountCents: 21_620 }));
    expect({ rate: amount.vatRateBps, vat: Number(amount.vatAmountCents) }).toEqual({ rate: 810, vat: 1_620 });

    const rate = await must(worker.put(`/expenses/${e.id}`, { vatRateBps: 260 }));
    expect(Number(rate.vatAmountCents)).toBe(vatIncludedCents(21_620, 260));

    const cleared = await must(worker.put(`/expenses/${e.id}`, { vatRateBps: null }));
    expect({ rate: cleared.vatRateBps, vat: cleared.vatAmountCents }).toEqual({ rate: null, vat: null });

    expect((await worker.put(`/expenses/${e.id}`, { vatRateBps: 700 })).status).toBe(400);
  });
});

describe('project actual cost', () => {
  let projectId: string;

  beforeAll(async () => {
    projectId = await createProject(admin, 'Coût réel complet');
    await must(admin.patch(`/projects/${projectId}`, { managerId: PM_A.id }), 'manager');
  });

  it('counts approved expenses HT when the VAT is known, TTC otherwise', async () => {
    await approvedExpense(projectId, 10_810, 810); // HT 10 000
    await approvedExpense(projectId, 5_000); // VAT unknown → 5 000
    await must(worker.post('/expenses', expenseBody(projectId, 99_999, { vatRateBps: 810 }))); // draft: ignored

    expect(await recalculatedCost(projectId)).toBe(15_000);
  });

  it('counts the HT value of delivered purchase-order quantities, not the ordered ones', async () => {
    const po = await sentOrder(projectId, [
      { quantity: 10, unitPriceCents: 1_234 },
      { quantity: 2.5, unitPriceCents: 999 },
    ]);
    // Nothing delivered yet: an order alone is not a cost.
    expect(await recalculatedCost(projectId)).toBe(15_000);

    await deliver(po.id, po.lineIds[0], 4); // 4 × 12.34 = 49.36
    expect(await recalculatedCost(projectId)).toBe(15_000 + 4_936);

    await deliver(po.id, po.lineIds[0], 6); // cumulative quantity, not a delta
    await deliver(po.id, po.lineIds[1], 1.5); // 1.5 × 9.99 = 14.985 → 14.99
    expect(await recalculatedCost(projectId)).toBe(15_000 + 7_404 + 1_499);

    // Deliveries on other projects' or project-less orders are not this project's cost.
    const other = await createProject(admin, 'Coût réel autre projet');
    const elsewhere = await sentOrder(other, [{ quantity: 1, unitPriceCents: 50_000 }]);
    const stock = await sentOrder(undefined, [{ quantity: 1, unitPriceCents: 70_000 }]);
    await deliver(elsewhere.id, elsewhere.lineIds[0], 1);
    await deliver(stock.id, stock.lineIds[0], 1);

    const cost = await recalculatedCost(projectId);
    expect(cost).toBe(23_903);
    expect(await sqlCost(projectId)).toBe(cost);
    expect(await recalculatedCost(other)).toBe(50_000);
  });

  it('only accepts SQL placeholders or column references', () => {
    expect(projectActualCostSql('p.id', 'p.company_id')).toContain('p.company_id');
    for (const bad of ["'x'", '1; DROP TABLE expense', 'p.id OR true', '$1)--']) {
      expect(() => projectActualCostSql(bad, '$2')).toThrow();
      expect(() => projectActualCostSql('$1', bad)).toThrow();
    }
  });
});

describe('budget-drift alert uses the same formula', () => {
  let projectId: string;
  let budget: number;

  const driftAlert = async () =>
    (await db.query(
      `SELECT details FROM financial_alert
        WHERE company_id = $1 AND kind = 'budget_drift' AND subject_id = $2 AND resolved_at IS NULL`,
      [COMPANY_A, projectId],
    )).rows[0]?.details as { budgetCents: number; actualCents: number } | undefined;

  beforeAll(async () => {
    projectId = await createProject(admin, 'Coût réel alerte');
    const project = await must(admin.get(`/projects/${projectId}`));
    await must(admin.patch(`/projects/${projectId}`, { managerId: PM_A.id }), 'manager');
    const am = await must(admin.post(`/contracts/${project.contractId}/amendments`, {
      description: 'Avenant coût réel', amountDeltaCents: 100_000,
    }));
    await must(admin.patch(`/contracts/${project.contractId}/amendments/${am.id}/status`, { status: 'signed' }));
    budget = Number((await must(admin.get(`/projects/${projectId}`))).budgetHtCents);
    expect(budget).toBeGreaterThan(0);
  });

  it('does not alert on VAT: the TTC paid is 15 % over budget but the HT cost is not 10 % over', async () => {
    const ttc = Math.ceil(budget * 1.15);
    await approvedExpense(projectId, ttc, 810);
    const ht = ttc - vatIncludedCents(ttc, 810)!;
    expect(ht * 100).toBeLessThanOrEqual(budget * 110);

    await must(admin.post('/alerts/run'), 'alerts/run');
    expect(await driftAlert()).toBeUndefined();
    expect(await sqlCost(projectId)).toBe(ht);
  });

  it('alerts on delivered purchase-order goods, with the cost recalculation would store', async () => {
    const unit = Math.ceil(budget * 0.03);
    const po = await sentOrder(projectId, [{ quantity: 10, unitPriceCents: unit }]);
    await deliver(po.id, po.lineIds[0], 5);

    // No recalculation first: the alert computes the cost live.
    await must(admin.post('/alerts/run'), 'alerts/run');
    const alert = await driftAlert();
    expect(alert).toBeDefined();

    const ttc = Math.ceil(budget * 1.15);
    const expected = ttc - vatIncludedCents(ttc, 810)! + 5 * unit;
    expect(Number(alert!.actualCents)).toBe(expected);
    expect(await recalculatedCost(projectId)).toBe(expected);
    expect(await sqlCost(projectId)).toBe(expected);
  });
});
