import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  apiClient, appRoleClient, BASE_URL, COMPANY_A, createProject, setSignedContext, tokenFor, USER_A, USER_B,
} from './setup';

const admin = apiClient(tokenFor(USER_A.authId));
const adminB = apiClient(tokenFor(USER_B.authId));

// Client IPs of this file's own (TEST-NET-2), so its anonymous calls and lockouts don't touch other files.
const IP = '198.51.100.20';

async function ok(p: Promise<{ status: number; data: any; error: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}

interface PortalResult { status: number; data: any; error: any; headers: Headers }

/** Anonymous call to /portal/view/<path>, from a given client IP. Non-JSON bodies come back as a Buffer. */
async function portal(method: string, path: string, body?: unknown, ip = IP): Promise<PortalResult> {
  const res = await fetch(`${BASE_URL}/portal/view/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'User-Agent': 'portal-test/1.0' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!(res.headers.get('content-type') ?? '').includes('json')) {
    return { status: res.status, data: Buffer.from(await res.arrayBuffer()), error: null, headers: res.headers };
  }
  const raw = await res.json();
  return { status: res.status, data: raw.data, error: raw.error, headers: res.headers };
}

async function sentOffer(projectName: string, clientId: string, lines: any[]) {
  const offer = await ok(admin.post('/offers', { projectName, clientId, marginFactor: 120, validityDays: 30 }));
  for (const l of lines) await ok(admin.post(`/offers/${offer.id}/lines`, l));
  await ok(admin.post(`/offers/${offer.id}/recalculate`));
  await ok(admin.patch(`/offers/${offer.id}/status`, { status: 'submitted' }));
  return offer;
}

let db: Client;
const fx: Record<string, string> = {};

beforeAll(async () => {
  db = await appRoleClient();
  await setSignedContext(db, COMPANY_A);

  fx.project = await createProject(admin, 'Portail Villa Léman');
  const project = await ok(admin.get(`/projects/${fx.project}`));
  fx.client = project.clientId;
  fx.projectName = project.name;
  fx.otherProject = await createProject(admin, 'Portail autre chantier');

  // Cost 100.00 × margin 1.20 → the client sees 120.00 per unit.
  fx.offer = (await sentOffer(fx.projectName, fx.client, [
    { description: 'Tableau électrique', unit: 'pce', quantity: 2, unitPriceCents: 10000 },
    { description: 'Prise supplémentaire', unit: 'pce', quantity: 1, unitPriceCents: 5000, variantType: 'OPTION' },
  ])).id;
  fx.offerToRefuse = (await sentOffer(fx.projectName, fx.client, [
    { description: 'Éclairage jardin', unit: 'pce', quantity: 4, unitPriceCents: 2500 },
  ])).id;
  fx.offerRace = (await sentOffer(fx.projectName, fx.client, [
    { description: 'Borne de recharge', unit: 'pce', quantity: 1, unitPriceCents: 150000 },
  ])).id;
  fx.offerExpired = (await sentOffer(fx.projectName, fx.client, [
    { description: 'Store motorisé', unit: 'pce', quantity: 1, unitPriceCents: 80000 },
  ])).id;
  await db.query(`UPDATE offer SET submitted_at = now() - interval '60 days' WHERE id = $1`, [fx.offerExpired]);
  fx.draftOffer = (await ok(admin.post('/offers', { projectName: fx.projectName, clientId: fx.client }))).id;
  const stranger = await ok(admin.post('/clients', { name: 'Portail autre client' }));
  fx.strangerOffer = (await sentOffer(fx.projectName, stranger.id, [
    { description: 'Autre client', unit: 'pce', quantity: 1, unitPriceCents: 1000 },
  ])).id;

  // Invoices: one sent then partly paid, one sent and credited, one left in draft; one on the other project.
  const invoice = (projectId: string, clientId: string, unitPriceCents: number) =>
    ok(admin.post('/invoices', {
      projectId, clientId, type: 'invoice', notes: 'Remarque interne?',
      lines: [{ description: 'Travaux', unit: 'h', quantity: 1, unitPriceCents }],
    }));
  const paid = await invoice(fx.project, fx.client, 100000);
  await ok(admin.patch(`/invoices/${paid.id}/status`, { status: 'sent' }));
  await ok(admin.post(`/invoices/${paid.id}/payments`, { amountCents: 30000, paymentDate: '2026-10-01', paymentMethod: 'bank_transfer' }));
  fx.invoicePaid = paid.id;
  const credited = await invoice(fx.project, fx.client, 20000);
  await ok(admin.patch(`/invoices/${credited.id}/status`, { status: 'sent' }));
  fx.creditNote = (await ok(admin.post(`/invoices/${credited.id}/credit-note`))).id;
  fx.invoiceDraft = (await invoice(fx.project, fx.client, 5000)).id;
  const otherClient = (await ok(admin.get(`/projects/${fx.otherProject}`))).clientId;
  const other = await invoice(fx.otherProject, otherClient, 7000);
  await ok(admin.patch(`/invoices/${other.id}/status`, { status: 'sent' }));
  fx.otherInvoice = other.id;

  // Documents: a plan with its file, a plan without one, a completed and an open meeting.
  const upload = async (planId: string) => {
    const res = await fetch(`${BASE_URL}/plans/${planId}/file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenFor(USER_A.authId)}`, 'Content-Type': 'application/pdf' },
      body: Buffer.from('%PDF-1.7\nportal plan\n'),
    });
    if (res.status >= 300) throw new Error(`plan upload ${res.status}`);
  };
  fx.plan = (await ok(admin.post('/plans', { name: 'Plan RDC', fileUrl: 'https://files.example.ch/rdc.pdf', fileType: 'pdf', projectId: fx.project }))).id;
  await upload(fx.plan);
  fx.planNoFile = (await ok(admin.post('/plans', { name: 'Plan sans fichier', fileUrl: 'https://files.example.ch/x.pdf', fileType: 'pdf', projectId: fx.project }))).id;
  fx.otherPlan = (await ok(admin.post('/plans', { name: 'Plan autre', fileUrl: 'https://files.example.ch/o.pdf', fileType: 'pdf', projectId: fx.otherProject }))).id;
  await upload(fx.otherPlan);
  fx.meetingDone = (await ok(admin.post('/meetings', { projectId: fx.project, meetingDate: '2026-09-29T08:00:00Z', location: 'Chantier' }))).id;
  await ok(admin.post(`/meetings/${fx.meetingDone}/complete`));
  fx.meetingOpen = (await ok(admin.post('/meetings', { projectId: fx.project, meetingDate: '2026-10-20T08:00:00Z' }))).id;

  fx.token = (await ok(admin.post('/portal/tokens', { projectId: fx.project }))).token;
  fx.otherToken = (await ok(admin.post('/portal/tokens', { projectId: fx.otherProject }))).token;
}, 120_000);

afterAll(async () => {
  await db.end();
});

describe('Portal links', () => {
  it('every link has an expiry (NULLs were backfilled and are no longer possible)', async () => {
    const { rows } = await db.query(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'portal_token' AND column_name = 'expires_at'`,
    );
    expect(rows[0].is_nullable).toBe('NO');
  });

  it('still serves the progress view, uncached', async () => {
    const res = await portal('GET', fx.token);
    expect(res.status).toBe(200);
    expect(res.data.project.id).toBe(fx.project);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('a revoked link opens nothing', async () => {
    const t = await ok(admin.post('/portal/tokens', { projectId: fx.project }));
    await ok(admin.del(`/portal/tokens/${t.id}`));
    for (const path of ['offers', 'invoices', 'documents', 'comments']) {
      expect((await portal('GET', `${t.token}/${path}`)).error?.details?.rule).toBe('INVALID_TOKEN');
    }
  });
});

describe('Portal offers', () => {
  it("lists the project's sent offers with selling prices only", async () => {
    const res = await portal('GET', `${fx.token}/offers`);
    expect(res.status).toBe(200);
    const ids = res.data.map((o: any) => o.id);
    expect(ids).toEqual(expect.arrayContaining([fx.offer, fx.offerToRefuse, fx.offerExpired]));
    // The contracted offer (accepted) is listed too; drafts and other clients' offers are not.
    expect(res.data.some((o: any) => o.status === 'accepted')).toBe(true);
    expect(ids).not.toContain(fx.draftOffer);
    expect(ids).not.toContain(fx.strangerOffer);

    const offer = res.data.find((o: any) => o.id === fx.offer);
    const base = offer.lines.find((l: any) => l.variantType === 'BASE');
    expect(base).toMatchObject({ quantity: 2, unitPriceHtCents: 12000, totalHtCents: 24000 });
    expect(offer.lines.find((l: any) => l.variantType === 'OPTION').unitPriceHtCents).toBe(6000);
    expect(offer.totalHtCents).toBe(24000);
    expect(offer).toMatchObject({ canRespond: true, canAccept: true, decision: null });
    expect(offer.consentTexts.accepted).toMatch(/signature électronique simple/);

    const json = JSON.stringify(res.data);
    expect(json).not.toMatch(/marginFactor|unitPriceCents|totalPriceCents|confidence|evidence|pricingStrategy|ruleId|createdBy|updatedBy|"notes"/);
    expect(JSON.stringify(offer.lines)).not.toMatch(/:10000\b|:5000\b/);
  });

  it('an offer past its validity can be refused but not accepted', async () => {
    const offers = (await portal('GET', `${fx.token}/offers`)).data;
    expect(offers.find((o: any) => o.id === fx.offerExpired)).toMatchObject({ canRespond: true, canAccept: false });
    const res = await portal('POST', `${fx.token}/offers/${fx.offerExpired}/decision`, {
      decision: 'accepted', signerName: 'Marie Muster', consent: true,
    });
    expect(res.error?.details?.rule).toBe('OFFER_EXPIRED');
  });

  it('serves the PDF of a visible offer only', async () => {
    const res = await portal('GET', `${fx.token}/offers/${fx.offer}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/pdf/);
    expect(res.data.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await portal('GET', `${fx.token}/offers/${fx.draftOffer}/pdf`)).status).toBe(404);
    expect((await portal('GET', `${fx.otherToken}/offers/${fx.offer}/pdf`)).status).toBe(404);
  });

  it('requires the typed name and the ticked consent box', async () => {
    const path = `${fx.token}/offers/${fx.offer}/decision`;
    expect((await portal('POST', path, { decision: 'accepted', signerName: 'Marie Muster' })).status).toBe(400);
    expect((await portal('POST', path, { decision: 'accepted', signerName: 'Marie Muster', consent: false })).status).toBe(400);
    expect((await portal('POST', path, { decision: 'accepted', signerName: '   ', consent: true })).status).toBe(400);
    expect((await portal('POST', path, { decision: 'maybe', signerName: 'Marie Muster', consent: true })).status).toBe(400);
  });

  it('accepts a sent offer through the offer status rules and keeps the signature evidence', async () => {
    const res = await portal('POST', `${fx.token}/offers/${fx.offer}/decision`, {
      decision: 'accepted', signerName: '  Marie   Muster ', consent: true, comment: 'Merci, bon pour accord.',
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ decision: 'accepted', signerName: 'Marie Muster', offerStatus: 'accepted' });

    const offer = await ok(admin.get(`/offers/${fx.offer}`));
    expect(offer.status).toBe('accepted');
    expect(offer.acceptedAt).toBeTruthy();

    const { rows } = await db.query(`SELECT * FROM portal_offer_decision WHERE offer_id = $1`, [fx.offer]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision: 'accepted', signer_name: 'Marie Muster', ip_address: IP, user_agent: 'portal-test/1.0',
      comment: 'Merci, bon pour accord.', offer_version: offer.version,
    });
    expect(Number(rows[0].offer_total_ttc_cents)).toBe(Number(offer.totalTtcCents));
    expect(rows[0].consent_text).toMatch(/^J'accepte l'offre/);
    expect(rows[0].offer_digest).toMatch(/^[0-9a-f]{64}$/);

    const n = await db.query(
      `SELECT title, body FROM notification WHERE user_id = $1 AND type = 'portal_offer_accepted' AND reference_id = $2`,
      [USER_A.id, fx.offer],
    );
    expect(n.rows).toHaveLength(1);
    expect(n.rows[0].title).toMatch(/acceptée par le client/);
    expect(n.rows[0].body).toMatch(/Marie Muster a accepté/);

    // Answered once: no second answer, and the list shows the answer.
    const again = await portal('POST', `${fx.token}/offers/${fx.offer}/decision`, { decision: 'rejected', signerName: 'Marie Muster', consent: true });
    expect(again.status).toBe(422);
    const listed = (await portal('GET', `${fx.token}/offers`)).data.find((o: any) => o.id === fx.offer);
    expect(listed).toMatchObject({ status: 'accepted', canRespond: false, decision: { decision: 'accepted', signerName: 'Marie Muster' } });
  });

  it('refuses a sent offer with a comment', async () => {
    const res = await portal('POST', `${fx.token}/offers/${fx.offerToRefuse}/decision`, {
      decision: 'rejected', signerName: 'Marie Muster', consent: true, comment: 'Trop cher pour nous.',
    });
    expect(res.status).toBe(201);
    expect((await ok(admin.get(`/offers/${fx.offerToRefuse}`))).status).toBe('rejected');
  });

  it('records exactly one answer when two arrive at once', async () => {
    const path = `${fx.token}/offers/${fx.offerRace}/decision`;
    const results = await Promise.all([
      portal('POST', path, { decision: 'accepted', signerName: 'Marie Muster', consent: true }),
      portal('POST', path, { decision: 'rejected', signerName: 'Paul Muster', consent: true }),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const { rows } = await db.query(`SELECT decision FROM portal_offer_decision WHERE offer_id = $1`, [fx.offerRace]);
    expect(rows).toHaveLength(1);
    expect((await ok(admin.get(`/offers/${fx.offerRace}`))).status).toBe(rows[0].decision);
  });

  it("cannot answer an offer that is not pending or not the link's project", async () => {
    const contracted = (await portal('GET', `${fx.token}/offers`)).data.find((o: any) => o.status === 'accepted' && o.id !== fx.offer);
    const res = await portal('POST', `${fx.token}/offers/${contracted.id}/decision`, { decision: 'rejected', signerName: 'Marie Muster', consent: true });
    expect(res.error?.details?.rule).toBe('OFFER_NOT_PENDING');
    expect((await portal('POST', `${fx.otherToken}/offers/${fx.offerExpired}/decision`, { decision: 'rejected', signerName: 'X Y', consent: true })).status).toBe(404);
    expect((await portal('POST', `${fx.token}/offers/${fx.draftOffer}/decision`, { decision: 'accepted', signerName: 'X Y', consent: true })).status).toBe(404);
  });
});

describe('Portal invoices', () => {
  it('lists issued invoices and credit notes with their payment status, no drafts or other projects', async () => {
    const res = await portal('GET', `${fx.token}/invoices`);
    expect(res.status).toBe(200);
    const ids = res.data.map((i: any) => i.id);
    expect(ids).not.toContain(fx.invoiceDraft);
    expect(ids).not.toContain(fx.otherInvoice);

    const paid = res.data.find((i: any) => i.id === fx.invoicePaid);
    expect(paid).toMatchObject({ paymentStatus: 'partially_paid', amountPaidCents: 30000, amountDueCents: paid.totalTtcCents - 30000 });
    expect(paid.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.data.find((i: any) => i.id === fx.creditNote)).toMatchObject({ type: 'credit_note', paymentStatus: 'credit_note' });
    expect(JSON.stringify(res.data)).not.toMatch(/"notes"|createdBy|pdfUrl/);
  });

  it('serves PDFs of issued invoices of the project only', async () => {
    const res = await portal('GET', `${fx.token}/invoices/${fx.invoicePaid}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/pdf/);
    expect((await portal('GET', `${fx.token}/invoices/${fx.creditNote}/pdf`)).status).toBe(200);
    expect((await portal('GET', `${fx.token}/invoices/${fx.invoiceDraft}/pdf`)).status).toBe(404);
    expect((await portal('GET', `${fx.token}/invoices/${fx.otherInvoice}/pdf`)).status).toBe(404);
    expect((await portal('GET', `${fx.token}/invoices/not-a-uuid/pdf`)).status).toBe(400);
  });
});

describe('Portal documents', () => {
  it('lists uploaded plans and completed meeting minutes', async () => {
    const res = await portal('GET', `${fx.token}/documents`);
    expect(res.status).toBe(200);
    expect(res.data.plans.map((p: any) => p.id)).toEqual([fx.plan]);
    expect(res.data.plans[0]).toMatchObject({ name: 'Plan RDC', contentType: 'application/pdf' });
    expect(JSON.stringify(res.data.plans)).not.toMatch(/fileUrl|uploadedBy/);
    expect(res.data.meetings.map((m: any) => m.id)).toEqual([fx.meetingDone]);
  });

  it('downloads the files of its own project only', async () => {
    const file = await portal('GET', `${fx.token}/plans/${fx.plan}/file`);
    expect(file.status).toBe(200);
    expect(file.data.toString()).toBe('%PDF-1.7\nportal plan\n');
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="Plan RDC\.pdf"/);
    expect((await portal('GET', `${fx.token}/plans/${fx.otherPlan}/file`)).status).toBe(404);
    expect((await portal('GET', `${fx.token}/plans/${fx.planNoFile}/file`)).status).toBe(404);

    const pv = await portal('GET', `${fx.token}/meetings/${fx.meetingDone}/pdf`);
    expect(pv.status).toBe(200);
    expect(pv.headers.get('content-type')).toMatch(/pdf/);
    expect((await portal('GET', `${fx.token}/meetings/${fx.meetingOpen}/pdf`)).status).toBe(404);
  });
});

describe('Portal comments', () => {
  it('stores a client comment, shows it back and notifies the office in French', async () => {
    const res = await portal('POST', `${fx.token}/comments`, { authorName: 'Marie Muster', body: 'Quand posez-vous les prises ?' });
    expect(res.status).toBe(201);
    const list = (await portal('GET', `${fx.token}/comments`)).data;
    expect(list.at(-1)).toMatchObject({ id: res.data.id, authorName: 'Marie Muster', body: 'Quand posez-vous les prises ?' });
    expect(JSON.stringify(list)).not.toMatch(/ipAddress|userAgent|portalTokenId/);
    // Comments belong to the project: the other project's link does not see them.
    expect((await portal('GET', `${fx.otherToken}/comments`)).data.map((c: any) => c.id)).not.toContain(res.data.id);

    const n = await db.query(
      `SELECT title, body FROM notification WHERE user_id = $1 AND type = 'portal_comment' AND reference_id = $2`,
      [USER_A.id, fx.project],
    );
    expect(n.rows.length).toBeGreaterThan(0);
    expect(n.rows[0].title).toMatch(/^Nouveau commentaire du client sur le projet/);
    expect(n.rows[0].body).toBe('Marie Muster : Quand posez-vous les prises ?');
  });

  it('validates comments', async () => {
    expect((await portal('POST', `${fx.token}/comments`, { authorName: 'M', body: '' })).status).toBe(400);
    expect((await portal('POST', `${fx.token}/comments`, { authorName: 'M', body: 'x'.repeat(4001) })).status).toBe(400);
    expect((await portal('POST', `${fx.token}/comments`, { authorName: 'M', body: 'ok', projectId: fx.otherProject })).status).toBe(400);
  });

  it('caps the comments a link can post per hour', async () => {
    const t = (await ok(admin.post('/portal/tokens', { projectId: fx.otherProject }))).token;
    const ip = '198.51.100.30';
    for (let i = 0; i < 20; i++) {
      expect((await portal('POST', `${t}/comments`, { authorName: 'Spam', body: `n° ${i}` }, ip)).status).toBe(201);
    }
    expect((await portal('POST', `${t}/comments`, { authorName: 'Spam', body: 'one more' }, ip)).error?.details?.rule).toBe('COMMENT_LIMIT');
  });

  it('office users read the comments and decisions of their own company only', async () => {
    const comments = await ok(admin.get(`/portal/projects/${fx.project}/comments`));
    expect(comments.some((c: any) => c.authorName === 'Marie Muster' && c.ipAddress === IP)).toBe(true);
    const decisions = await ok(admin.get(`/portal/projects/${fx.project}/offer-decisions`));
    expect(decisions.some((d: any) => d.offerId === fx.offer && d.decision === 'accepted')).toBe(true);
    expect((await adminB.get(`/portal/projects/${fx.project}/comments`)).status).toBe(404);
    expect((await adminB.get(`/portal/projects/${fx.project}/offer-decisions`)).status).toBe(404);
  });
});

describe('Portal guessing', () => {
  it('locks an IP out after repeated invalid links, even for a valid one', async () => {
    const ip = '198.51.100.40';
    for (let i = 0; i < 20; i++) {
      expect((await portal('GET', `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, undefined, ip)).status).toBe(422);
    }
    expect((await portal('GET', `${fx.token}/offers`, undefined, ip)).status).toBe(429);
    // Other clients are not affected.
    expect((await portal('GET', `${fx.token}/offers`)).status).toBe(200);
  });
});
