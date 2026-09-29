import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  apiClient, tokenFor, createProject, USER_A, USER_B, COMPANY_A, TEST_DB, WORKER_1_A, PM_A, BASE_URL,
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

describe('Large amounts', () => {
  it('handles an invoice above CHF 21.4 million exactly', async () => {
    const projectId = await createProject(admin, 'Large project');
    const clientId = (await ok(admin.get(`/projects/${projectId}`))).clientId;
    const inv = await ok(
      admin.post('/invoices', {
        projectId,
        clientId,
        type: 'invoice',
        lines: [{ description: 'Gros-oeuvre', unit: 'forfait', quantity: 1, unitPriceCents: 3_000_000_000 }],
      }),
    );
    expect(inv.subtotalHtCents).toBe(3_000_000_000);
    expect(typeof inv.totalTtcCents).toBe('number');
    expect(inv.totalTtcCents).toBeGreaterThan(3_000_000_000);
    expect(inv.totalTtcCents % 5).toBe(0);
  });
});

describe('Rejections', () => {
  it('records who rejected, when and why, and lets the owner resubmit', async () => {
    const projectId = await createProject(admin, 'Rejection project');
    const worker = apiClient(tokenFor(WORKER_1_A.authId));
    const exp = await ok(
      worker.post('/expenses', { projectId, date: '2026-09-29', category: 'material', description: 'Vis', amountCents: 900 }),
    );
    await ok(worker.post('/expenses/submit', { expenseIds: [exp.id] }));
    expect((await admin.post('/expenses/reject', { expenseIds: [exp.id] })).status).toBe(400);
    await ok(admin.post('/expenses/reject', { expenseIds: [exp.id], reason: 'Receipt missing' }));

    const rejected = await ok(worker.get(`/expenses/${exp.id}`));
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Receipt missing');
    expect(rejected.rejectedBy).toBe(USER_A.id);
    expect(rejected.rejectedAt).toBeTruthy();

    await ok(worker.post('/expenses/submit', { expenseIds: [exp.id] }));
    const resubmitted = await ok(worker.get(`/expenses/${exp.id}`));
    expect(resubmitted.status).toBe('submitted');
    expect(resubmitted.rejectionReason).toBeNull();
  });
});

describe('Data export (revFADP / GDPR)', () => {
  it('exports every tenant table for admins only, with no other company data', async () => {
    expect((await apiClient(tokenFor(PM_A.authId)).get('/settings/export')).status).toBe(403);
    const exp = await ok(admin.get('/settings/export'));
    expect(exp.company.id).toBe(COMPANY_A);
    expect(Object.keys(exp.tables).length).toBeGreaterThan(40);
    expect(exp.tables.invoice.length).toBeGreaterThan(0);
    const leaked = Object.entries(exp.tables as Record<string, any[]>).filter(([, rows]) =>
      rows.some((r) => r.company_id && r.company_id !== COMPANY_A),
    );
    expect(leaked.map(([t]) => t)).toEqual([]);
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE company_id = $1 AND action = 'EXPORT'`,
      [COMPANY_A],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});

describe('Offline clock-in/out', () => {
  const zurichTime = (d: Date) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

  it('keeps the tap time of queued actions and rejects impossible times', async () => {
    const projectId = await createProject(admin, 'Offline project');
    const tappedIn = new Date(Date.now() - 3 * 3600_000);
    const tappedOut = new Date(Date.now() - 3600_000);

    expect(
      (await admin.post('/timekeeping/clock-in', { projectId, occurredAt: new Date(Date.now() + 3600_000).toISOString() })).status,
    ).toBe(400);

    const entry = await ok(admin.post('/timekeeping/clock-in', { projectId, occurredAt: tappedIn.toISOString() }));
    expect(entry.startTime.slice(0, 5)).toBe(zurichTime(tappedIn));
    expect(entry.isOfflineEntry).toBe(true);

    const early = await admin.post(`/timekeeping/clock-out/${entry.id}`, {
      occurredAt: new Date(tappedIn.getTime() - 3600_000).toISOString(),
    });
    expect(early.status).toBe(400);

    const out = await ok(admin.post(`/timekeeping/clock-out/${entry.id}`, { occurredAt: tappedOut.toISOString() }));
    expect(out.endTime.slice(0, 5)).toBe(zurichTime(tappedOut));
    expect(out.totalMinutes).toBe(120);
    expect(out.syncedAt).toBeTruthy();
  });
});

describe('Offer totals and numbering', () => {
  it('totals BASE lines at selling price (cost × margin) and numbers offers', async () => {
    const client = await ok(admin.post('/clients', { name: 'Pricing client' }));
    const offer = await ok(admin.post('/offers', { projectName: 'Pricing', clientId: client.id, marginFactor: 120, vatRate: 810 }));
    expect(offer.reference).toMatch(/^OFF-\d{4}-\d{4}$/);
    await ok(admin.post(`/offers/${offer.id}/lines`, { description: 'Base', unit: 'm2', quantity: 10, unitPriceCents: 1000 }));
    await ok(admin.post(`/offers/${offer.id}/lines`, { description: 'Option', unit: 'pce', quantity: 1, unitPriceCents: 50000, variantType: 'OPTION' }));
    await ok(admin.post(`/offers/${offer.id}/lines`, { description: 'Variante', unit: 'pce', quantity: 1, unitPriceCents: 70000, variantType: 'VARIANTE' }));
    const totals = await ok(admin.post(`/offers/${offer.id}/recalculate`));
    expect(totals.totalHtCents).toBe(12000);
    expect(totals.totalVatCents).toBe(972);
    expect(totals.totalTtcCents).toBe(12970);
  });
});

describe('PDF documents', () => {
  const download = async (path: string, authId = USER_A.authId) => {
    const res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${tokenFor(authId)}` } });
    const body = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition') ?? '', body };
  };

  it('renders invoice, credit note, offer and site-meeting PDFs', async () => {
    const projectId = await createProject(admin, 'PDF project');
    const project = await ok(admin.get(`/projects/${projectId}`));
    const inv = await ok(
      admin.post('/invoices', {
        projectId, clientId: project.clientId, type: 'invoice',
        lines: [{ description: 'Travaux « spéciaux » à l’étage', unit: 'h', quantity: 3, unitPriceCents: 9500 }],
      }),
    );
    const invoicePdf = await download(`/invoices/${inv.id}/pdf`);
    expect(invoicePdf.status).toBe(200);
    expect(invoicePdf.type).toBe('application/pdf');
    expect(invoicePdf.disposition).toContain(`Facture-${inv.invoiceNumber}.pdf`);
    expect(invoicePdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    await ok(admin.patch(`/invoices/${inv.id}/status`, { status: 'sent' }));
    const credit = await ok(admin.post(`/invoices/${inv.id}/credit-note`));
    expect((await download(`/invoices/${credit.id}/pdf`)).disposition).toContain('Note-de-credit');

    const offers: any[] = await ok(admin.get('/offers?limit=100'));
    expect((await download(`/offers/${offers[0].id}/pdf`)).status).toBe(200);

    const meeting = await ok(admin.post('/meetings', { projectId, meetingDate: '2026-09-29T08:00:00Z', location: 'Chantier' }));
    await ok(admin.post(`/meetings/${meeting.id}/attendees`, { name: 'Jean Dupont', attendance: 'present' }));
    const meetingPdf = await download(`/meetings/${meeting.id}/pdf`);
    expect(meetingPdf.status).toBe(200);
    expect(meetingPdf.disposition).toContain('PV-chantier-1');
  });

  it('restricts documents by role and tenant', async () => {
    const invoices: any[] = await ok(admin.get('/invoices?limit=1'));
    expect((await download(`/invoices/${invoices[0].id}/pdf`, WORKER_1_A.authId)).status).toBe(403);
    expect((await download(`/invoices/${invoices[0].id}/pdf`, USER_B.authId)).status).toBe(404);
  });
});

describe('Company banking settings', () => {
  it('normalises a valid Swiss IBAN and rejects invalid or foreign ones', async () => {
    expect((await admin.put('/settings', { iban: 'DE89 3704 0044 0532 0130 00' })).status).toBe(400);
    expect((await admin.put('/settings', { iban: 'CH44 3199 9123 0008 8901 3' })).status).toBe(400);
    await ok(admin.put('/settings', { iban: 'ch44 3199 9123 0008 8901 2', defaultPaymentTermsDays: 20 }));
    const settings = await ok(admin.get('/settings'));
    expect(settings.iban).toBe('CH4431999123000889012');
    expect(settings.defaultPaymentTermsDays).toBe(20);
  });
});

describe('Task dependencies under RLS', () => {
  it('creates, reads and isolates dependencies between tasks', async () => {
    const projectId = await createProject(admin, 'Dependency project');
    const a = await ok(admin.post(`/projects/${projectId}/tasks`, { title: 'Démolition' }));
    const b = await ok(admin.post(`/projects/${projectId}/tasks`, { title: 'Chape' }));
    await ok(admin.post(`/projects/${projectId}/tasks/${a.id}/dependencies`, { successorId: b.id, type: 'finish_to_start' }));
    const c = await ok(admin.post(`/projects/${projectId}/tasks`, { title: 'Revêtement' }));
    await ok(admin.post(`/projects/${projectId}/tasks/${b.id}/dependencies`, { successorId: c.id }));
    // A → B → C: both a direct (B → A) and an indirect (C → A) loop are refused.
    for (const [from, to] of [[b.id, a.id], [c.id, a.id]]) {
      const res = await admin.post(`/projects/${projectId}/tasks/${from}/dependencies`, { successorId: to });
      expect(res.status).toBe(422);
      expect(res.error?.details?.rule).toBe('CIRCULAR_DEPENDENCY');
    }

    const gantt = await ok(admin.get(`/projects/${projectId}/gantt`));
    expect(JSON.stringify(gantt)).toContain(b.id);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM task_dependency WHERE predecessor_id = $1', [a.id]);
    expect(rows[0].n).toBe(1);
  });
});
