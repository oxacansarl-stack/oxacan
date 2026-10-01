import { describe, it, expect } from 'vitest';
import { apiClient, tokenFor, USER_A, USER_B, PM_A, TEAM_LEAD_A, WORKER_1_A, WORKER_2_A } from './setup';

/*
 * Executed quantities per offer position (PRD §10 field operations, §15.2 situations on executed
 * quantities): an append-only ledger recorded by team leaders (on projects they are assigned to)
 * and project managers, corrected by new entries, and validated by a project manager before a
 * situation may bill it.
 */

const admin = apiClient(tokenFor(USER_A.authId));
const pm = apiClient(tokenFor(PM_A.authId));
const lead = apiClient(tokenFor(TEAM_LEAD_A.authId));
const worker = apiClient(tokenFor(WORKER_1_A.authId));
const otherCompany = apiClient(tokenFor(USER_B.authId));

async function ok(p: Promise<{ status: number; data: any; error: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}

interface Fixture { projectId: string; clientId: string; lines: string[] }

const LINES = [
  { description: 'Tirage de câble', unit: 'm', quantity: 100, unitPriceCents: 1_000 },
  { description: 'Prise T13', unit: 'pce', quantity: 10, unitPriceCents: 5_000 },
];

/** Offer → accepted → signed contract → project, with a task assigned to `assignee` (if any). */
async function project(name: string, assignee?: string): Promise<Fixture> {
  const client = await ok(admin.post('/clients', { name: `${name} client` }));
  const offer = await ok(admin.post('/offers', { projectName: name, clientId: client.id }));
  const ids: string[] = [];
  for (const l of LINES) ids.push((await ok(admin.post(`/offers/${offer.id}/lines`, l))).id);
  await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
  await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'accepted' }));
  const contract = await ok(admin.post('/contracts/from-offer', { offerId: offer.id }));
  await ok(admin.patch(`/contracts/${contract.id}/status`, { status: 'signed' }));
  const projects: any[] = await ok(admin.get('/projects?limit=500'));
  const p = projects.find((x) => x.contractId === contract.id);
  if (assignee) await ok(admin.post(`/projects/${p.id}/tasks`, { title: 'Électricité', assignedTo: assignee }));
  return { projectId: p.id, clientId: p.clientId, lines: ids };
}

const base = (fx: Fixture) => `/projects/${fx.projectId}/executed-quantities`;
const positions = async (fx: Fixture) => {
  const rows: any[] = await ok(pm.get(`${base(fx)}/positions`));
  return Object.fromEntries(rows.map((r) => [r.offerLineId, r]));
};

describe('Executed quantities', () => {
  it('records deltas and cumulatives, and only validated entries count as executed', async () => {
    const fx = await project('EQ ledger', TEAM_LEAD_A.id);
    const [cable, socket] = fx.lines;

    const first = await ok(lead.post(base(fx), { offerLineId: cable, quantity: 30, note: 'Étage 1' }));
    const second = await ok(lead.post(base(fx), { offerLineId: cable, cumulativeQuantity: 45 }));
    const third = await ok(pm.post(base(fx), { offerLineId: socket, quantity: 4 }));
    expect([first, second, third].map((e) => [e.entryType, Number(e.quantityDelta), Number(e.cumulativeQuantity), e.recordedById]))
      .toEqual([
        ['delta', 30, 30, TEAM_LEAD_A.id],
        ['cumulative', 15, 45, TEAM_LEAD_A.id],
        ['delta', 4, 4, PM_A.id],
      ]);

    let pos = await positions(fx);
    expect([pos[cable], pos[socket]].map((p) => [p.offerQuantity, p.recordedQuantity, p.validatedQuantity, p.pendingQuantity, p.pendingEntries]))
      .toEqual([[100, 45, 0, 45, 2], [10, 4, 0, 4, 1]]);
    let preview = await ok(admin.get(`/invoices/project/${fx.projectId}/situation-preview`));
    expect(preview.positions.map((p: any) => p.executedQuantity)).toEqual([null, null]);

    const validated = await ok(pm.post(`${base(fx)}/validate`, { entryIds: [first.id, third.id] }));
    expect(validated.validated).toBe(2);

    pos = await positions(fx);
    expect([pos[cable].validatedQuantity, pos[cable].pendingQuantity, pos[socket].validatedQuantity]).toEqual([30, 15, 4]);
    preview = await ok(admin.get(`/invoices/project/${fx.projectId}/situation-preview`));
    expect(preview.positions.map((p: any) => [p.offerLineId, p.executedQuantity])).toEqual([[cable, 30], [socket, 4]]);

    const pending: any = await lead.get(`${base(fx)}?status=pending`);
    expect(pending.data.map((e: any) => e.id)).toEqual([second.id]);
    const all: any = await lead.get(`${base(fx)}?offerLineId=${cable}`);
    expect(all.data.map((e: any) => [e.id, !!e.validatedAt, e.recordedBy?.id])).toEqual([
      [second.id, false, TEAM_LEAD_A.id],
      [first.id, true, TEAM_LEAD_A.id],
    ]);
  });

  it('fixes mistakes with correction entries, never by editing an entry', async () => {
    const fx = await project('EQ corrections', TEAM_LEAD_A.id);
    const [cable] = fx.lines;
    const entry = await ok(lead.post(base(fx), { offerLineId: cable, quantity: 10 }));
    await ok(pm.post(`${base(fx)}/validate`, { entryIds: [entry.id] }));

    const correction = await ok(lead.post(`${base(fx)}/${entry.id}/corrections`, { correctedQuantity: 8, note: 'Remesuré: 8 m' }));
    expect([correction.entryType, Number(correction.quantityDelta), Number(correction.cumulativeQuantity), correction.correctsEntryId, correction.validatedAt])
      .toEqual(['correction', -2, 8, entry.id, null]);

    // Correcting again is relative to the entry with its earlier corrections.
    const again = await ok(lead.post(`${base(fx)}/${entry.id}/corrections`, { correctedQuantity: 9, note: 'Finalement 9 m' }));
    expect(Number(again.quantityDelta)).toBe(1);

    const noNote = await lead.post(`${base(fx)}/${entry.id}/corrections`, { correctedQuantity: 7, note: '   ' });
    const same = await lead.post(`${base(fx)}/${entry.id}/corrections`, { correctedQuantity: 9, note: 'idem' });
    const ofCorrection = await lead.post(`${base(fx)}/${correction.id}/corrections`, { correctedQuantity: 0, note: 'x' });
    expect([noNote.status, same.status, (same.error as any)?.details?.rule, ofCorrection.status, (ofCorrection.error as any)?.details?.rule])
      .toEqual([400, 422, 'NOTHING_TO_CORRECT', 422, 'CANNOT_CORRECT_A_CORRECTION']);

    // A cumulative below the recorded total is a correction, not a new measurement.
    const backwards = await lead.post(base(fx), { offerLineId: cable, cumulativeQuantity: 5 });
    expect([backwards.status, (backwards.error as any)?.details?.rule]).toEqual([422, 'CUMULATIVE_NOT_ABOVE_RECORDED']);

    // The original entry is untouched; the validated quantity only moves once corrections are validated.
    const list: any = await pm.get(`${base(fx)}?offerLineId=${cable}`);
    const original = list.data.find((e: any) => e.id === entry.id);
    expect([Number(original.quantityDelta), (await positions(fx))[cable].validatedQuantity, (await positions(fx))[cable].recordedQuantity])
      .toEqual([10, 10, 9]);
    await ok(pm.post(`${base(fx)}/validate`, { entryIds: [correction.id, again.id] }));
    expect((await positions(fx))[cable].validatedQuantity).toBe(9);
  });

  it('validates a correction only with or after the entry it corrects, and each entry once', async () => {
    const fx = await project('EQ validation order', TEAM_LEAD_A.id);
    const [cable] = fx.lines;
    const entry = await ok(lead.post(base(fx), { offerLineId: cable, quantity: 10 }));
    const correction = await ok(lead.post(`${base(fx)}/${entry.id}/corrections`, { correctedQuantity: 6, note: 'Erreur de saisie' }));

    const early = await pm.post(`${base(fx)}/validate`, { entryIds: [correction.id] });
    expect([early.status, (early.error as any)?.details?.rule]).toEqual([422, 'CORRECTED_ENTRY_NOT_VALIDATED']);

    const both = await ok(pm.post(`${base(fx)}/validate`, { entryIds: [entry.id, correction.id] }));
    expect([both.validated, both.positions[0].validatedQuantity]).toEqual([2, 6]);

    const twice = await pm.post(`${base(fx)}/validate`, { entryIds: [entry.id] });
    const unknown = await pm.post(`${base(fx)}/validate`, { entryIds: ['00000000-0000-4000-8000-00000000dead'] });
    expect([twice.status, (twice.error as any)?.details?.rule, unknown.status]).toEqual([422, 'EXECUTED_QUANTITY_ALREADY_VALIDATED', 404]);
  });

  it('lets a team leader work only on projects they are assigned to, and only a project manager validate', async () => {
    const own = await project('EQ access own', TEAM_LEAD_A.id);
    const viaTeam = await project('EQ access team', WORKER_1_A.id); // WORKER_1 is in the leader's team
    const foreign = await project('EQ access foreign', WORKER_2_A.id);

    const entry = await ok(lead.post(base(own), { offerLineId: own.lines[0], quantity: 1 }));
    await ok(lead.post(base(viaTeam), { offerLineId: viaTeam.lines[0], quantity: 1 }));

    const results = await Promise.all([
      lead.post(base(foreign), { offerLineId: foreign.lines[0], quantity: 1 }),
      lead.get(`${base(foreign)}/positions`),
      lead.get(base(foreign)),
      lead.post(`${base(own)}/validate`, { entryIds: [entry.id] }),
      worker.post(base(own), { offerLineId: own.lines[0], quantity: 1 }),
      worker.get(`${base(own)}/positions`),
      otherCompany.get(`${base(own)}/positions`),
      otherCompany.post(base(own), { offerLineId: own.lines[0], quantity: 1 }),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 404, 404]);

    // The project manager and the admin may work on any project of the company.
    await ok(pm.post(base(foreign), { offerLineId: foreign.lines[0], quantity: 2 }));
    expect((await ok(admin.get(`${base(foreign)}/positions`)))[0].recordedQuantity).toBe(2);
  });

  it('only records on the project\'s own priced positions, with links from the same project', async () => {
    const fx = await project('EQ scope A', TEAM_LEAD_A.id);
    const other = await project('EQ scope B', TEAM_LEAD_A.id);
    const [cable] = fx.lines;

    const foreignLine = await lead.post(base(fx), { offerLineId: other.lines[0], quantity: 1 });
    expect([foreignLine.status, (foreignLine.error as any)?.details?.rule]).toEqual([422, 'OFFER_LINE_NOT_IN_PROJECT']);

    const both = await lead.post(base(fx), { offerLineId: cable, quantity: 1, cumulativeQuantity: 2 });
    const neither = await lead.post(base(fx), { offerLineId: cable });
    const zero = await lead.post(base(fx), { offerLineId: cable, quantity: 0 });
    expect([both.status, neither.status, zero.status]).toEqual([400, 400, 400]);

    const task = await ok(admin.post(`/projects/${fx.projectId}/tasks`, { title: 'Tirage', assignedTo: TEAM_LEAD_A.id }));
    const otherTask = await ok(admin.post(`/projects/${other.projectId}/tasks`, { title: 'Ailleurs' }));
    const report = await ok(lead.post('/daily-reports', { projectId: fx.projectId, date: '2026-09-15', workDescription: 'Câbles' }));
    const otherReport = await ok(lead.post('/daily-reports', { projectId: other.projectId, date: '2026-09-15' }));

    const linked = await ok(lead.post(base(fx), { offerLineId: cable, quantity: 12, taskId: task.id, dailyReportId: report.id }));
    expect([linked.taskId, linked.dailyReportId]).toEqual([task.id, report.id]);

    const badTask = await lead.post(base(fx), { offerLineId: cable, quantity: 1, taskId: otherTask.id });
    const badReport = await lead.post(base(fx), { offerLineId: cable, quantity: 1, dailyReportId: otherReport.id });
    expect([badTask.status, (badTask.error as any)?.details?.rule, badReport.status, (badReport.error as any)?.details?.rule])
      .toEqual([422, 'TASK_NOT_IN_PROJECT', 422, 'DAILY_REPORT_NOT_IN_PROJECT']);

    // Deleting the daily report keeps the entry and only drops the link.
    await ok(lead.del(`/daily-reports/${report.id}`));
    const after: any = await lead.get(base(fx));
    expect(after.data.map((e: any) => [Number(e.quantityDelta), e.dailyReportId, e.taskId])).toEqual([[12, null, task.id]]);
  });

  // Needs the createInvoice default (situationLineCumulativeQuantity) wired in by the invoicing owner.
  it('bills the validated executed quantity when a situation line gives no cumulative quantity', async () => {
    const fx = await project('EQ situation', TEAM_LEAD_A.id);
    const [cable, socket] = fx.lines;
    const entry = await ok(lead.post(base(fx), { offerLineId: cable, quantity: 40 }));
    await ok(lead.post(base(fx), { offerLineId: cable, quantity: 5 })); // pending: not billable yet
    await ok(pm.post(`${base(fx)}/validate`, { entryIds: [entry.id] }));

    const situation = await ok(admin.post('/invoices', {
      projectId: fx.projectId, clientId: fx.clientId, type: 'situation', retentionRate: 0, vatRate: 0,
      lines: [{ offerLineId: cable, description: 'Câble', unitPriceCents: 1_000 }],
    }));
    expect([Number(situation.lines[0].cumulativeQuantity), Number(situation.lines[0].periodQuantity)]).toEqual([40, 40]);

    // Nothing validated for the socket: its cumulative quantity is still required.
    const missing = await admin.post('/invoices', {
      projectId: fx.projectId, clientId: fx.clientId, type: 'situation', retentionRate: 0, vatRate: 0,
      lines: [{ offerLineId: socket, description: 'Prise', unitPriceCents: 5_000 }],
    });
    expect(missing.status).toBe(400);
  });
});
