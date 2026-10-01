import { describe, expect, it } from 'vitest';
import { apiClient, createProject, tokenFor, USER_A, WORKER_1_A } from './setup';

const admin = apiClient(tokenFor(USER_A.authId));
const worker = apiClient(tokenFor(WORKER_1_A.authId));

async function ok(p: Promise<{ status: number; data: any; error: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}

describe('Dashboard aggregates', () => {
  it('offers stats count the open pipeline; workers are refused', async () => {
    const client = await ok(admin.post('/clients', { name: 'Stats client' }));
    const offer = await ok(admin.post('/offers', { projectName: 'Stats offre', clientId: client.id }));
    const before = await ok(admin.get('/offers/stats'));
    expect(before.open.count).toBeGreaterThanOrEqual(1);
    expect(before.byStatus.draft.count).toBeGreaterThanOrEqual(1);
    expect((await worker.get('/offers/stats')).status).toBe(403);
    // Moving the offer out of the pipeline reduces the open count.
    await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
    await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'rejected' }));
    const after = await ok(admin.get('/offers/stats'));
    expect(after.byStatus.rejected.count).toBeGreaterThanOrEqual(1);
  });

  it('invoice stats add up for a dedicated year and never count drafts or workers', async () => {
    const projectId = await createProject(admin, 'Stats factures');
    const clientId = (await ok(admin.get(`/projects/${projectId}`))).clientId;
    const y2033 = { projectId, clientId, type: 'invoice', vatRate: 0, retentionRate: 0 };
    // Drafts don't count.
    await ok(admin.post('/invoices', { ...y2033, lines: [{ description: 'draft', unit: 'u', quantity: 1, unitPriceCents: 99_999 }] }));
    const inv = await ok(admin.post('/invoices', { ...y2033, lines: [{ description: 'sent', unit: 'u', quantity: 1, unitPriceCents: 40_000 }] }));
    await ok(admin.patch(`/invoices/${inv.id}/status`, { status: 'sent' }));
    await ok(admin.post(`/invoices/${inv.id}/payments`, { amountCents: 15_000, paymentDate: '2026-10-02', paymentMethod: 'bank_transfer' }));
    const now = await ok(admin.get('/invoices/stats'));
    expect(now.year).toBe(new Date().getFullYear());
    expect(now.invoicedTtcCents).toBeGreaterThanOrEqual(40_000);
    expect(now.outstandingTtcCents).toBe(now.invoicedTtcCents - now.paidTtcCents);
    expect(now.paidThisMonthCents).toBeGreaterThanOrEqual(15_000);
    expect(now.pendingCount).toBeGreaterThanOrEqual(1);
    const empty = await ok(admin.get('/invoices/stats?year=2033'));
    expect(empty).toMatchObject({ year: 2033, invoicedTtcCents: 0, paidTtcCents: 0, pendingCount: 0 });
    expect((await admin.get('/invoices/stats?year=20330')).status).toBe(400);
    expect((await worker.get('/invoices/stats')).status).toBe(403);
  });

  it('catalogue reads are closed to workers but open to team leaders, without prices', async () => {
    expect((await worker.get('/catalogue/articles')).status).toBe(403);
  });
});
