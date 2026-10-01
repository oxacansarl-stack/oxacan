import { describe, it, expect } from 'vitest';
import { apiClient, tokenFor, USER_A } from './setup';

/*
 * Situations de travaux (PRD §15.2): billed per position of the contracted offer on the quantity
 * executed to date; the server computes what earlier situations already billed, numbers them
 * Situation 1, 2, … per project, and still deducts each acompte once.
 */

const admin = apiClient(tokenFor(USER_A.authId));

async function ok(p: Promise<{ status: number; data: any; error: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}

interface Fixture {
  projectId: string;
  clientId: string;
  /** offer line ids, in the order they were added */
  lines: string[];
  marginFactor: number;
}

/** Offer with priced BASE lines → accepted → contract signed → project. */
async function projectWithOffer(name: string, lines: { description: string; unit: string; quantity: number; unitPriceCents: number }[]): Promise<Fixture> {
  const client = await ok(admin.post('/clients', { name: `${name} client` }));
  const offer = await ok(admin.post('/offers', { projectName: name, clientId: client.id }));
  const ids: string[] = [];
  for (const l of lines) ids.push((await ok(admin.post(`/offers/${offer.id}/lines`, l))).id);
  await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
  await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'accepted' }));
  const contract = await ok(admin.post('/contracts/from-offer', { offerId: offer.id }));
  await ok(admin.patch(`/contracts/${contract.id}/status`, { status: 'signed' }));
  const projects: any[] = await ok(admin.get('/projects?limit=500'));
  const project = projects.find((p) => p.contractId === contract.id);
  const { marginFactor } = await ok(admin.get(`/offers/${offer.id}`));
  return { projectId: project.id, clientId: project.clientId, lines: ids, marginFactor: Number(marginFactor) };
}

const STANDARD_LINES = [
  { description: 'Tirage de câble', unit: 'm', quantity: 100, unitPriceCents: 1_000 },
  { description: 'Prise T13', unit: 'pce', quantity: 10, unitPriceCents: 5_000 },
];

function situation(fx: Fixture, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return admin.post('/invoices', {
    projectId: fx.projectId, clientId: fx.clientId, type: 'situation', retentionRate: 0, vatRate: 0, lines, ...extra,
  });
}

const line = (offerLineId: string, cumulativeQuantity: number | undefined, unitPriceCents = 1_000) => ({
  offerLineId, description: 'pos', unitPriceCents, ...(cumulativeQuantity === undefined ? {} : { cumulativeQuantity }),
});

const byOfferLine = (inv: any) => Object.fromEntries((inv.lines as any[]).map((l) => [l.offerLineId, l]));

describe('Situations', () => {
  it('computes the previously billed quantity on the server and bills only the period', async () => {
    const fx = await projectWithOffer('Situation quantities', STANDARD_LINES);
    const [cable, socket] = fx.lines;

    const preview = await ok(admin.get(`/invoices/project/${fx.projectId}/situation-preview`));
    expect(preview.situationNumber).toBe(1);
    expect(preview.positions.map((p: any) => ({ id: p.offerLineId, budget: p.offerQuantity, previous: p.previousQuantity, price: p.unitPriceCents })))
      .toEqual([
        { id: cable, budget: 100, previous: 0, price: Math.round((1_000 * fx.marginFactor) / 100) },
        { id: socket, budget: 10, previous: 0, price: Math.round((5_000 * fx.marginFactor) / 100) },
      ]);

    // Positions bill at the offer's selling price, whatever price the request carries.
    const cablePrice = Math.round((1_000 * fx.marginFactor) / 100);
    const socketPrice = Math.round((5_000 * fx.marginFactor) / 100);
    const first = await ok(situation(fx, [line(cable, 40), line(socket, 2, 6_000)]));
    const second = await ok(situation(fx, [line(cable, 70), line(socket, 2, 6_000)]));

    const q = (inv: any, id: string) => {
      const l = byOfferLine(inv)[id];
      return { budget: Number(l.quantity), previous: Number(l.previousQuantity), cumulative: Number(l.cumulativeQuantity), period: Number(l.periodQuantity), total: Number(l.totalPriceCents) };
    };
    expect({
      numbers: [first.situationNumber, second.situationNumber],
      firstCable: q(first, cable), firstSocket: q(first, socket),
      secondCable: q(second, cable), secondSocket: q(second, socket),
      subtotals: [Number(first.subtotalHtCents), Number(second.subtotalHtCents)],
    }).toEqual({
      numbers: [1, 2],
      firstCable: { budget: 100, previous: 0, cumulative: 40, period: 40, total: 40 * cablePrice },
      firstSocket: { budget: 10, previous: 0, cumulative: 2, period: 2, total: 2 * socketPrice },
      secondCable: { budget: 100, previous: 40, cumulative: 70, period: 30, total: 30 * cablePrice },
      secondSocket: { budget: 10, previous: 2, cumulative: 2, period: 0, total: 0 },
      subtotals: [40 * cablePrice + 2 * socketPrice, 30 * cablePrice],
    });

    const after = await ok(admin.get(`/invoices/project/${fx.projectId}/situation-preview`));
    expect({ next: after.situationNumber, previous: after.positions.map((p: any) => p.previousQuantity) })
      .toEqual({ next: 3, previous: [70, 2] });
  });

  it('rejects a cumulative quantity below what was billed, a client-sent previous quantity, and a missing cumulative', async () => {
    const fx = await projectWithOffer('Situation rejects', STANDARD_LINES);
    const [cable] = fx.lines;
    await ok(situation(fx, [line(cable, 50)]));

    const backwards = await situation(fx, [line(cable, 49)]);
    const forgedPrevious = await situation(fx, [{ ...line(cable, 60), previousQuantity: 59 }]);
    const missing = await situation(fx, [line(cable, undefined)]);
    expect([backwards.status, forgedPrevious.status, missing.status]).toEqual([400, 400, 400]);

    // Nothing was created by the rejected requests: the next situation is still number 2.
    const preview = await ok(admin.get(`/invoices/project/${fx.projectId}/situation-preview`));
    expect({ next: preview.situationNumber, previous: preview.positions[0].previousQuantity }).toEqual({ next: 2, previous: 50 });
  });

  it('only bills positions of the project\'s own offer, once per situation, and tracks cumulatives per position only', async () => {
    const fx = await projectWithOffer('Situation scope A', STANDARD_LINES);
    const other = await projectWithOffer('Situation scope B', STANDARD_LINES);

    const foreign = await situation(fx, [line(other.lines[0], 5)]);
    expect(foreign.status).toBe(422);
    expect((foreign.error as any)?.details?.rule).toBe('OFFER_LINE_NOT_IN_PROJECT');

    const duplicate = await situation(fx, [line(fx.lines[0], 5), line(fx.lines[0], 6)]);
    const freeCumulative = await situation(fx, [{ description: 'Hors offre', unit: 'h', quantity: 1, unitPriceCents: 1_000, cumulativeQuantity: 3 }]);
    const onPlainInvoice = await admin.post('/invoices', {
      projectId: fx.projectId, clientId: fx.clientId, type: 'invoice', lines: [line(fx.lines[0], 5)],
    });
    expect([duplicate.status, freeCumulative.status, onPlainInvoice.status]).toEqual([400, 400, 400]);

    // A free line (no position) on a situation is billed quantity × price, as before.
    const free = await ok(situation(fx, [{ description: 'Régie', unit: 'h', quantity: 3, unitPriceCents: 9_000 }]));
    expect({ subtotal: Number(free.subtotalHtCents), period: free.lines[0].periodQuantity, number: free.situationNumber })
      .toEqual({ subtotal: 27_000, period: null, number: 1 });
  });

  it('gives quantities and numbers back when a draft is cancelled or a situation credited, without touching invoice numbering', async () => {
    const fx = await projectWithOffer('Situation lifecycle', STANDARD_LINES);
    const [cable] = fx.lines;
    const seq = (n: string) => Number(n.split('-')[1]);

    const cancelled = await ok(situation(fx, [line(cable, 30)]));
    await ok(admin.patch(`/invoices/${cancelled.id}/status`, { status: 'cancelled' }));
    const s1 = await ok(situation(fx, [line(cable, 20)]));
    await ok(admin.patch(`/invoices/${s1.id}/status`, { status: 'sent' }));
    const credit = await ok(admin.post(`/invoices/${s1.id}/credit-note`));
    const s2 = await ok(situation(fx, [line(cable, 25)]));

    expect({
      numbers: [cancelled.situationNumber, s1.situationNumber, s2.situationNumber, credit.situationNumber],
      s1Previous: Number(byOfferLine(s1)[cable].previousQuantity),
      s2: { previous: Number(byOfferLine(s2)[cable].previousQuantity), period: Number(byOfferLine(s2)[cable].periodQuantity) },
      creditKeepsPosition: byOfferLine(credit)[cable]?.offerLineId,
      invoiceNumbersGapless: [cancelled, s1, credit, s2].map((i) => seq(i.invoiceNumber) - seq(cancelled.invoiceNumber)),
    }).toEqual({
      numbers: [1, 1, 2, null],
      s1Previous: 0, // the cancelled draft billed nothing
      s2: { previous: 0, period: 25 }, // the credited situation billed nothing either
      creditKeepsPosition: cable,
      invoiceNumbersGapless: [0, 1, 2, 3],
    });

    // Numbering is per project.
    const elsewhere = await projectWithOffer('Situation lifecycle other', STANDARD_LINES);
    expect((await ok(situation(elsewhere, [line(elsewhere.lines[0], 1)]))).situationNumber).toBe(1);
  });

  it('serialises concurrent situations so a quantity is billed once', async () => {
    const fx = await projectWithOffer('Situation concurrency', STANDARD_LINES);
    const [cable] = fx.lines;
    const results = await Promise.all([situation(fx, [line(cable, 50)]), situation(fx, [line(cable, 50)])]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const periods = results.map((r) => Number(byOfferLine(r.data)[cable].periodQuantity)).sort((a, b) => a - b);
    const numbers = results.map((r) => r.data.situationNumber).sort();
    expect({ periods, numbers }).toEqual({ periods: [0, 50], numbers: [1, 2] });
  });

  it('keeps acompte deduction, plus-value billing and retention working on position-based situations', async () => {
    const fx = await projectWithOffer('Situation acomptes', STANDARD_LINES);
    const [cable] = fx.lines;

    const acompte = await ok(admin.post('/invoices', {
      projectId: fx.projectId, clientId: fx.clientId, type: 'acompte', vatRate: 0,
      lines: [{ description: 'Acompte', unit: 'u', quantity: 1, unitPriceCents: 10_000 }],
    }));
    await ok(admin.patch(`/invoices/${acompte.id}/status`, { status: 'sent' }));
    const preview = await ok(admin.get(`/invoices/project/${fx.projectId}/situation-preview`));

    const pv = await ok(admin.post('/invoices/plus-values', { projectId: fx.projectId, description: 'Prise supplémentaire', amountCents: 5_000 }));
    await ok(admin.patch(`/invoices/plus-values/${pv.id}/status`, { status: 'approved', approvedByClient: true }));

    const first = await ok(situation(fx, [line(cable, 10)], { retentionRate: 500, plusValueIds: [pv.id] }));
    const firstSubtotal = 10 * Math.round((1_000 * fx.marginFactor) / 100) + 5_000;
    const second = await ok(situation(fx, [line(cable, 20)], { retentionRate: 500 }));

    expect({
      acompteRetention: Number(acompte.retentionAmountCents),
      previewDeducts: preview.acomptesToDeductCents,
      first: { subtotal: Number(first.subtotalHtCents), retention: Number(first.retentionAmountCents), deducts: Number(first.priorAcomptesCents), lines: first.lines.length },
      secondDeducts: Number(second.priorAcomptesCents),
      pvRebill: (await situation(fx, [line(cable, 20)], { plusValueIds: [pv.id] })).status,
    }).toEqual({
      acompteRetention: 0,
      previewDeducts: Number(acompte.totalTtcCents),
      first: { subtotal: firstSubtotal, retention: Math.round((firstSubtotal * 0.05) / 5) * 5, deducts: Number(acompte.totalTtcCents), lines: 2 },
      secondDeducts: 0,
      pvRebill: 422,
    });
  });
});
