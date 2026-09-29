import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  apiClient, tokenFor, createProject, USER_A, COMPANY_A, TEST_DB,
} from './setup';

const admin = apiClient(tokenFor(USER_A.authId));

async function ok(p: Promise<{ status: number; data: any; error: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}

let db: Client;

beforeAll(async () => {
  db = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_MIGRATION_USERNAME || process.env.DB_USERNAME,
    password: process.env.DB_MIGRATION_PASSWORD || process.env.DB_PASSWORD,
    database: TEST_DB,
  });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

describe('Contracts', () => {
  it('allows one live contract per offer and signing only once', async () => {
    const client = await ok(admin.post('/clients', { name: 'Rules client' }));
    const offer = await ok(admin.post('/offers', { projectName: 'Rules project', clientId: client.id }));
    await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
    await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'accepted' }));
    const contract = await ok(admin.post('/contracts/from-offer', { offerId: offer.id }));

    const dup = await admin.post('/contracts/from-offer', { offerId: offer.id });
    expect(dup.status).toBe(422);
    expect(dup.error?.details?.rule).toBe('CONTRACT_EXISTS');

    const signs = await Promise.all([
      admin.patch(`/contracts/${contract.id}/status`, { status: 'signed' }),
      admin.patch(`/contracts/${contract.id}/status`, { status: 'signed' }),
    ]);
    expect(signs.map((r) => r.status).sort()).toEqual([200, 422]);

    const { rows } = await db.query('SELECT count(*)::int AS n FROM project WHERE contract_id = $1', [contract.id]);
    expect(rows[0].n).toBe(1);

    const detail = await ok(admin.get(`/contracts/${contract.id}`));
    expect(detail.projectId).toBeTruthy();
    expect((await admin.patch(`/contracts/${contract.id}/status`, { status: 'draft' })).status).toBe(422);
  });

  it('gives concurrently created contracts distinct references', async () => {
    const client = await ok(admin.post('/clients', { name: 'Concurrent client' }));
    const offers = await Promise.all(
      [1, 2, 3].map((i) => ok(admin.post('/offers', { projectName: `Concurrent ${i}`, clientId: client.id }))),
    );
    for (const o of offers) {
      await ok(admin.patch(`/offers/${o.id}/status`, { status: 'submitted' }));
      await ok(admin.patch(`/offers/${o.id}/status`, { status: 'accepted' }));
    }
    const contracts = await Promise.all(offers.map((o) => ok(admin.post('/contracts/from-offer', { offerId: o.id }))));
    expect(new Set(contracts.map((c) => c.reference)).size).toBe(3);
  });
});

describe('Invoicing', () => {
  let projectId: string;
  let clientId: string;

  beforeAll(async () => {
    projectId = await createProject(admin, 'Invoice rules');
    clientId = (await ok(admin.get(`/projects/${projectId}`))).clientId;
  });

  const newInvoice = (unitPriceCents = 10000) =>
    ok(
      admin.post('/invoices', {
        projectId,
        clientId,
        type: 'invoice',
        lines: [{ description: 'Travaux', unit: 'h', quantity: 1, unitPriceCents }],
      }),
    );

  it('keeps numbering sequential past 999 in a year', async () => {
    const year = new Date().getFullYear();
    await db.query(
      `INSERT INTO invoice (company_id, project_id, client_id, type, invoice_number, status, issue_date,
         vat_rate, subtotal_ht_cents, vat_amount_cents, total_ttc_cents)
       VALUES ($1, $2, $3, 'invoice', $4, 'draft', CURRENT_DATE, 810, 0, 0, 0)`,
      [COMPANY_A, projectId, clientId, `${year}-999`],
    );
    const next = await newInvoice();
    expect(next.invoiceNumber).toBe(`${year}-1000`);
    const after = await newInvoice();
    expect(after.invoiceNumber).toBe(`${year}-1001`);
  });

  it('rejects payments on drafts, overpayments, and applies concurrent payments exactly once each', async () => {
    const inv = await newInvoice(20000);
    const pay = (amountCents: number) =>
      admin.post(`/invoices/${inv.id}/payments`, {
        amountCents, paymentDate: '2026-10-01', paymentMethod: 'bank_transfer',
      });

    expect((await pay(100)).error?.details?.rule).toBe('INVOICE_NOT_PAYABLE');
    await ok(admin.patch(`/invoices/${inv.id}/status`, { status: 'sent' }));
    expect((await pay(inv.totalTtcCents + 5)).error?.details?.rule).toBe('OVERPAYMENT');

    const results = await Promise.all([pay(1000), pay(1000), pay(1000)]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const after = await ok(admin.get(`/invoices/${inv.id}`));
    expect(after.amountPaidCents).toBe(3000);
    expect(after.status).toBe('partially_paid');
    expect(after.payments).toHaveLength(3);
    expect((await admin.patch(`/invoices/${inv.id}/status`, { status: 'sent' })).status).toBe(422);
  });

  it('credits an issued invoice once and refuses drafts', async () => {
    const draft = await newInvoice();
    expect((await admin.post(`/invoices/${draft.id}/credit-note`)).error?.details?.rule).toBe('CREDIT_NOTE_NOT_ISSUED');

    const issued = await newInvoice();
    await ok(admin.patch(`/invoices/${issued.id}/status`, { status: 'sent' }));
    const credit = await ok(admin.post(`/invoices/${issued.id}/credit-note`));
    expect(credit.totalTtcCents).toBe(-issued.totalTtcCents);
    expect((await admin.post(`/invoices/${issued.id}/credit-note`)).error?.details?.rule).toBe('CREDIT_NOTE_EXISTS');
  });

  it('rejects situation lines whose cumulative quantity went backwards', async () => {
    const res = await admin.post('/invoices', {
      projectId,
      clientId,
      type: 'situation',
      lines: [{ description: 'Béton', unit: 'm3', quantity: 10, unitPriceCents: 1000, cumulativeQuantity: 2, previousQuantity: 5 }],
    });
    expect(res.status).toBe(400);
  });
});

describe('Purchase order deliveries', () => {
  it('books only the delivered delta to one stock item and blocks draft orders', async () => {
    const supplier = await ok(admin.post('/suppliers', { name: 'Holcim Test' }));
    const article = await ok(
      admin.post('/catalogue/articles', { description: 'Ciment CEM II', unit: 'sac' }),
    );
    const location = await ok(admin.post('/stock/locations', { name: 'Dépôt', type: 'warehouse' }));
    await ok(admin.post('/stock/items', { canonicalArticleId: article.id, locationId: location.id, quantity: 0 }));
    const po = await ok(
      admin.post('/purchase-orders', {
        supplierId: supplier.id,
        lines: [{ description: 'Ciment', unit: 'sac', quantity: 50, unitPriceCents: 1200, canonicalArticleId: article.id }],
      }),
    );
    const lineId = po.lines[0].id;
    const deliver = (deliveredQuantity: number) =>
      admin.post(`/purchase-orders/${po.id}/lines/${lineId}/delivery`, { deliveredQuantity });

    expect((await deliver(10)).error?.details?.rule).toBe('PO_NOT_DELIVERABLE');
    await ok(admin.put(`/purchase-orders/${po.id}/status`, { status: 'sent' }));

    await ok(deliver(20));
    await ok(deliver(30));
    const done = await ok(deliver(50));
    expect(done.status).toBe('delivered');

    const items: any[] = await ok(admin.get('/stock/items?limit=100'));
    const item = items.find((i) => i.canonicalArticleId === article.id);
    expect(Number(item.quantity)).toBe(50);
  });

  it('numbers concurrently created purchase orders uniquely', async () => {
    const supplier = await ok(admin.post('/suppliers', { name: 'Concurrent supplier' }));
    const pos = await Promise.all(
      [1, 2, 3].map(() =>
        ok(
          admin.post('/purchase-orders', {
            supplierId: supplier.id,
            lines: [{ description: 'x', unit: 'pce', quantity: 1, unitPriceCents: 100 }],
          }),
        ),
      ),
    );
    expect(new Set(pos.map((p) => p.reference)).size).toBe(3);
  });
});
