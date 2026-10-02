/**
 * The soumission PDF import, exercised with actual PDFs.
 *
 * This is the front door of the pricing engine — the catalogue, the price history and the
 * confidence score are all fed by whatever comes out of here — and until these tests it was the
 * only path with no automated coverage at all: the corpus suite that could have covered it feeds
 * pre-extracted rows and is skipped whenever the corpus is absent.
 */
import { describe, expect, it } from 'vitest';
import { apiClient, tokenFor, BASE_URL, USER_A, WORKER_1_A } from './setup';
import { extractPdfText, isPdf, PDF_LIMITS } from '../src/modules/catalogue/pdf-text.extractor';
import { parseSoumission, parseAmount } from '../src/modules/catalogue/pdf-soumission.parser';
import {
  buildSoumissionPdf,
  HEADERS,
  SAMPLE_LINES,
  SAMPLE_EXPECTED,
  SoumissionOptions,
} from './fixtures/soumission-pdf';

const admin = apiClient(tokenFor(USER_A.authId));

const parse = async (opts: SoumissionOptions) => parseSoumission(await extractPdfText(await buildSoumissionPdf(opts)));

/** Posts a PDF to the import route the way the browser does. */
async function upload(pdf: Buffer, filename = 'soumission.pdf', fields: Record<string, string> = {}, token = tokenFor(USER_A.authId)) {
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${BASE_URL}/catalogue/import/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, data: body.data, error: body.error };
}

describe('Amounts as a soumission prints them', () => {
  it('reads Swiss, French and plain formats, and parentheses as negative', () => {
    expect(parseAmount("1'250.00")).toBe(1250);
    expect(parseAmount('2 176,70')).toBe(2176.7);
    expect(parseAmount('1.234,50')).toBe(1234.5);
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('48')).toBe(48);
    expect(parseAmount('CHF 85.00')).toBe(85);
    // A total in parentheses is a variant that is not counted in the sum.
    expect(parseAmount("(1'251,90)")).toBe(-1251.9);
    expect(parseAmount('-12.50')).toBe(-12.5);
  });

  it('is not fooled by text that merely contains digits', () => {
    for (const notAnAmount of ['', 'pce', 'm2', '...........', 'Tube TT 20 mm', '20 mm', 'A1', '1.2.3.4x']) {
      expect(parseAmount(notAnAmount)).toBeUndefined();
    }
  });
});

describe('Reading a soumission PDF', () => {
  it('recovers every position, whichever way the numeric headers are aligned over their data', async () => {
    // Both are ordinary: some tools right-align the header with the figures, some do not. The
    // columns belong to the figures, so the header's own alignment must not decide the import.
    for (const headerAlign of ['right', 'left'] as const) {
      const parsed = await parse({ lines: SAMPLE_LINES, headerAlign });
      expect(parsed.rows, `headerAlign=${headerAlign}`).toHaveLength(SAMPLE_EXPECTED.length);
      expect(parsed.rows.map((r) => ({
        npkNumber: r.npkNumber,
        quantity: r.quantity,
        unit: r.unit,
        unitPriceCents: r.unitPriceCents,
        totalPriceCents: r.totalPriceCents,
      }))).toEqual(SAMPLE_EXPECTED);
    }
  });

  it('reads the document metadata printed on the first page', async () => {
    const parsed = await parse({ lines: SAMPLE_LINES });
    expect(parsed).toMatchObject({
      reference: '000443',
      documentDate: '2025-04-17',
      projectName: 'Rénovation école Vinet, Lausanne',
      pageCount: 1,
    });
  });

  it('carries section, location and room headings down onto the positions below them', async () => {
    const [first] = (await parse({ lines: SAMPLE_LINES })).rows;
    expect(first).toMatchObject({ sectionCode: '231.2', roomType: 'Salle de gymnastique', page: 1 });
    expect(first.floor).toMatch(/^A - Bâtiment principal/);
    // The line under a position is the rest of its description, not a position of its own.
    expect(first.description).toContain('y compris boîtes de dérivation');
  });

  it('leaves out subtotals and keeps the raw line for traceability', async () => {
    const parsed = await parse({ lines: SAMPLE_LINES });
    expect(parsed.rows.some((r) => /^total/i.test(r.description ?? ''))).toBe(false);
    expect(parsed.rows.every((r) => r.rawText.length > 0)).toBe(true);
  });

  it('reads a tender whose prices are still to be filled in', async () => {
    const blank = SAMPLE_LINES.map((l) => (l.kind === 'position' ? { ...l, pu: undefined, total: undefined } : l));
    const parsed = await parse({ lines: blank });
    expect(parsed.rows).toHaveLength(3);
    // The work and its quantities are known; only the prices are missing.
    expect(parsed.rows[0]).toMatchObject({ npkNumber: '571.201', quantity: 1250, unit: 'm' });
    expect(parsed.rows[0].unitPriceCents).toBeUndefined();
    expect(parsed.rows[0].totalPriceCents).toBeUndefined();
  });

  it('marks a variant section and keeps its total out of the sum', async () => {
    const parsed = await parse({
      lines: [
        { kind: 'section', code: '231.3', text: 'Variante non comptabilisée' },
        { kind: 'position', code: '575.099', text: 'Luminaire LED dimmable', qte: '24.00', unite: 'pce', pu: '215.00', total: "(5'160.00)" },
      ],
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ isVariant: true, unitPriceCents: 21500, totalPriceCents: -516000 });
  });

  it('reads a German and an Italian soumission, not only a French one', async () => {
    // Switzerland is not only Romandie: the same sheet is printed in the canton's language.
    for (const lang of ['de', 'it'] as const) {
      const parsed = await parse({ lines: SAMPLE_LINES, header: HEADERS[lang] });
      expect(parsed.rows.map((r) => r.npkNumber), lang).toEqual(SAMPLE_EXPECTED.map((e) => e.npkNumber));
      expect(parsed.rows[0], lang).toMatchObject({ quantity: 1250, unit: 'm', unitPriceCents: 485 });
    }
  });

  it('reads abbreviated French headings (N° / Désignation / Qté / PU / Montant)', async () => {
    const parsed = await parse({ lines: SAMPLE_LINES, header: HEADERS.frShort });
    expect(parsed.rows.map((r) => r.npkNumber)).toEqual(SAMPLE_EXPECTED.map((e) => e.npkNumber));
  });

  it('keeps positions on the page they were printed on and does not run one across a break', async () => {
    const parsed = await parse({
      lines: [
        ...SAMPLE_LINES,
        { kind: 'pageBreak' },
        { kind: 'section', code: '232.1', text: 'Appareillage' },
        { kind: 'position', code: '573.148', text: 'Interrupteur va-et-vient', qte: '12.00', unite: 'pce', pu: '52.00', total: '624.00' },
      ],
    });
    expect(parsed.pageCount).toBe(2);
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.at(-1)).toMatchObject({ npkNumber: '573.148', page: 2, sectionCode: '232.1' });
  });

  it('keeps a position that prints only some of its cells', async () => {
    // Real sheets leave cells out: a forfait with no quantity, a unit left implicit, a lump sum
    // with no unit price. Each of these used to be dropped AND glued onto the position above,
    // so one missing cell cost two positions.
    const parsed = await parse({
      lines: [
        { kind: 'position', code: '571.201', text: 'Tube TT 20 mm', qte: '100.00', unite: 'm', pu: '4.85', total: '485.00' },
        { kind: 'position', code: '579.310', text: 'Mise à terre, liaison équipotentielle', unite: 'forfait', pu: '639.20', total: '639.20' },
        { kind: 'position', code: '573.112', text: 'Prise T13', qte: '48.00', pu: '46.50', total: "2'232.00" },
        { kind: 'position', code: '590.001', text: 'Installation de chantier', qte: '1.00', unite: 'forfait', total: "3'500.00" },
      ],
    });
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows[1]).toMatchObject({ npkNumber: '579.310', unit: 'forfait', unitPriceCents: 63920 });
    expect(parsed.rows[1].quantity).toBeUndefined();
    expect(parsed.rows[2]).toMatchObject({ npkNumber: '573.112', quantity: 48 });
    expect(parsed.rows[2].unit).toBeUndefined();
    expect(parsed.rows[3]).toMatchObject({ npkNumber: '590.001', totalPriceCents: 350000 });
    expect(parsed.rows[3].unitPriceCents).toBeUndefined();
    // The first position keeps its own description rather than absorbing the ones below it.
    expect(parsed.rows[0].description).toBe('Tube TT 20 mm');
  });

  it('still treats a heading printed with its running total as a heading, not a position', async () => {
    const parsed = await parse({
      lines: [
        { kind: 'subtotal', text: 'Total Installations électriques', total: "12'734.50" },
        { kind: 'position', code: '571.201', text: 'Tube TT 20 mm', qte: '100.00', unite: 'm', pu: '4.85', total: '485.00' },
      ],
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].npkNumber).toBe('571.201');
  });

  it('reads a sub-item printed without a number of its own', async () => {
    const parsed = await parse({
      lines: [
        { kind: 'position', code: '573.112', text: 'Prise T13 complète', qte: '48.00', unite: 'pce', pu: '46.50', total: "2'232.00" },
        { kind: 'position', text: 'idem, mais étanche IP44', qte: '6.00', unite: 'pce', pu: '58.00', total: '348.00' },
      ],
    });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]).toMatchObject({ quantity: 6, unit: 'pce', unitPriceCents: 5800 });
    expect(parsed.rows[1].npkNumber).toBeUndefined();
  });

  it('keeps a wrapped description whole and the figures with it', async () => {
    const long =
      'Tube TT 20 mm, posé encastré sous crépi, y compris boîtes de dérivation, colliers de ' +
      'fixation, percements et rebouchage selon directives SIA';
    const parsed = await parse({ lines: [{ kind: 'position', code: '571.201', text: long, qte: "1'250.00", unite: 'm', pu: '4.85', total: "6'062.50" }] });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ quantity: 1250, unit: 'm', unitPriceCents: 485 });
    expect(parsed.rows[0].description).toMatch(/^Tube TT 20 mm/);
    expect(parsed.rows[0].description).toMatch(/directives SIA$/);
  });

  it('reads amounts carrying a currency, and a discount as a negative', async () => {
    const parsed = await parse({
      lines: [
        { kind: 'position', code: '575.021', text: 'Luminaire LED', qte: '24.00', unite: 'pce', pu: 'CHF 185.00', total: "CHF 4'440.00" },
        { kind: 'position', code: '999.001', text: 'Rabais de quantité', qte: '1.00', unite: 'forfait', pu: '-250.00', total: '-250.00' },
      ],
    });
    expect(parsed.rows[0]).toMatchObject({ unitPriceCents: 18500, totalPriceCents: 444000 });
    expect(parsed.rows[1]).toMatchObject({ unitPriceCents: -25000, totalPriceCents: -25000 });
  });

  it('carries the columns onto a continuation page that does not reprint the header', async () => {
    const parsed = await parse({
      lines: [
        { kind: 'position', code: '571.201', text: 'Tube TT', qte: '100.00', unite: 'm', pu: '4.85', total: '485.00' },
        { kind: 'pageBreak', repeatHeader: false },
        { kind: 'position', code: '573.112', text: 'Prise T13', qte: '48.00', unite: 'pce', pu: '46.50', total: "2'232.00" },
      ],
    });
    expect(parsed.rows.map((r) => r.npkNumber)).toEqual(['571.201', '573.112']);
    expect(parsed.rows[1].page).toBe(2);
  });

  it('finds nothing in a scanned soumission rather than inventing positions', async () => {
    const parsed = await parse({ lines: SAMPLE_LINES, scanned: true });
    expect(parsed.rows).toHaveLength(0);
  });
});

describe('The PDF reader itself', () => {
  it('accepts only a real PDF, whatever the file is called', async () => {
    expect(isPdf(Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(isPdf(Buffer.from('<html>'))).toBe(false);
    await expect(extractPdfText(Buffer.from('not a pdf at all'))).rejects.toThrow(/not a PDF/i);
    await expect(extractPdfText(Buffer.alloc(0))).rejects.toThrow(/not a PDF/i);
  });

  it('refuses a file over the size limit before trying to read it', async () => {
    const huge = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(PDF_LIMITS.maxBytes)]);
    await expect(extractPdfText(huge)).rejects.toThrow(/10 MB/);
  });

  it('reports a corrupt PDF as unreadable instead of throwing something unexpected', async () => {
    await expect(extractPdfText(Buffer.from('%PDF-1.7\nnonsense'))).rejects.toThrow(/could not be read/i);
  });
});

describe('Importing a soumission PDF through the API', () => {
  /** Uploads, then walks the draft through to a confirmed import. */
  async function importPdf(pdf: Buffer, filename: string, body: Record<string, unknown> = {}) {
    const up = await upload(pdf, filename);
    if (up.status >= 300) return { ...up, draft: null };
    const confirmed = await admin.post(`/catalogue/drafts/${up.data.id}/confirm`, body);
    return { status: confirmed.status, data: confirmed.data, error: confirmed.error, draft: up.data };
  }

  it('parks what it read for review instead of importing it straight away', async () => {
    const pdf = await buildSoumissionPdf({ lines: SAMPLE_LINES, reference: '000777' });
    const res = await upload(pdf, 'Soumission_000777_Vinet.pdf');
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      status: 'pending',
      source: 'pdf',
      rowCount: 3,
      documentReference: '000777',
      projectName: 'Rénovation école Vinet, Lausanne',
      pageCount: 1,
    });
    expect(String(res.data.documentDate)).toMatch(/^2025-04-17/);
    expect(res.data.rows).toHaveLength(3);
    expect(res.data.rows[0]).toMatchObject({ npkNumber: '571.201', quantity: 1250, unit: 'm', reviewStatus: 'pending' });

    // Nothing has reached the catalogue yet: that is the whole point of the step.
    const docs = await admin.get('/catalogue/drafts?status=pending');
    expect(docs.data.some((d: any) => d.id === res.data.id)).toBe(true);
  });

  it('flags the lines that deserve a look and leaves the rest clean', async () => {
    const res = await upload(
      await buildSoumissionPdf({
        reference: '000778',
        lines: [
          // Priced, coded, consistent — but its code is not in the catalogue yet.
          { kind: 'position', code: '571.201', text: 'Tube TT', qte: '100.00', unite: 'm', pu: '4.85', total: '485.00' },
          // 10 x 50.00 is 500.00, not 900.00: a figure came out of the wrong column.
          { kind: 'position', code: '573.112', text: 'Prise T13', qte: '10.00', unite: 'pce', pu: '50.00', total: '900.00' },
          // Nothing to price it by.
          { kind: 'position', code: '575.021', text: 'Luminaire', qte: '5.00', unite: 'pce' },
          // A number that means something only inside its own soumission.
          { kind: 'position', code: '00000012', text: 'Poste interne', qte: '1.00', unite: 'forfait', pu: '100.00', total: '100.00' },
        ],
      }),
      'flags.pdf',
    );
    expect(res.status).toBe(201);
    const flagsOf = (code: string) => res.data.rows.find((r: any) => r.npkNumber === code).flags;
    expect(flagsOf('571.201')).toEqual(['UNKNOWN_CODE']);
    expect(flagsOf('573.112')).toEqual(expect.arrayContaining(['TOTAL_MISMATCH']));
    expect(flagsOf('575.021')).toEqual(expect.arrayContaining(['MISSING_PRICE']));
    expect(flagsOf('00000012')).toEqual(expect.arrayContaining(['INTERNAL_CODE']));
    expect(res.data.flaggedCount).toBe(4);
  });

  it('refuses to confirm while lines still carry a warning, unless the reviewer says so', async () => {
    const pdf = await buildSoumissionPdf({
      reference: '000779',
      lines: [{ kind: 'position', code: '573.112', text: 'Prise T13', qte: '10.00', unite: 'pce', pu: '50.00', total: '900.00' }],
    });
    const draft = (await upload(pdf, 'blocked.pdf')).data;
    const blocked = await admin.post(`/catalogue/drafts/${draft.id}/confirm`, {});
    expect(blocked.error?.details?.rule).toBe('DRAFT_HAS_FLAGS');
    expect(blocked.error?.details?.flaggedLines?.[0]?.flags).toEqual(expect.arrayContaining(['TOTAL_MISMATCH']));

    // Saying "I looked and it is fine" is a different act from not having looked.
    const accepted = await admin.post(`/catalogue/drafts/${draft.id}/confirm`, { acceptFlagged: true });
    expect(accepted.status).toBe(201);
    expect(accepted.data).toMatchObject({ totalRows: 1, acceptedWithFlags: 1 });
  });

  it('lets the reviewer correct a misread line, which clears its warning', async () => {
    const pdf = await buildSoumissionPdf({
      reference: '000780',
      lines: [{ kind: 'position', code: '573.112', text: 'Prise T13', qte: '10.00', unite: 'pce', pu: '50.00', total: '900.00' }],
    });
    const draft = (await upload(pdf, 'corrected.pdf')).data;
    const row = draft.rows[0];
    expect(row.flags).toEqual(expect.arrayContaining(['TOTAL_MISMATCH']));

    const fixed = await admin.patch(`/catalogue/drafts/${draft.id}/rows/${row.id}`, { totalPriceCents: 50000 });
    expect(fixed.status).toBe(200);
    expect(fixed.data.rows[0]).toMatchObject({ reviewStatus: 'edited', totalPriceCents: 50000 });
    expect(fixed.data.rows[0].flags).not.toContain('TOTAL_MISMATCH');

    // No warnings left, so it confirms without anyone having to override anything.
    const confirmed = await admin.post(`/catalogue/drafts/${draft.id}/confirm`, {});
    expect(confirmed.status).toBe(201);
    expect(confirmed.data).toMatchObject({ totalRows: 1, correctedRows: 1, acceptedWithFlags: 0 });
  });

  it('leaves an excluded line out of the import entirely', async () => {
    const pdf = await buildSoumissionPdf({
      reference: '000781',
      lines: [
        { kind: 'position', code: '571.201', text: 'Tube TT', qte: '100.00', unite: 'm', pu: '4.85', total: '485.00' },
        { kind: 'position', code: '999.999', text: 'Ligne parasite', qte: '1.00', unite: 'pce', pu: '1.00', total: '1.00' },
      ],
    });
    const draft = (await upload(pdf, 'excluded.pdf')).data;
    const junk = draft.rows.find((r: any) => r.npkNumber === '999.999');
    await admin.patch(`/catalogue/drafts/${draft.id}/rows/${junk.id}`, { excluded: true });

    const confirmed = await admin.post(`/catalogue/drafts/${draft.id}/confirm`, { acceptFlagged: true });
    expect(confirmed.status).toBe(201);
    expect(confirmed.data).toMatchObject({ totalRows: 1, excludedRows: 1 });
  });

  it('turns the prices of a known article into price history, once confirmed', async () => {
    const code = `585 771.${String(Date.now()).slice(-3)}`;
    await admin.post('/catalogue/articles', { npkNumber: code, description: 'Tube TT 20 mm, posé encastré', unit: 'm' });
    const pdf = await buildSoumissionPdf({
      reference: `0008${String(Date.now()).slice(-2)}`,
      lines: [{ kind: 'position', code, text: 'Tube TT 20 mm, posé encastré', qte: '100.00', unite: 'm', pu: '5.20', total: '520.00' }],
    });
    const draft = (await upload(pdf, `tube-${code}.pdf`)).data;
    // A code the catalogue knows, with a matching unit and consistent arithmetic: no warnings.
    expect(draft.rows[0].flags).toEqual([]);

    const res = await admin.post(`/catalogue/drafts/${draft.id}/confirm`, {});
    expect(res.status).toBe(201);
    expect(res.data.matchedRows).toBe(1);

    const article = (await admin.get(`/catalogue/articles?search=${encodeURIComponent(code)}`)).data[0];
    const stats = (await admin.get(`/catalogue/articles/${article.id}/prices`)).data;
    expect(stats).toMatchObject({ observationCount: 1, medianPriceCents: 520 });
    // Dated by the soumission printed on the page, not by the day it was imported (R001).
    expect(String(stats.lastPriceDate)).toMatch(/^2025-04-17/);
  });

  it('cannot be confirmed twice, nor after being discarded', async () => {
    // Distinct content: the catalogue de-duplicates on the rows themselves, so reusing another
    // test's figures would be refused as an already-imported document rather than a second confirm.
    const code = `585 782.${String(Date.now()).slice(-3)}`;
    const pdf = await buildSoumissionPdf({
      reference: '000782',
      lines: [{ kind: 'position', code, text: 'Tube TT confirmé deux fois', qte: '13.00', unite: 'm', pu: '7.70', total: '100.10' }],
    });
    const draft = (await upload(pdf, 'twice.pdf')).data;
    expect((await admin.post(`/catalogue/drafts/${draft.id}/confirm`, { acceptFlagged: true })).status).toBe(201);
    const again = await admin.post(`/catalogue/drafts/${draft.id}/confirm`, { acceptFlagged: true });
    expect(again.error?.details?.rule).toBe('DRAFT_NOT_PENDING');

    const other = (await upload(
      await buildSoumissionPdf({ reference: '000783', lines: [{ kind: 'position', code: '571.202', text: 'Tube', qte: '1.00', unite: 'm', pu: '1.00', total: '1.00' }] }),
      'discarded.pdf',
    )).data;
    expect((await admin.post(`/catalogue/drafts/${other.id}/discard`, {})).data.status).toBe('discarded');
    expect((await admin.post(`/catalogue/drafts/${other.id}/confirm`, { acceptFlagged: true })).error?.details?.rule).toBe('DRAFT_NOT_PENDING');
  });

  it('says plainly when a PDF holds no positions instead of parking an empty draft', async () => {
    const res = await upload(await buildSoumissionPdf({ lines: SAMPLE_LINES, scanned: true }), 'scan.pdf');
    expect(res.error?.details?.rule).toBe('PDF_NO_POSITIONS');
  });

  it('rejects a file that is not a PDF, an empty upload and the same file twice', async () => {
    expect((await upload(Buffer.from('<html>not a pdf</html>'), 'fake.pdf')).status).toBe(400);

    const form = new FormData();
    const res = await fetch(`${BASE_URL}/catalogue/import/pdf`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokenFor(USER_A.authId)}` }, body: form,
    });
    expect(res.status).toBe(400);

    const unique = `585 779.${String(Date.now()).slice(-3)}`;
    const pdf = await buildSoumissionPdf({
      lines: [{ kind: 'position', code: unique, text: 'Tube de réserve', qte: '7.00', unite: 'm', pu: '3.30', total: '23.10' }],
    });
    const name = `dup-${Date.now()}.pdf`;
    expect((await upload(pdf, name)).status).toBe(201);
    expect((await upload(pdf, name)).error?.details?.rule).toBe('DUPLICATE_IMPORT');
  });

  it('is office-only, from upload through to confirmation', async () => {
    const pdf = await buildSoumissionPdf({ lines: SAMPLE_LINES, reference: '000998' });
    expect((await upload(pdf, 'worker.pdf', {}, tokenFor(WORKER_1_A.authId))).status).toBe(403);
    const worker = apiClient(tokenFor(WORKER_1_A.authId));
    expect((await worker.get('/catalogue/drafts')).status).toBe(403);
  });
});
