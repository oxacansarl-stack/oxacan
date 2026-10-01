import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { apiClient, tokenFor, createProject, USER_A, USER_B, PM_A, COMPANY_A, TEST_DB } from './setup';

/*
 * Invoicing, PRD §15 (Build Strategy Phase 6): the final invoice (décompte final) that releases the
 * retention held on situations at the réception finale, the per-company invoice number format, and
 * the contract's acompte schedule ("acomptes à émettre").
 */

const admin = apiClient(tokenFor(USER_A.authId));
const adminB = apiClient(tokenFor(USER_B.authId));
const pm = apiClient(tokenFor(PM_A.authId));

async function ok(p: Promise<{ status: number; data: any; error: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}

const rule = (r: { error: any }) => r.error?.details?.rule;
const swiss = (c: number) => Math.round(c / 5) * 5;
/** A date a few days back, so it is not in the future in the database's time zone either. */
const recently = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

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
  await admin.post('/accounting/accounts/seed'); // may already exist
});

afterAll(async () => {
  await db.end();
});

interface Fixture {
  projectId: string;
  clientId: string;
  contractId: string;
  offerId: string;
  /** offer line ids, in the order they were added */
  lines: string[];
}

/** Offer with priced BASE lines → accepted → contract signed → project. */
async function projectWithOffer(name: string): Promise<Fixture> {
  const client = await ok(admin.post('/clients', { name: `${name} client` }));
  const offer = await ok(admin.post('/offers', { projectName: name, clientId: client.id }));
  const ids: string[] = [];
  for (const l of [
    { description: 'Tirage de câble', unit: 'm', quantity: 100, unitPriceCents: 1_000 },
    { description: 'Prise T13', unit: 'pce', quantity: 10, unitPriceCents: 5_000 },
  ]) ids.push((await ok(admin.post(`/offers/${offer.id}/lines`, l))).id);
  await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
  await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'accepted' }));
  const contract = await ok(admin.post('/contracts/from-offer', { offerId: offer.id }));
  await ok(admin.patch(`/contracts/${contract.id}/status`, { status: 'signed' }));
  const projects: any[] = await ok(admin.get('/projects?limit=500'));
  const project = projects.find((p) => p.contractId === contract.id);
  return { projectId: project.id, clientId: project.clientId, contractId: contract.id, offerId: offer.id, lines: ids };
}

const create = (fx: Fixture, type: string, extra: Record<string, unknown> = {}) =>
  admin.post('/invoices', { projectId: fx.projectId, clientId: fx.clientId, type, lines: [], ...extra });
const send = (id: string) => ok(admin.patch(`/invoices/${id}/status`, { status: 'sent' }));
const pay = (inv: any) =>
  ok(admin.post(`/invoices/${inv.id}/payments`, { amountCents: Number(inv.totalTtcCents), paymentDate: '2026-10-01', paymentMethod: 'bank_transfer' }));
const position = (offerLineId: string, cumulativeQuantity: number) => ({ offerLineId, description: 'pos', unitPriceCents: 0, cumulativeQuantity });

/** The journal lines an invoice's issue (or a payment on it) posted, as signed amounts per account. */
async function journal(referenceIds: string[], referenceType?: string) {
  const { rows } = await db.query(
    `SELECT a.account_number AS account, (l.debit_cents - l.credit_cents)::int AS amount, l.description
       FROM journal_entry e
       JOIN journal_entry_line l ON l.journal_entry_id = e.id
       JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE e.company_id = $1 AND e.reference_id = ANY($2::uuid[]) AND ($3::text IS NULL OR e.reference_type = $3)
      ORDER BY e.entry_number`,
    [COMPANY_A, referenceIds, referenceType ?? null],
  );
  return rows as { account: string; amount: number; description: string }[];
}
/** Order-independent: the lines of one entry share their created_at. */
const posted = (rows: { account: string; amount: number }[]) =>
  rows.map(({ account, amount }) => ({ account, amount })).sort((a, b) => a.account.localeCompare(b.account) || a.amount - b.amount);
const sortedLines = (lines: { account: string; amount: number }[]) => posted(lines);
const balance = (rows: { account: string; amount: number }[], account: string) =>
  rows.filter((r) => r.account === account).reduce((s, r) => s + r.amount, 0);

describe('Final invoice (décompte final) and retention release', () => {
  it('holds the contract retention on situations and releases it, settled and journaled, on the final invoice', async () => {
    const fx = await projectWithOffer('Final invoice');
    const [cable, socket] = fx.lines;
    // Retention is configurable per contract (PRD §15.4): situations default to the contract's rate.
    await ok(admin.patch(`/contracts/${fx.contractId}`, { retentionRate: 1_000 }));

    const acompte = await ok(create(fx, 'acompte', { lines: [{ description: 'Acompte', unit: 'forfait', quantity: 1, unitPriceCents: 10_000 }] }));
    await send(acompte.id);
    const s1 = await ok(create(fx, 'situation', { lines: [position(cable, 50), position(socket, 10)] }));
    await send(s1.id);
    const subtotal1 = Number(s1.subtotalHtCents);
    expect({ retention: Number(s1.retentionAmountCents), deducts: Number(s1.priorAcomptesCents) })
      .toEqual({ retention: swiss(Math.round(subtotal1 * 0.1)), deducts: Number(acompte.totalTtcCents) });
    const held = Number(s1.retentionAmountCents);

    // Before the réception finale there is no final invoice.
    expect(rule(await create(fx, 'final_invoice'))).toBe('FINAL_ACCEPTANCE_REQUIRED');
    expect((await admin.post(`/contracts/${fx.contractId}/final-acceptance`, { acceptedOn: '2099-01-01' })).status).toBe(400);
    const accepted = await ok(admin.post(`/contracts/${fx.contractId}/final-acceptance`, { acceptedOn: recently, notes: 'Sans réserve' }));
    expect(accepted.finalAcceptanceDate).toBe(recently);

    // Drafts must be issued or cancelled first: they hold retention / reserve acomptes.
    const draft = await ok(create(fx, 'situation', { lines: [position(cable, 60)] }));
    expect(rule(await create(fx, 'final_invoice'))).toBe('FINAL_INVOICE_DRAFTS_PENDING');
    await ok(admin.patch(`/invoices/${draft.id}/status`, { status: 'cancelled' }));

    const pv = await ok(admin.post('/invoices/plus-values', { projectId: fx.projectId, description: 'Prises supplémentaires', amountCents: 20_000 }));
    await ok(admin.patch(`/invoices/plus-values/${pv.id}/status`, { status: 'approved', approvedByClient: true }));

    const preview = await ok(admin.get(`/invoices/project/${fx.projectId}/final-preview`));
    const cablePrice = preview.positions.find((p: any) => p.offerLineId === cable).unitPriceCents;
    expect({
      canCreate: preview.canCreate, retentionRate: preview.contract.retentionRate, release: preview.retentionToReleaseCents,
      acomptes: preview.acomptesToDeductCents, billedHt: preview.billedSoFar.subtotalHtCents,
      cableRemaining: preview.positions.find((p: any) => p.offerLineId === cable).remainingOfferQuantity,
      plusValues: preview.plusValuesToInvoice.map((p: any) => p.id),
    }).toEqual({
      canCreate: true, retentionRate: 1_000, release: held, acomptes: 0, billedHt: subtotal1,
      cableRemaining: 50, plusValues: [pv.id],
    });

    // Final: the remaining 50 m of cable + the plus-value, no retention held, the held one released.
    const final = await ok(create(fx, 'final_invoice', { lines: [position(cable, 100)], plusValueIds: [pv.id] }));
    const finalHt = 50 * cablePrice + 20_000;
    const finalVat = swiss(Math.round((finalHt * 810) / 10_000));
    expect({
      ht: Number(final.subtotalHtCents), vat: Number(final.vatAmountCents), retention: Number(final.retentionAmountCents),
      deducts: Number(final.priorAcomptesCents), total: Number(final.totalTtcCents), situationNumber: final.situationNumber,
    }).toEqual({
      ht: finalHt, vat: finalVat, retention: -held, deducts: 0, total: swiss(finalHt + finalVat + held), situationNumber: null,
    });

    // One final invoice per project, and nothing billed by situation or acompte after it.
    expect(rule(await create(fx, 'final_invoice'))).toBe('FINAL_INVOICE_EXISTS');
    expect(rule(await create(fx, 'situation', { lines: [position(socket, 10)] }))).toBe('FINAL_INVOICE_ISSUED');
    expect(rule(await create(fx, 'acompte', { lines: [{ description: 'x', quantity: 1, unitPriceCents: 100 }] }))).toBe('FINAL_INVOICE_ISSUED');
    expect(rule(await admin.post(`/contracts/${fx.contractId}/final-acceptance`, { acceptedOn: recently }))).toBe('FINAL_INVOICE_EXISTS');

    // Journal: client debited the total, retention receivable (held on 1100 by the situation) cleared.
    await send(final.id);
    const total = Number(final.totalTtcCents);
    expect(posted(await journal([final.id], 'invoice'))).toEqual(sortedLines([
      { account: '1100', amount: total },
      { account: '1100', amount: -held },
      { account: '2200', amount: -finalVat },
      { account: '3000', amount: -(total - held - finalVat) },
    ]));

    // Everything before the final invoice is settled by it: credit the final first.
    expect(rule(await admin.post(`/invoices/${s1.id}/credit-note`))).toBe('FINAL_INVOICE_ISSUED');

    // Crediting the final reverses it (the retention is held again) and frees the project.
    const credit = await ok(admin.post(`/invoices/${final.id}/credit-note`));
    expect(posted(await journal([credit.id], 'invoice'))).toEqual(sortedLines([
      { account: '1100', amount: -total },
      { account: '1100', amount: held },
      { account: '2200', amount: finalVat },
      { account: '3000', amount: total - held - finalVat },
    ]));
    const again = await ok(admin.get(`/invoices/project/${fx.projectId}/final-preview`));
    expect({ final: again.finalInvoice, release: again.retentionToReleaseCents, plusValues: again.plusValuesToInvoice.length })
      .toEqual({ final: null, release: held, plusValues: 1 });

    const final2 = await ok(create(fx, 'final_invoice', { lines: [position(cable, 100)], plusValueIds: [pv.id] }));
    expect(Number(final2.totalTtcCents)).toBe(total);
    await send(final2.id);

    // Once every live invoice is paid, the project's receivable (1100) and advances (2030) are at zero.
    for (const inv of [acompte, s1, final2]) await pay(inv);
    const ids = [acompte.id, s1.id, final.id, credit.id, final2.id];
    const rows = await journal(ids);
    expect({ receivable: balance(rows, '1100'), advances: balance(rows, '2030'), all: rows.reduce((s, r) => s + r.amount, 0) })
      .toEqual({ receivable: 0, advances: 0, all: 0 });
    const summary = await ok(admin.get(`/invoices/project/${fx.projectId}/summary`));
    expect(summary.retentionHeldCents).toBe(0);
  });

  it('deducts the acomptes no situation deducted yet, and may only release retention (no lines)', async () => {
    const fx = await projectWithOffer('Final acomptes');
    const s1 = await ok(create(fx, 'situation', { retentionRate: 500, lines: [position(fx.lines[0], 100)] }));
    await send(s1.id);
    const acompte = await ok(create(fx, 'acompte', { lines: [{ description: 'Acompte', quantity: 1, unitPriceCents: 1_000 }] }));
    await send(acompte.id);
    await ok(admin.post(`/contracts/${fx.contractId}/final-acceptance`, { acceptedOn: recently }));

    const final = await ok(create(fx, 'final_invoice'));
    const held = Number(s1.retentionAmountCents);
    expect({
      lines: final.lines.length, ht: Number(final.subtotalHtCents), retention: Number(final.retentionAmountCents),
      deducts: Number(final.priorAcomptesCents), total: Number(final.totalTtcCents),
    }).toEqual({
      lines: 0, ht: 0, retention: -held, deducts: Number(acompte.totalTtcCents), total: swiss(held - Number(acompte.totalTtcCents)),
    });
    await send(final.id);
    expect(posted(await journal([final.id], 'invoice'))).toEqual(sortedLines([
      { account: '1100', amount: Number(final.totalTtcCents) },
      { account: '1100', amount: -held },
      { account: '2030', amount: Number(acompte.totalTtcCents) },
    ]));
  });

  it('records the final acceptance only on a signed contract', async () => {
    const client = await ok(admin.post('/clients', { name: 'Unsigned acceptance client' }));
    const offer = await ok(admin.post('/offers', { projectName: 'Unsigned acceptance', clientId: client.id }));
    await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
    await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'accepted' }));
    const contract = await ok(admin.post('/contracts/from-offer', { offerId: offer.id }));
    expect(rule(await admin.post(`/contracts/${contract.id}/final-acceptance`, { acceptedOn: recently }))).toBe('CONTRACT_NOT_SIGNED');
    expect((await adminB.post(`/contracts/${contract.id}/final-acceptance`, { acceptedOn: recently })).status).toBe(404);
  });
});

describe('Invoice number format per company', () => {
  // Company B, restored afterwards: company A's numbering is asserted elsewhere.
  afterAll(async () => {
    await adminB.put('/invoices/settings/number-format', { format: '{YYYY}-{NNN}' });
  });

  it('numbers in the configured format, gaplessly, and keeps the earlier series valid', async () => {
    const year = new Date().getFullYear();
    const projectId = await createProject(adminB, 'Format B');
    const clientId = (await ok(adminB.get(`/projects/${projectId}`))).clientId;
    const invoice = () =>
      ok(adminB.post('/invoices', { projectId, clientId, type: 'invoice', lines: [{ description: 'x', quantity: 1, unitPriceCents: 1_000 }] }));

    const initial = await ok(adminB.get('/invoices/settings/number-format'));
    expect(initial.format).toBe('{YYYY}-{NNN}');
    expect(initial.nextNumber).toMatch(new RegExp(`^${year}-\\d{3,}$`));
    const legacy = await invoice();
    expect(legacy.invoiceNumber).toBe(initial.nextNumber);

    for (const bad of ['{YYYY}', 'F-{NNN}-{NN}', 'F#{NNN}', '{YYYY}{YY}-{NNN}', 'x'.repeat(41) + '{NNN}']) {
      expect({ bad, status: (await adminB.put('/invoices/settings/number-format', { format: bad })).status }).toEqual({ bad, status: 400 });
    }
    expect((await pm.put('/invoices/settings/number-format', { format: 'F-{NNN}' })).status).toBe(403);

    const set = await ok(adminB.put('/invoices/settings/number-format', { format: 'F-{YY}/{NNNN}' }));
    const yy = String(year % 100).padStart(2, '0');
    expect(set).toEqual({ format: 'F-{YY}/{NNNN}', nextNumber: `F-${yy}/0001` });
    const concurrent = await Promise.all([invoice(), invoice(), invoice()]);
    expect(concurrent.map((i) => i.invoiceNumber).sort()).toEqual([`F-${yy}/0001`, `F-${yy}/0002`, `F-${yy}/0003`]);

    // Back to the default: its series continues where it stopped.
    await ok(adminB.put('/invoices/settings/number-format', { format: '{YYYY}-{NNN}' }));
    const seq = (n: string) => Number(n.split('-')[1]);
    const next = await invoice();
    expect(next.invoiceNumber).toBe(`${year}-${String(seq(legacy.invoiceNumber) + 1).padStart(3, '0')}`);
  });
});

describe('Acompte schedule', () => {
  it('plans acomptes, bills each once, and lists the ones due to be issued', async () => {
    const fx = await projectWithOffer('Acompte schedule');
    const other = await projectWithOffer('Acompte schedule other');
    const plan = (body: Record<string, unknown>, contractId = fx.contractId) =>
      admin.post(`/contracts/${contractId}/acompte-schedule`, body);

    expect((await plan({ dueDate: '2026-09-01' })).status).toBe(400);
    expect((await plan({ dueDate: '2026-09-01', amountHtCents: 100, percentBps: 100 })).status).toBe(400);
    const start = await ok(plan({ dueDate: '2026-09-01', amountHtCents: 50_000, label: 'Démarrage' }));
    const later = await ok(plan({ dueDate: '2030-01-15', percentBps: 1_000 }));
    const foreign = await ok(plan({ dueDate: '2026-09-01', amountHtCents: 1_000 }, other.contractId));

    const offer = await ok(admin.get(`/offers/${fx.offerId}`));
    expect({ start: [start.status, start.amountHtCents], later: [later.status, later.amountHtCents] })
      .toEqual({ start: ['planned', 50_000], later: ['planned', Math.round(Number(offer.totalHtCents) * 0.1)] });

    const due = (asOf: string) => ok(admin.get(`/contracts/acompte-schedule/due?projectId=${fx.projectId}&asOf=${asOf}`));
    const dueNow = await due('2026-10-01');
    expect(dueNow.map((d: any) => ({ id: d.id, daysLate: d.daysLate, projectId: d.projectId })))
      .toEqual([{ id: start.id, daysLate: 30, projectId: fx.projectId }]);
    expect((await due('2030-01-15')).map((d: any) => d.id)).toEqual([start.id, later.id]);
    expect((await ok(admin.get('/contracts/acompte-schedule/due?asOf=2026-10-01&withinDays=30'))).length).toBeGreaterThan(0);
    expect((await admin.get('/contracts/acompte-schedule/due?asOf=2026-13-01')).status).toBe(400);

    // Billing it: the planned amount when no line is given; once only; only on an acompte of its project.
    expect((await create(fx, 'situation', { acompteScheduleItemId: start.id, lines: [{ description: 'x', quantity: 1, unitPriceCents: 1 }] })).status).toBe(400);
    expect(rule(await create(fx, 'acompte', { acompteScheduleItemId: foreign.id }))).toBe('ACOMPTE_SCHEDULE_ITEM_NOT_IN_PROJECT');
    const acompte = await ok(create(fx, 'acompte', { acompteScheduleItemId: start.id }));
    expect({ ht: Number(acompte.subtotalHtCents), item: acompte.acompteScheduleItemId, label: acompte.lines[0].description })
      .toEqual({ ht: 50_000, item: start.id, label: 'Acompte : Démarrage' });
    expect(rule(await create(fx, 'acompte', { acompteScheduleItemId: start.id }))).toBe('ACOMPTE_SCHEDULE_ITEM_INVOICED');
    expect(rule(await admin.patch(`/contracts/${fx.contractId}/acompte-schedule/${start.id}`, { amountHtCents: 1 }))).toBe('ACOMPTE_SCHEDULE_ITEM_INVOICED');

    // A draft still has to be issued; a sent acompte no longer is due; a credited one is due again.
    expect((await due('2026-10-01')).map((d: any) => [d.id, d.status, d.invoiceId])).toEqual([[start.id, 'draft', acompte.id]]);
    await send(acompte.id);
    expect(await due('2026-10-01')).toEqual([]);
    const schedule = await ok(admin.get(`/contracts/${fx.contractId}/acompte-schedule`));
    expect(schedule.map((s: any) => [s.id, s.status, s.invoiceNumber])).toEqual([
      [start.id, 'issued', acompte.invoiceNumber],
      [later.id, 'planned', null],
    ]);
    await ok(admin.post(`/invoices/${acompte.id}/credit-note`));
    expect((await due('2026-10-01')).map((d: any) => [d.id, d.status])).toEqual([[start.id, 'planned']]);

    // A planned item can be changed or removed while nothing bills it.
    const moved = await ok(admin.patch(`/contracts/${fx.contractId}/acompte-schedule/${later.id}`, { dueDate: '2026-09-15', amountHtCents: 7_000 }));
    expect([moved.dueDate, moved.amountHtCents, moved.percentBps]).toEqual(['2026-09-15', 7_000, null]);
    await ok(admin.del(`/contracts/${fx.contractId}/acompte-schedule/${later.id}`));
    expect((await admin.del(`/contracts/${fx.contractId}/acompte-schedule/${later.id}`)).status).toBe(404);
    expect((await adminB.get(`/contracts/${fx.contractId}/acompte-schedule`)).status).toBe(404);
  });
});
