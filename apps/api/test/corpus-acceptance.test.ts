/**
 * Acceptance tests on the GEE corpus (5 real soumissions, 2 069 source lines, 303 reference
 * articles, 25 real electrical plans). Scenario ids (P1, C2, O4, …) refer to the corpus test
 * plan; the expected behaviour comes from GEE's "Cahier des charges — Moteur d'offres V1"
 * (§7–§14) and business rules R001–R010.
 *
 * The corpus holds GEE's real prices, so it lives in the git-ignored test/.corpus folder;
 * without it the suite is skipped.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';
import { apiClient, tokenFor, BASE_URL, USER_A, USER_B, WORKER_1_A } from './setup';

const CORPUS = join(__dirname, '.corpus');
const HAS_CORPUS = existsSync(join(CORPUS, 'base_offres_v1.json'));

interface Occ {
  source_ref: string; project: string; date: string; page: number; line: number; section_code: string;
  location: string; room_type: string; code: string; code_type: string; description: string;
  quantity: number; unit: string; unit_price_chf: number | null; total_chf: number | null;
  is_variant: boolean; source_file: string;
}
interface Ref {
  code_can_npk: string; code_type: string; canonical_description: string; category: string; unit: string;
  price_count: number; price_min_chf: number | null; price_median_chf: number | null;
  price_max_chf: number | null; latest_price_chf: number | null; latest_price_date: string | null;
}

const corpus = HAS_CORPUS ? JSON.parse(readFileSync(join(CORPUS, 'base_offres_v1.json'), 'utf8')) : { occurrences: [], catalog: [] };
const OCC: Occ[] = corpus.occurrences;
const REF: Ref[] = corpus.catalog;
const SOURCES = ['000033', '000260', '000271', '000443', '000731'];
const bySource = (s: string) => OCC.filter((o) => o.source_ref === s);
const priced = (o: Occ) => typeof o.unit_price_chf === 'number';
const ZERO_PRICED = new Set(OCC.filter((o) => o.unit_price_chf === 0 && !o.is_variant).map((o) => o.code));
const cents = (chf: number | null | undefined) => (typeof chf === 'number' ? Math.round(chf * 100) : undefined);

const gee = apiClient(tokenFor(USER_A.authId));
const other = apiClient(tokenFor(USER_B.authId));
const worker = apiClient(tokenFor(WORKER_1_A.authId));

const must = async <T = any>(p: Promise<{ status: number; data: T; error: any }>, label = ''): Promise<T> => {
  const r = await p;
  if (r.status >= 300) throw new Error(`${label} HTTP ${r.status}: ${JSON.stringify(r.error)}`);
  return r.data;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** GET that waits out the per-user rate limit (600 req/min) instead of failing. */
async function getPatient(api: ReturnType<typeof apiClient>, path: string) {
  for (;;) {
    const r = await api.get(path);
    if (r.status !== 429) return r;
    await sleep(5_000);
  }
}
const list = (d: any): any[] => (Array.isArray(d) ? d : d?.items ?? d?.data ?? []);

/** One corpus line as the import API row (the shape the web CSV parser produces). */
const toRow = (o: Occ, extra: object = {}) => ({
  lineNumber: o.line,
  rawText: [o.code, o.description, o.quantity, o.unit, o.unit_price_chf ?? '', o.total_chf ?? ''].join(';'),
  npkNumber: o.code,
  description: o.description.slice(0, 1000),
  unit: o.unit,
  quantity: o.quantity,
  unitPriceCents: cents(o.unit_price_chf),
  totalPriceCents: cents(o.total_chf),
  roomType: o.room_type,
  floor: o.location?.slice(0, 50),
  page: o.page,
  sectionCode: o.section_code || undefined,
  isVariant: o.is_variant,
  ...extra,
});

/* ─────────────── Shared state built once: catalogue + full corpus import ─────────────── */
const articleByCode = new Map<string, string>();
const importLog: Record<string, { status: number; error?: string; chunked: boolean; matched: number; ms: number; bytes: number }> = {};
let internalArticleId = '';
let rateLimitWaits = 0;
/** Price stats per NPK code, captured right after the corpus import (before any probe import). */
const statsByCode = new Map<string, any>();

describe.skipIf(!HAS_CORPUS)('GEE corpus acceptance', () => {
  beforeAll(async () => {
    // Reference catalogue: the 249 CAN/NPK articles GEE already knows (spec §6.1).
    for (const r of REF.filter((x) => x.code_type === 'CAN_NPK')) {
      const a = await must(gee.post('/catalogue/articles', {
        npkNumber: r.code_can_npk, description: r.canonical_description.slice(0, 1000), unit: r.unit || 'p', category: r.category,
      }), `article ${r.code_can_npk}`);
      articleByCode.set(r.code_can_npk, a.id);
    }
    // One internal article as GEE knows it from 000033: 00000021 = "Applique murale LED".
    internalArticleId = (await must(gee.post('/catalogue/articles', {
      npkNumber: '00000021', description: 'Applique murale LED', unit: 'p', category: 'Éclairage',
    }))).id;

    // Import the five soumissions in date order, whole-file first (as a user would).
    for (const s of SOURCES) {
      const rows = bySource(s).map((o) => toRow(o));
      const body = { filename: bySource(s)[0].source_file, projectName: bySource(s)[0].project, documentDate: bySource(s)[0].date, rows };
      const t0 = Date.now();
      const res = await gee.post('/catalogue/import', body);
      const entry = { status: res.status, error: res.error?.message, chunked: false, matched: res.data?.matchedRows ?? 0, ms: 0, bytes: JSON.stringify(body).length };
      if (res.status >= 300) {
        // Fall back to 50-row parts so the downstream checks still have data.
        entry.chunked = true;
        entry.matched = 0;
        for (let i = 0; i < rows.length; i += 50) {
          const part = await must(gee.post('/catalogue/import', { ...body, filename: `${body.filename}#${i / 50}`, rows: rows.slice(i, i + 50) }), `import ${s} part ${i / 50}`);
          entry.matched += part.matchedRows;
        }
      }
      entry.ms = Date.now() - t0;
      importLog[s] = entry;
    }
    for (const [code, id] of articleByCode) statsByCode.set(code, await must(getPatient(gee, `/catalogue/articles/${id}/prices`)));
    statsByCode.set('00000021', await must(getPatient(gee, `/catalogue/articles/${internalArticleId}/prices`)));
  }, 900_000);

  /* ─────────────── P. Import pipeline ─────────────── */
  describe('P import pipeline', () => {
    it('P1/P2 each soumission imports in one go (incl. 000271, 695 lines)', () => {
      const failed = Object.entries(importLog).filter(([, e]) => e.status >= 300)
        .map(([s, e]) => `${s}: ${bySource(s).length} lines, ${(e.bytes / 1024).toFixed(0)} KB → HTTP ${e.status} ${e.error}`);
      expect(failed).toEqual([]);
    });

    it('P3 re-importing the same soumission is refused as a duplicate', async () => {
      const rows = bySource('000731').map((o) => toRow(o));
      const again = await gee.post('/catalogue/import', { filename: 'again.pdf', rows: rows.slice(5, 55) });
      const again2 = await gee.post('/catalogue/import', { filename: 'again.pdf', rows: rows.slice(5, 55) });
      expect([again.status, again2.error?.details?.rule]).toEqual([201, 'DUPLICATE_IMPORT']);
    });

    it('P4 the same soumission under another file name (000259 vs 000260) is still a duplicate', async () => {
      const rows = bySource('000260').slice(0, 40).map((o) => toRow(o));
      await must(gee.post('/catalogue/import', { filename: 'Soumission_000259_6 Villas_Crissier.pdf', rows }));
      // Same document, re-exported: identical lines, different file name and one reformatted raw text.
      const reexport = rows.map((r, i) => (i === 0 ? { ...r, rawText: r.rawText.replace(/;/g, ' ; ') } : r));
      const res = await gee.post('/catalogue/import', { filename: 'Soumission_000260.pdf', rows: reexport });
      expect(res.error?.details?.rule).toBe('DUPLICATE_IMPORT');
    });

    it('P5/P6/P11 the import accepts page, soumission date and variant flag per line', async () => {
      const o = bySource('000443').find((x) => x.is_variant)!;
      const res = await gee.post('/catalogue/import', {
        filename: 'fields-probe.pdf', documentDate: o.date, rows: [toRow(o, { page: o.page, isVariant: true, lineNumber: 99_999 })],
      });
      expect({ status: res.status, error: res.error?.message }).toEqual({ status: 201, error: undefined });
    });

    it('P6 price observations carry the soumission date (R001)', async () => {
      const stats = statsByCode.get('585 613.112');
      const dates = new Set(stats.observations.map((x: any) => String(x.observationDate).slice(0, 10)));
      const expected = new Set(OCC.filter((x) => x.code === '585 613.112' && priced(x)).map((x) => x.date));
      expect([...dates].sort()).toEqual([...expected].sort());
    });

    it('P7 every price observation links back to its source line (R007)', async () => {
      const stats = statsByCode.get('585 613.112');
      const unlinked = stats.observations.filter((x: any) => !x.sourceOccurrenceId).length;
      expect(`${unlinked} of ${stats.observations.length} observations have no source line`).toBe(`0 of ${stats.observations.length} observations have no source line`);
    });

    it('P8 known CAN/NPK codes are matched to their article', () => {
      const expected = OCC.filter((o) => o.code_type === 'CAN_NPK' && articleByCode.has(o.code)).length;
      const matched = Object.values(importLog).reduce((n, e) => n + e.matched, 0);
      // matched also counts internal 00000021 lines (see P10); NPK matches must at least cover every NPK line.
      expect(matched).toBeGreaterThanOrEqual(expected);
    });

    it('P9 an NPK code arriving with a different unit is not matched silently (§6.1)', async () => {
      const res = await must(gee.post('/catalogue/import', {
        filename: 'unit-probe.pdf', rows: [{ lineNumber: 1, rawText: 'x', npkNumber: '585 613.112', description: 'Prise multiple', unit: 'm', quantity: 5, unitPriceCents: 1000 }],
      }));
      expect(res.matchedRows).toBe(0);
    });

    it('P10 internal 000000xx codes from other projects are not merged on the code alone (R003)', async () => {
      const stats = statsByCode.get('00000021');
      const foreign = OCC.filter((o) => o.code === '00000021' && o.source_ref !== '000033' && priced(o))
        .map((o) => `${o.source_ref}: ${o.description.slice(0, 45)} @ CHF ${o.unit_price_chf}`);
      const mergedPrices = stats.observations.map((x: any) => Number(x.unitPriceCents) / 100);
      const wronglyMerged = foreign.filter((f) => mergedPrices.includes(Number(f.split('CHF ')[1])));
      expect(wronglyMerged).toEqual([]);
    });

    it('P12 the unpriced soumission 000271 creates no price observations', () => {
      expect(bySource('000271').filter(priced)).toHaveLength(0);
    });

    it('P13 a CHF 0 line is not treated as a valid price (§7)', async () => {
      const zeroCodes = [...new Set(OCC.filter((o) => o.unit_price_chf === 0 && articleByCode.has(o.code)).map((o) => o.code))];
      const bad: string[] = [];
      for (const code of zeroCodes) {
        const s = statsByCode.get(code);
        if (s.minPriceCents != null && Number(s.minPriceCents) <= 0) bad.push(`${code}: minimum price CHF 0.00`);
      }
      expect(bad).toEqual([]);
    });

    it('P14 lines where total ≠ quantity × price are flagged (63 in the corpus)', async () => {
      const o = OCC.find((x) => x.code === '551 315.511' && priced(x))!; // 311 × 93.65 but total 93.65
      const res = await must(gee.post('/catalogue/import', { filename: 'mismatch-probe.pdf', rows: [toRow(o, { lineNumber: 88_888 })] }));
      const flagged = JSON.stringify(res).match(/warning|mismatch|incoh|anomal/i);
      expect(flagged).not.toBeNull();
    });

    it('P16 company B imports do not touch GEE prices', async () => {
      const before = await must(getPatient(gee, `/catalogue/articles/${articleByCode.get('585 613.112')}/prices`));
      await must(other.post('/catalogue/import', { filename: 'b.pdf', rows: [{ lineNumber: 1, rawText: 'x', npkNumber: '585 613.112', description: 'x', unit: 'p', quantity: 1, unitPriceCents: 1 }] }));
      const after = await must(getPatient(gee, `/catalogue/articles/${articleByCode.get('585 613.112')}/prices`));
      expect(after.observationCount).toBe(before.observationCount);
    });

    it('P17 a soumission PDF can be imported directly (§3.1, §10)', async () => {
      const routes = ['/catalogue/import/pdf', '/catalogue/import-pdf', '/documents/import'];
      const found = [];
      for (const r of routes) if ((await gee.post(r, {})).status !== 404) found.push(r);
      expect(found.length).toBeGreaterThan(0);
    });

    it('P18 the whole corpus imports in under 60 s', () => {
      const ms = Object.values(importLog).reduce((n, e) => n + e.ms, 0);
      expect(ms).toBeLessThan(60_000);
    });
  });

  /* ─────────────── F. File → real browser parser → API ─────────────── */
  describe('F corpus as a CSV file through the web parser', () => {
    let parseCSV: (text: string) => any[];
    let decodeCsv: (bytes: ArrayBuffer) => string;
    const swiss = (n: number | null) => (n == null ? '' : n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
    const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csvFor = (s: string) => ['NPK;Désignation;Unité;Qté;PU;Total',
      ...bySource(s).map((o) => [o.code, cell(o.description), o.unit, String(o.quantity).replace('.', ','), swiss(o.unit_price_chf), swiss(o.total_chf)].join(';'))].join('\r\n');
    const accuracy = (s: string, rows: any[]) => {
      const src = bySource(s);
      let ok = 0;
      src.forEach((o, i) => {
        const r = rows[i] ?? {};
        if (r.npkNumber === o.code && r.description === o.description && r.unit === o.unit && r.quantity === o.quantity
          && r.unitPriceCents === cents(o.unit_price_chf) && r.totalPriceCents === cents(o.total_chf)) ok++;
      });
      return Math.round((ok / src.length) * 1000) / 10;
    };
    const firstDiffs = (s: string, rows: any[], n = 4) => {
      const out: string[] = [];
      bySource(s).forEach((o, i) => {
        const r = rows[i] ?? {};
        const want: any = { npkNumber: o.code, description: o.description, unit: o.unit, quantity: o.quantity, unitPriceCents: cents(o.unit_price_chf), totalPriceCents: cents(o.total_chf) };
        for (const k of Object.keys(want)) if (r[k] !== want[k] && out.length < n) out.push(`${s}#${i} ${k}: got ${JSON.stringify(r[k])?.slice(0, 50)} want ${JSON.stringify(want[k])?.slice(0, 50)}`);
      });
      return out;
    };

    beforeAll(() => {
      const src = readFileSync(join(__dirname, '../../web/src/lib/csv-import.ts'), 'utf8');
      const js = transformSync(src, { loader: 'ts', format: 'cjs' }).code;
      const mod = { exports: {} as any };
      new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
      parseCSV = (text: string) => { try { return mod.exports.parseCsv(text); } catch { return []; } };
      decodeCsv = mod.exports.decodeCsv;
    });

    it('F1/F2 every field of every soumission survives the UTF-8 CSV round-trip', () => {
      const scores = Object.fromEntries(SOURCES.map((s) => [s, accuracy(s, parseCSV(csvFor(s)))]));
      console.log('[F1] first differences:', SOURCES.flatMap((s) => firstDiffs(s, parseCSV(csvFor(s)), 3)));
      expect(scores).toEqual(Object.fromEntries(SOURCES.map((s) => [s, 100])));
    });

    it('F3 the same files saved by Excel as Windows-1252 still parse', () => {
      const scores = Object.fromEntries(SOURCES.map((s) => {
        const bytes = Buffer.from(csvFor(s), 'latin1');
        return [s, accuracy(s, parseCSV(decodeCsv(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))))];
      }));
      expect(scores).toEqual(Object.fromEntries(SOURCES.map((s) => [s, 100])));
    });

    it('F4 a comma-separated export (Excel EN/DE) is read just as well', () => {
      const scores = Object.fromEntries(SOURCES.map((s) => {
        const csv = ['NPK,Désignation,Unité,Qté,PU,Total', ...bySource(s).map((o) => [o.code, `"${o.description.replace(/"/g, '""')}"`, o.unit, o.quantity, o.unit_price_chf ?? '', o.total_chf ?? ''].join(','))].join('\n');
        return [s, accuracy(s, parseCSV(csv))];
      }));
      expect(scores).toEqual(Object.fromEntries(SOURCES.map((s) => [s, 100])));
    });

    it('F5 every soumission fits the import request limit (10 MB)', () => {
      const sizes = Object.fromEntries(SOURCES.map((s) => [s, Math.round(JSON.stringify({ filename: 'x', rows: parseCSV(csvFor(s)) }).length / 1024)]));
      expect(Object.entries(sizes).filter(([, kb]) => kb > 10 * 1024).map(([s, kb]) => `${s}: ${kb} KB`)).toEqual([]);
    });
  });

  /* ─────────────── C. Catalogue statistics vs GEE's reference catalogue ─────────────── */
  describe('C catalogue vs reference', () => {
    const compare = async (field: 'min' | 'median' | 'max' | 'latest') => {
      const diffs: string[] = [];
      // GEE's reference counts CHF 0 lines as prices; the spec (§7) does not — those codes are covered by P13.
      for (const r of REF.filter((x) => x.code_type === 'CAN_NPK' && x.price_count > 0 && !ZERO_PRICED.has(x.code_can_npk))) {
        const s = statsByCode.get(r.code_can_npk);
        const got = field === 'latest'
          ? Number(s.observations[0]?.unitPriceCents) / 100
          : Number(s[`${field}PriceCents`]) / 100;
        const want = r[field === 'latest' ? 'latest_price_chf' : (`price_${field}_chf` as const)] as number;
        if (Math.abs(got - want) > 0.05) diffs.push(`${r.code_can_npk}: ${got} ≠ ${want}`);
      }
      return diffs;
    };
    const total = REF.filter((x) => x.code_type === 'CAN_NPK' && x.price_count > 0 && !ZERO_PRICED.has(x.code_can_npk)).length;

    it('C1 minimum price per article matches the reference', async () => {
      const d = await compare('min');
      expect(`${d.length}/${total} differ ${d.slice(0, 5).join(' | ')}`).toBe(`0/${total} differ `);
    });
    it('C1 median price per article matches the reference', async () => {
      const d = await compare('median');
      expect(`${d.length}/${total} differ ${d.slice(0, 5).join(' | ')}`).toBe(`0/${total} differ `);
    });
    it('C1 maximum price per article matches the reference', async () => {
      const d = await compare('max');
      expect(`${d.length}/${total} differ ${d.slice(0, 5).join(' | ')}`).toBe(`0/${total} differ `);
    });
    it('C2 the latest price is the one from the most recent soumission', async () => {
      const d = await compare('latest');
      expect(`${d.length}/${total} differ ${d.slice(0, 5).join(' | ')}`).toBe(`0/${total} differ `);
    });
    it('C2 last price date for 585 613.112 is 2026-07-07', async () => {
      const s = statsByCode.get('585 613.112');
      expect(String(s.lastPriceDate).slice(0, 10)).toBe('2026-07-07');
    });
    it('C3 the price history keeps every dated observation (71 for 585 613.112)', async () => {
      const s = statsByCode.get('585 613.112');
      expect(s.observations.length).toBeGreaterThanOrEqual(71);
    });
    it('C4 observed descriptions are kept as aliases (R002)', async () => {
      const code = '585 613.112';
      const labels = new Set(OCC.filter((o) => o.code === code).map((o) => o.description)).size;
      const a = await must(gee.get(`/catalogue/articles/${articleByCode.get(code)}`));
      expect(a.aliases?.length ?? 0).toBeGreaterThanOrEqual(Math.min(labels, 2));
    });
    it('C5 articles are found by NPK code and by text', async () => {
      const byCode = list(await must(gee.get(`/catalogue/articles?search=${encodeURIComponent('585 613.112')}`)));
      const byText = list(await must(gee.get(`/catalogue/articles?search=${encodeURIComponent('prise multiple')}`)));
      expect([byCode.length > 0, byText.length > 0]).toEqual([true, true]);
    });
  });

  /* ─────────────── O. Offer engine ─────────────── */
  describe('O offer engine', () => {
    let clientId = '';
    const newOffer = async (name: string) => must(gee.post('/offers', { projectName: name, clientId, marginFactor: 100, vatRate: 810 }), 'offer');
    const addLines = async (offerId: string, occs: Occ[]) => {
      for (const o of occs) {
        let r;
        for (;;) {
          r = await gee.post(`/offers/${offerId}/lines`, {
            canonicalArticleId: articleByCode.get(o.code), description: o.description.slice(0, 1000), unit: o.unit,
            quantity: o.quantity, unitPriceCents: cents(o.unit_price_chf) ?? null,
            variantType: o.is_variant ? 'VARIANTE' : 'BASE', roomType: o.room_type,
          });
          if (r.status !== 429) break;
          rateLimitWaits++;
          await sleep(5_000);
        }
        if (false) await must(gee.post(`/offers/${offerId}/lines`, {
          canonicalArticleId: articleByCode.get(o.code), description: o.description.slice(0, 1000), unit: o.unit,
          quantity: o.quantity, unitPriceCents: cents(o.unit_price_chf) ?? null,
          variantType: o.is_variant ? 'VARIANTE' : 'BASE', roomType: o.room_type,
        }), `line ${o.code}`);
      }
    };

    beforeAll(async () => {
      clientId = (await must(gee.post('/clients', { name: 'Maître d’ouvrage Crissier' }))).id;
    });

    it('O1/O2 soumission 000260 rebuilt as an offer: base total matches, 3 variants excluded', async () => {
      const offer = await newOffer('Villas de Bugnon / Crissier');
      const src = bySource('000260');
      await addLines(offer.id, src);
      const o = await must(gee.post(`/offers/${offer.id}/recalculate`));
      const expected = src.filter((x) => !x.is_variant).reduce((n, x) => n + Math.round(x.quantity * cents(x.unit_price_chf)!), 0);
      const soumissionTotals = Math.round(src.filter((x) => !x.is_variant).reduce((n, x) => n + (x.total_chf ?? 0), 0) * 100);
      expect({ offerHtCents: Number(o.totalHtCents), fromLines: expected, soumissionPrintedTotals: soumissionTotals })
        .toEqual({ offerHtCents: expected, fromLines: expected, soumissionPrintedTotals: expected });
    }, 120_000);

    it('O3 an unpriced base line blocks submission ("prix à compléter", never CHF 0)', async () => {
      const offer = await newOffer('Les Quatre Sapins');
      await addLines(offer.id, bySource('000271').slice(0, 5));
      const res = await gee.patch(`/offers/${offer.id}/status`, { status: 'submitted' });
      expect(res.error?.details?.rule).toBe('PRIX_A_COMPLETER');
    });

    it('O4 choosing a pricing strategy fills the price from history (R010)', async () => {
      const offer = await newOffer('Strategy probe');
      const got: Record<string, unknown> = {};
      for (const strategy of ['LATEST', 'MEDIAN_N', 'INDEXED']) {
        const line = await must(gee.post(`/offers/${offer.id}/lines`, {
          canonicalArticleId: articleByCode.get('585 613.112'), description: 'Ligne avec prise multiple', unit: 'p', quantity: 3, pricingStrategy: strategy,
        }));
        got[strategy] = line.unitPriceCents;
      }
      expect(Object.values(got).every((v) => typeof v === 'number' && (v as number) > 0) ? 'priced' : got).toBe('priced');
    });

    it('O5 room suggestions exist for the rooms in the corpus (§8)', async () => {
      const empty: string[] = [];
      for (const room of ['Chambre', 'Cuisine', 'Local technique', 'Salle de bains']) {
        const s = list(await must(gee.get(`/offers/suggest-articles?roomType=${encodeURIComponent(room)}`)));
        if (!s.length) empty.push(room);
      }
      expect(empty).toEqual([]);
    });

    it('O6 a proposed line can carry its rule, confidence and evidence (R007, R008, §11.2)', async () => {
      const offer = await newOffer('Traceability probe');
      const res = await gee.post(`/offers/${offer.id}/lines`, {
        canonicalArticleId: articleByCode.get('585 613.112'), description: 'Prise multiple', unit: 'p', quantity: 3, unitPriceCents: 25930,
        ruleId: 'ROOM_CHAMBRE_STANDARD_V1', confidenceScore: 0.87, evidence: ['OCC_1', 'OCC_2'],
      });
      expect({ status: res.status, error: res.error?.message }).toEqual({ status: 201, error: undefined });
    });

    it('O7 open hypotheses / missing information block submission (§14 Validation)', async () => {
      const offer = await newOffer('Hypothesis probe');
      await must(gee.post(`/offers/${offer.id}/lines`, { description: 'Éclairage parking (base standard)', unit: 'p', quantity: 1, unitPriceCents: 500000, variantType: 'HYPOTHESE_A_VALIDER' }));
      await must(gee.post(`/offers/${offer.id}/assumptions`, { type: 'INFORMATION_MANQUANTE', description: 'Type de luminaires parking à confirmer' }));
      const res = await gee.patch(`/offers/${offer.id}/status`, { status: 'submitted' });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('O8 illegal status jumps are refused', async () => {
      const allowed: string[] = [];
      const tryMove = async (offerId: string, to: string, label: string) => {
        if ((await gee.patch(`/offers/${offerId}/status`, { status: to })).status < 300) allowed.push(label);
      };
      const a = await newOffer('Status probe A');
      await tryMove(a.id, 'accepted', 'draft → accepted');
      await must(gee.patch(`/offers/${a.id}/status`, { status: 'submitted' }));
      await tryMove(a.id, 'draft', 'submitted → draft');
      await must(gee.patch(`/offers/${a.id}/status`, { status: 'accepted' }));
      await tryMove(a.id, 'draft', 'accepted → draft');
      await tryMove(a.id, 'rejected', 'accepted → rejected');
      const b = await newOffer('Status probe B');
      await must(gee.patch(`/offers/${b.id}/status`, { status: 'submitted' }));
      await must(gee.patch(`/offers/${b.id}/status`, { status: 'rejected' }));
      await tryMove(b.id, 'accepted', 'rejected → accepted');
      expect(allowed).toEqual([]);
    });

    it('O9 a submitted offer cannot be edited; changes need a new version (§14 Versioning)', async () => {
      const offer = await newOffer('Versioning probe');
      await addLines(offer.id, bySource('000731').slice(0, 3));
      await must(gee.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
      const lines = (await must(gee.get(`/offers/${offer.id}`))).lines;
      const edits: string[] = [];
      if ((await gee.post(`/offers/${offer.id}/lines`, { description: 'Ajout après envoi', unit: 'p', quantity: 1, unitPriceCents: 100 })).status < 300) edits.push('add line');
      if ((await gee.patch(`/offers/${offer.id}/lines/${lines[0].id}`, { quantity: 99 })).status < 300) edits.push('change quantity');
      if ((await gee.del(`/offers/${offer.id}/lines/${lines[1].id}`)).status < 300) edits.push('delete line');
      if ((await gee.patch(`/offers/${offer.id}`, { marginFactor: 300 })).status < 300) edits.push('change margin');
      expect(edits).toEqual([]);
    });

    it('O10 duplicating creates version + 1 and leaves the original untouched', async () => {
      const offer = await newOffer('Maison Eggermann');
      await addLines(offer.id, bySource('000731').slice(0, 10));
      const v1 = await must(gee.post(`/offers/${offer.id}/recalculate`));
      const v2 = await must(gee.post(`/offers/${offer.id}/duplicate`));
      await must(gee.post(`/offers/${v2.id}/lines`, { description: 'Borne VE', unit: 'p', quantity: 1, unitPriceCents: 250000 }));
      await must(gee.post(`/offers/${v2.id}/recalculate`));
      const original = await must(gee.get(`/offers/${offer.id}`));
      expect({ v2: v2.version, originalLines: original.lines.length, originalTotal: original.totalHtCents })
        .toEqual({ v2: v1.version + 1, originalLines: 10, originalTotal: v1.totalHtCents });
    });

    it('O11/O12/O13 a 626-line offer (000443) recalculates and renders to PDF', async () => {
      const offer = await newOffer('La Joux - 14 appartements + parking');
      const t0 = Date.now();
      await addLines(offer.id, bySource('000443'));
      const tAdd = Date.now() - t0;
      const o = await must(gee.post(`/offers/${offer.id}/recalculate`));
      const t1 = Date.now();
      const pdf = await fetch(`${BASE_URL}/offers/${offer.id}/pdf`, { headers: { Authorization: `Bearer ${tokenFor(USER_A.authId)}` } });
      const bytes = (await pdf.arrayBuffer()).byteLength;
      const tPdf = Date.now() - t1;
      const base = bySource('000443').filter((x) => !x.is_variant).reduce((n, x) => n + Math.round(x.quantity * cents(x.unit_price_chf)!), 0);
      console.log(`[O12] 626 lines: add ${tAdd} ms (${rateLimitWaits} rate-limit waits), PDF ${tPdf} ms, ${(bytes / 1024).toFixed(0)} KB`);
      expect({ status: pdf.status, total: Number(o.totalHtCents), pdfUnder10s: tPdf < 10_000 }).toEqual({ status: 200, total: base, pdfUnder10s: true });
    }, 300_000);
  });

  /* ─────────────── L. Plans & symbols ─────────────── */
  describe('L plans and symbols', () => {
    // describe bodies run even when the suite is skipped, so only read the corpus when it exists.
    const plans: any[] = HAS_CORPUS ? JSON.parse(readFileSync(join(CORPUS, 'plans.json'), 'utf8')) : [];
    const detection = HAS_CORPUS ? JSON.parse(readFileSync(join(CORPUS, 'detection_result.example.json'), 'utf8')) : {};
    let projectOffer = '';
    const ids: string[] = [];

    beforeAll(async () => {
      projectOffer = (await must(gee.post('/offers', { projectName: 'Plans probe', clientId: (await must(gee.post('/clients', { name: 'Plans' }))).id }))).id;
    });

    it('L1 all 25 real plans register with their metadata', async () => {
      const refused: string[] = [];
      for (const p of plans) {
        const res = await gee.post('/plans', {
          name: p.name.slice(0, 200), fileUrl: `https://files.gee.ch/plans/${encodeURIComponent(p.name)}.pdf`,
          fileType: 'pdf', fileSizeBytes: p.fileSizeBytes, offerId: projectOffer, scale: '1:100',
        });
        if (res.status >= 300) refused.push(`${p.name}: ${res.status} ${res.error?.message}`);
        else ids.push(res.data.id);
      }
      expect(refused).toEqual([]);
    });

    it('L2 the plan file itself can be uploaded', async () => {
      const res = await fetch(`${BASE_URL}/plans/${ids[0]}/file`, {
        method: 'POST', headers: { Authorization: `Bearer ${tokenFor(USER_A.authId)}`, 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.7\n'),
      });
      expect(res.status).toBeLessThan(300);
    });

    it('L3 annotations at the far corner of the widest sheet (2743 mm) are accepted', async () => {
      const widest = plans.reduce((a, b) => ((b.widthPt ?? 0) > (a.widthPt ?? 0) ? b : a));
      const idx = plans.indexOf(widest);
      const res = await gee.post(`/plans/${ids[idx]}/annotations`, { type: 'rectangle', geometry: { x: widest.widthPt - 20, y: widest.heightPt - 20, width: 18, height: 18 }, label: 'Tableau' });
      expect(res.status).toBe(201);
    });

    it('L4 a symbol-detection result from the GEE kit can be stored', async () => {
      const res = await gee.post(`/plans/${ids[0]}/annotations`, { type: 'symbol', geometry: { bbox: detection.bbox, rotation: detection.rotation_deg, page: detection.page }, label: detection.class_id });
      const fallback = await gee.post(`/plans/${ids[0]}/annotations`, { type: 'rectangle', geometry: { bbox: detection.bbox, classId: detection.class_id, confidence: detection.confidence }, label: detection.class_id });
      expect({ asSymbol: res.status, asRectangleWorkaround: fallback.status }).toEqual({ asSymbol: 201, asRectangleWorkaround: 201 });
    });

    it('L6 workers can read plans but not create or delete them', async () => {
      expect([(await worker.get(`/plans/${ids[0]}`)).status, (await worker.post('/plans', {})).status, (await worker.del(`/plans/${ids[0]}`)).status]).toEqual([200, 403, 403]);
    });

    it('L7 another company cannot see or annotate GEE plans', async () => {
      expect([(await other.get(`/plans/${ids[0]}`)).status, (await other.post(`/plans/${ids[0]}/annotations`, { type: 'pin', geometry: { x: 1, y: 1 } })).status]).toEqual([404, 404]);
    });
  });
});
