/**
 * Offer engine alignment with the PRD (§7.4, §7.7, §7.8, Annexe B):
 *  - four confidence dimensions per line + the combined confidenceScore (weakest dimension);
 *  - a typed price is a manual price with its own confidence, never a stale history score;
 *  - the six line types and what each means for the total and for sending;
 *  - INDEXED uses the company's yearly index (company.price_index_rate_bp, default 200 bp);
 *  - "sent offers are locked" holds under concurrent edits (offer row lock).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { apiClient, appRoleClient, setSignedContext, tokenFor, BASE_URL, COMPANY_A, USER_A } from './setup';
import { historyPriceConfidence } from '../src/modules/offers/offer-confidence';
import { LINES_IN_TOTAL, PENDING_LINE_TYPES, VARIANT_TYPES } from '../src/modules/offers/offer-pricing';

const admin = apiClient(tokenFor(USER_A.authId));
type Res = { status: number; data: any; error: any };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Retries on 429: other test files share the per-user rate limit window. */
async function call(fn: () => Promise<Res>): Promise<Res> {
  for (let i = 0; ; i++) {
    const r = await fn();
    if (r.status !== 429 || i >= 12) return r;
    await sleep(5_000);
  }
}
async function must(fn: () => Promise<Res>, label = ''): Promise<any> {
  const r = await call(fn);
  if (r.status >= 300) throw new Error(`${label} HTTP ${r.status}: ${JSON.stringify(r.error)}`);
  return r.data;
}
const rule = (r: Res) => r.error?.details?.rule;

const TAG = `${Date.now() % 100_000}`;
const ROOM = `Cuisine test ${TAG}`;
const today = new Date().toISOString().slice(0, 10);
const twoYearsAgo = (() => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 2);
  return d.toISOString().slice(0, 10);
})();
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

let db: Client;
let clientId = '';
let originalRate = 200;
const article: Record<'A' | 'B' | 'C', string> = { A: '', B: '', C: '' };
let occurrenceOfA = '';

const newOffer = async (name: string) =>
  must(() => admin.post('/offers', { projectName: `${name} ${TAG}`, clientId, marginFactor: 100, vatRate: 810 }), 'offer');
const addLine = (offerId: string, body: Record<string, unknown>) => call(() => admin.post(`/offers/${offerId}/lines`, body));
const patchLine = (offerId: string, lineId: string, body: Record<string, unknown>) =>
  call(() => admin.patch(`/offers/${offerId}/lines/${lineId}`, body));

const row = (lineNumber: number, code: string, priceCents: number, roomType = ROOM) => ({
  lineNumber, rawText: `${code} ligne ${lineNumber}`, npkNumber: code, description: `Article ${code}`, unit: 'p',
  quantity: 1, unitPriceCents: priceCents, totalPriceCents: priceCents, roomType,
});

beforeAll(async () => {
  db = await appRoleClient();
  await setSignedContext(db, COMPANY_A, USER_A.id);
  originalRate = (await db.query('SELECT price_index_rate_bp FROM company WHERE id = $1', [COMPANY_A])).rows[0].price_index_rate_bp;

  clientId = (await must(() => admin.post('/clients', { name: `Offer engine ${TAG}` }), 'client')).id;
  const codes = { A: `991 ${TAG}.001`, B: `991 ${TAG}.002`, C: `991 ${TAG}.003` };
  for (const k of ['A', 'B', 'C'] as const) {
    article[k] = (await must(() => admin.post('/catalogue/articles', { npkNumber: codes[k], description: `Article ${k} ${TAG}`, unit: 'p' }), `article ${k}`)).id;
  }
  // Project 1: A and B in the room; project 2: only B. Mapping of A in the room = 1/2.
  await must(() => admin.post('/catalogue/import', {
    filename: `engine-p1-${TAG}.pdf`, projectName: `Engine P1 ${TAG}`, documentDate: today,
    rows: [row(1, codes.A, 10_000), row(2, codes.B, 20_000)],
  }), 'import p1');
  await must(() => admin.post('/catalogue/import', {
    filename: `engine-p2-${TAG}.pdf`, projectName: `Engine P2 ${TAG}`, documentDate: today,
    rows: [row(1, codes.B, 22_000)],
  }), 'import p2');
  // C: one price observation two years old, for INDEXED.
  await must(() => admin.post('/catalogue/import', {
    filename: `engine-p3-${TAG}.pdf`, projectName: `Engine P3 ${TAG}`, documentDate: twoYearsAgo,
    rows: [row(1, codes.C, 10_000, 'Garage')],
  }), 'import p3');

  const stats = await must(() => admin.get(`/catalogue/articles/${article.A}/prices`), 'prices A');
  occurrenceOfA = stats.observations[0].sourceOccurrenceId;
});

afterAll(async () => {
  await db?.query('UPDATE company SET price_index_rate_bp = $2 WHERE id = $1', [COMPANY_A, originalRate]);
  await db?.end();
});

describe('confidence scoring (§7.7)', () => {
  it('stores the four dimensions and the weakest as confidenceScore', async () => {
    const offer = await newOffer('Confidence');
    // Proposed line (cites a source line): classification from its match, mapping from the room profile.
    const proposed = await must(() => addLine(offer.id, {
      canonicalArticleId: article.A, description: 'Prise', unit: 'p', quantity: 2, unitPriceCents: 12_000,
      roomType: ROOM, evidence: [occurrenceOfA],
    }), 'proposed');
    expect({
      classification: proposed.confidenceClassification, mapping: proposed.confidenceMapping,
      price: proposed.confidencePrice, rule: proposed.confidenceRule, score: proposed.confidenceScore,
    }).toEqual({ classification: 1, mapping: 0.5, price: 1, rule: null, score: 0.5 });

    // Hand-made line: the user's own choices score 1; a free line has no classification/mapping.
    const manual = await must(() => addLine(offer.id, { description: 'Main d’œuvre', unit: 'h', quantity: 3, unitPriceCents: 9_500 }));
    expect([manual.confidenceClassification, manual.confidenceMapping, manual.confidencePrice, manual.confidenceRule, manual.confidenceScore])
      .toEqual([null, null, 1, null, 1]);

    // No price: "prix à compléter" scores 0, and so does the line.
    const unpriced = await must(() => addLine(offer.id, { canonicalArticleId: article.A, description: 'Sans prix', unit: 'p', quantity: 1 }));
    expect([unpriced.unitPriceCents, unpriced.confidencePrice, unpriced.confidenceScore]).toEqual([null, 0, 0]);

    // A proposer's own overall confidence (R008) is kept as sent.
    const sent = await must(() => addLine(offer.id, {
      description: 'Proposition', unit: 'p', quantity: 1, unitPriceCents: 100, ruleId: `RULE_${TAG}`, confidenceScore: 0.87,
    }));
    expect(sent.confidenceScore).toBeCloseTo(0.87, 5);

    // Dimensions a proposer assessed itself are stored; the combined score follows them.
    const ai = await must(() => addLine(offer.id, {
      canonicalArticleId: article.B, description: 'Suggestion IA', unit: 'p', quantity: 1, unitPriceCents: 100,
      roomType: ROOM, ruleId: `RULE_${TAG}`, confidenceClassification: 0.8, confidenceRule: 0.7,
    }));
    expect([ai.confidenceClassification, ai.confidenceMapping, ai.confidenceRule, ai.confidenceScore]).toEqual([0.8, 1, 0.7, 0.7]);

    // The scores are returned with the offer and copied to a new version.
    const lines = (await must(() => admin.get(`/offers/${offer.id}`))).lines;
    expect(lines.find((l: any) => l.id === proposed.id).confidenceMapping).toBe(0.5);
  });

  it('prices from history with a score from the number and age of observations', async () => {
    const offer = await newOffer('History');
    const median = await must(() => addLine(offer.id, {
      canonicalArticleId: article.B, description: 'Médiane', unit: 'p', quantity: 1, pricingStrategy: 'MEDIAN_N',
    }));
    expect({ price: Number(median.unitPriceCents), strategy: median.pricingStrategy, confidence: median.confidencePrice })
      .toEqual({ price: 21_000, strategy: 'MEDIAN_N', confidence: historyPriceConfidence(2, 0) });
    expect(median.confidenceScore).toBe(median.confidencePrice);
  });

  it('a typed price is a manual price: its confidence is no longer the history one (§7.4 MANUAL)', async () => {
    const offer = await newOffer('Manual price');
    const line = await must(() => addLine(offer.id, {
      canonicalArticleId: article.B, description: 'Ligne', unit: 'p', quantity: 1, pricingStrategy: 'MEDIAN_N',
    }));
    const historyScore = line.confidencePrice;
    expect(historyScore).toBeLessThan(1);

    const typed = await must(() => patchLine(offer.id, line.id, { unitPriceCents: 25_000 }));
    expect([Number(typed.unitPriceCents), typed.pricingStrategy, typed.confidencePrice, typed.confidenceScore])
      .toEqual([25_000, 'MANUAL', 1, 1]);

    // Back to the history strategy: re-priced and re-scored from history.
    const back = await must(() => patchLine(offer.id, line.id, { pricingStrategy: 'MEDIAN_N' }));
    expect([Number(back.unitPriceCents), back.pricingStrategy, back.confidencePrice]).toEqual([21_000, 'MEDIAN_N', historyScore]);

    // Typing exactly the suggested price accepts the suggestion: strategy and score stay.
    const same = await must(() => patchLine(offer.id, line.id, { unitPriceCents: 21_000 }));
    expect([same.pricingStrategy, same.confidencePrice]).toEqual(['MEDIAN_N', historyScore]);

    // Clearing the price: "prix à compléter".
    const cleared = await must(() => patchLine(offer.id, line.id, { unitPriceCents: null }));
    expect([cleared.unitPriceCents, cleared.confidencePrice, cleared.confidenceScore]).toEqual([null, 0, 0]);

    // A quantity change does not touch the scores.
    const qty = await must(() => patchLine(offer.id, line.id, { quantity: 4 }));
    expect(qty.confidenceScore).toBe(0);

    // Same on creation: a price differing from the strategy's is MANUAL.
    const created = await must(() => addLine(offer.id, {
      canonicalArticleId: article.B, description: 'Saisie', unit: 'p', quantity: 1, pricingStrategy: 'LATEST', unitPriceCents: 30_000,
    }));
    expect([created.pricingStrategy, created.confidencePrice]).toEqual(['MANUAL', 1]);
  });
});

describe('INDEXED price index (§7.4)', () => {
  it('defaults to 200 bp (+2 %/year) per company', async () => {
    const col = await db.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'company' AND column_name = 'price_index_rate_bp'`,
    );
    expect(col.rows[0].column_default).toBe('200');
  });

  it("uses the company's own yearly index", async () => {
    await db.query('UPDATE company SET price_index_rate_bp = 1000 WHERE id = $1', [COMPANY_A]);
    try {
      const offer = await newOffer('Indexed');
      const line = await must(() => addLine(offer.id, {
        canonicalArticleId: article.C, description: 'Indexé', unit: 'p', quantity: 1, pricingStrategy: 'INDEXED',
      }));
      const years = (Date.now() - new Date(`${twoYearsAgo}T00:00:00Z`).getTime()) / MS_PER_YEAR;
      expect(Math.abs(Number(line.unitPriceCents) - 10_000 * Math.pow(1.1, years))).toBeLessThanOrEqual(1);
      expect(line.confidencePrice).toBeCloseTo(historyPriceConfidence(1, years, true), 2);
    } finally {
      await db.query('UPDATE company SET price_index_rate_bp = $2 WHERE id = $1', [COMPANY_A, originalRate]);
    }
  });
});

describe('line types (§7.8, Annexe B criterion 9)', () => {
  it('defines the six types: BASE and hypotheses in the total, hypotheses and missing information block sending', () => {
    expect([...VARIANT_TYPES].sort()).toEqual(['BASE', 'EXCLU', 'HYPOTHESE_A_VALIDER', 'INFORMATION_MANQUANTE', 'OPTION', 'VARIANTE']);
    expect(LINES_IN_TOTAL).toEqual(['BASE', 'HYPOTHESE_A_VALIDER']);
    expect(PENDING_LINE_TYPES).toEqual(['HYPOTHESE_A_VALIDER', 'INFORMATION_MANQUANTE']);
  });

  it('totals, sending rules and PDF with all six types', async () => {
    const offer = await newOffer('Six types');
    const add = (variantType: string, unitPriceCents: number | null, quantity = 1) =>
      must(() => addLine(offer.id, { description: `Ligne ${variantType}`, unit: 'p', quantity, unitPriceCents, variantType }), variantType);
    await add('BASE', 1_000, 10);
    const hypothesis = await add('HYPOTHESE_A_VALIDER', null);
    await add('VARIANTE', 70_000);
    await add('OPTION', 50_000);
    const missing = await add('INFORMATION_MANQUANTE', 3_000);
    await add('EXCLU', 4_000);

    // An unpriced hypothesis is "prix à compléter" like a base line (it counts in the total).
    expect(rule(await call(() => admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' })))).toBe('PRIX_A_COMPLETER');
    await must(() => patchLine(offer.id, hypothesis.id, { unitPriceCents: 5_000 }));

    const totals = await must(() => admin.post(`/offers/${offer.id}/recalculate`));
    expect(Number(totals.totalHtCents)).toBe(10_000 + 5_000);

    // The draft renders with every type.
    const pdf = await fetch(`${BASE_URL}/offers/${offer.id}/pdf`, { headers: { Authorization: `Bearer ${tokenFor(USER_A.authId)}` } });
    expect([pdf.status, Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()]).toEqual([200, '%PDF-']);

    // Open points block sending until decided.
    expect(rule(await call(() => admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' })))).toBe('VALIDATION_PENDING');
    await must(() => patchLine(offer.id, hypothesis.id, { variantType: 'BASE' }));
    await must(() => patchLine(offer.id, missing.id, { variantType: 'EXCLU' }));
    const recalculated = await must(() => admin.post(`/offers/${offer.id}/recalculate`));
    expect(Number(recalculated.totalHtCents)).toBe(15_000);
    expect((await must(() => admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' }))).status).toBe('submitted');
  });
});

describe('sent offers stay locked under concurrent edits', () => {
  it('a line added or un-priced while the offer is being sent never ends up in a sent offer', async () => {
    for (let round = 0; round < 4; round++) {
      const offer = await newOffer(`Race ${round}`);
      const priced = await must(() => addLine(offer.id, { description: 'Base', unit: 'p', quantity: 1, unitPriceCents: 1_000 }));

      const results = await Promise.all([
        call(() => admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' })),
        ...Array.from({ length: 6 }, (_, i) => addLine(offer.id, { description: `Ajout ${i}`, unit: 'p', quantity: 1 })),
        patchLine(offer.id, priced.id, { unitPriceCents: null }),
      ]);
      // Each write either went in before sending, or was refused because the offer was sent.
      for (const r of results.slice(1)) {
        if (r.status >= 300) expect(['OFFER_LOCKED', 'PRIX_A_COMPLETER']).toContain(rule(r));
      }

      const after = await must(() => admin.get(`/offers/${offer.id}`));
      const unpriced = after.lines.filter((l: any) => l.variantType === 'BASE' && l.unitPriceCents == null);
      if (after.status === 'submitted') expect(unpriced).toEqual([]);
      else expect(rule(results[0])).toBe('PRIX_A_COMPLETER');
      // Positions are allocated under the lock: never twice the same.
      const positions = after.lines.map((l: any) => l.positionNumber);
      expect(new Set(positions).size).toBe(positions.length);
    }
  });

  it('every line and assumption write is refused once the offer is sent', async () => {
    const offer = await newOffer('Locked');
    const line = await must(() => addLine(offer.id, { description: 'Base', unit: 'p', quantity: 1, unitPriceCents: 1_000 }));
    await must(() => admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
    const writes = await Promise.all([
      addLine(offer.id, { description: 'Après envoi', unit: 'p', quantity: 1, unitPriceCents: 100 }),
      patchLine(offer.id, line.id, { unitPriceCents: 5 }),
      call(() => admin.del(`/offers/${offer.id}/lines/${line.id}`)),
      call(() => admin.post(`/offers/${offer.id}/assumptions`, { type: 'OPTION', description: 'x' })),
      call(() => admin.post(`/offers/${offer.id}/recalculate`)),
      call(() => admin.patch(`/offers/${offer.id}`, { notes: 'x' })),
    ]);
    expect(writes.map(rule)).toEqual(Array(writes.length).fill('OFFER_LOCKED'));
  });
});
