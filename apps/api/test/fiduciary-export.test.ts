import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import {
  apiClient, tokenFor, createProject, BASE_URL, TEST_DB, COMPANY_A,
  USER_A, PM_A, TEAM_LEAD_A, WORKER_1_A, WORKER_2_A,
} from './setup';

/**
 * PRD §17 fiduciary export: heures_employes / frais_debours / resume_projets, UTF-8 BOM, ';',
 * CRLF, ISO dates, exact columns, and §17.6 access (a project manager sees only their projects).
 * Data lives in 2031-03 so rows created by other suites (dated "today") never leak in.
 */

const admin = apiClient(tokenFor(USER_A.authId));
const pm = apiClient(tokenFor(PM_A.authId));
const lead = apiClient(tokenFor(TEAM_LEAD_A.authId));
const worker = apiClient(tokenFor(WORKER_1_A.authId));

const MARCH = 'dateFrom=2031-03-01&dateTo=2031-03-31';

const HEURES_COLUMNS = [
  'date', 'employe_nom', 'employe_id', 'projet_ref', 'projet_nom', 'heures_normales',
  'heures_supplementaires', 'heures_deplacement', 'heures_total', 'taux_horaire', 'montant_total', 'remarque',
];
const FRAIS_COLUMNS = [
  'date', 'employe_nom', 'employe_id', 'projet_ref', 'projet_nom', 'categorie', 'description',
  'montant_ht', 'tva_taux', 'tva_montant', 'montant_ttc', 'ref_justificatif',
];
const RESUME_COLUMNS = [
  'projet_ref', 'projet_nom', 'periode', 'total_heures', 'cout_main_oeuvre', 'cout_materiel',
  'cout_deplacement', 'cout_sous_traitance', 'cout_divers', 'cout_total',
];

async function ok(p: Promise<{ status: number; data: any; error: any }>) {
  const res = await p;
  if (res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.error)}`);
  return res.data;
}

/** Minimal parser for the export format: BOM, ';' separator, "…" quoting, CRLF rows. */
function parse(csv: string): { header: string[]; rows: Record<string, string>[] } {
  const lines: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const text = csv.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') { row.push(field); field = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(field); lines.push(row); row = []; field = ''; i++; }
    else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); lines.push(row); }
  const [header, ...body] = lines;
  return { header, rows: body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))) };
}

let db: Client;
const prj: Record<'pm' | 'other', { id: string; reference: string; name: string }> = {} as any;

beforeAll(async () => {
  db = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_MIGRATION_USERNAME || process.env.DB_USERNAME,
    password: process.env.DB_MIGRATION_PASSWORD || process.env.DB_PASSWORD,
    database: TEST_DB,
  });
  await db.connect();

  // "Own projects" = project.manager_id. The admin signs both contracts; one is handed to PM_A.
  const pmProjectId = await createProject(admin, 'Fidu Chantier PM');
  const otherProjectId = await createProject(admin, 'Fidu Chantier Direction');
  await db.query('UPDATE project SET manager_id = $1 WHERE id = $2', [PM_A.id, pmProjectId]);
  for (const [key, id] of [['pm', pmProjectId], ['other', otherProjectId]] as const) {
    const { rows } = await db.query('SELECT id, reference, name, manager_id FROM project WHERE id = $1', [id]);
    prj[key] = rows[0];
  }
  expect(prj.pm).toMatchObject({ manager_id: PM_A.id });
  expect(prj.other).toMatchObject({ manager_id: USER_A.id });

  const time = (
    userId: string, projectId: string, date: string, category: string,
    normal: number, overtime: number, travel: number, rateCents: number, notes: string | null, status = 'approved',
  ) => {
    const total = normal + overtime + travel;
    return db.query(
      `INSERT INTO time_entry (company_id, user_id, project_id, date, start_time, end_time, break_minutes,
         normal_minutes, overtime_minutes, travel_minutes, total_minutes, hourly_rate_cents, cost_cents,
         category, status, notes)
       VALUES ($1, $2, $3, $4, '07:00', '16:00', 0, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [COMPANY_A, userId, projectId, date, normal, overtime, travel, total, rateCents,
        Math.round((total / 60) * rateCents), category, status, notes],
    );
  };
  await time(WORKER_1_A.id, prj.pm.id, '2031-03-05', 'normal', 480, 30, 0, 6500, 'Pose; tableau "TD1"');
  await time(WORKER_2_A.id, prj.other.id, '2031-03-06', 'travel', 0, 0, 60, 5000, '=HYPERLINK("http://evil.example")');
  await time(WORKER_1_A.id, prj.pm.id, '2031-03-07', 'normal', 240, 0, 0, 6500, 'brouillon', 'draft');
  await time(WORKER_1_A.id, prj.pm.id, '2031-04-02', 'normal', 120, 0, 0, 6500, null);

  const expense = (
    userId: string, projectId: string | null, date: string, category: string,
    description: string, amountCents: number, receiptUrl: string | null, status = 'approved',
  ) =>
    db.query(
      `INSERT INTO expense (company_id, user_id, project_id, date, category, description, amount_cents, receipt_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [COMPANY_A, userId, projectId, date, category, description, amountCents, receiptUrl, status],
    );
  await expense(WORKER_1_A.id, prj.pm.id, '2031-03-05', 'material', 'Câble TT 3x1.5', 12000, 'https://files.example/r1.pdf');
  await expense(WORKER_1_A.id, prj.pm.id, '2031-03-05', 'equipment_rental', 'Location nacelle', 3000, null);
  await expense(WORKER_1_A.id, prj.pm.id, '2031-03-08', 'per_diem', 'Repas chantier', 2500, null);
  await expense(WORKER_2_A.id, prj.other.id, '2031-03-06', 'subcontractor', 'Carottage', 50000, null);
  await expense(WORKER_1_A.id, null, '2031-03-09', 'other', 'Fournitures bureau', 1500, null);
  await expense(WORKER_1_A.id, prj.pm.id, '2031-03-10', 'material', 'Refusé', 99900, null, 'rejected');
});

afterAll(async () => {
  await db.end();
});

describe('Fiduciary export format (PRD §17.2–17.5)', () => {
  let exp: any;
  beforeAll(async () => {
    exp = await ok(admin.get(`/accounting/export/fiduciary?${MARCH}`));
  });

  it('returns exactly the three §17 files with YYYY-MM file names', () => {
    expect(Object.keys(exp.files).sort()).toEqual(['frais_debours', 'heures_employes', 'resume_projets']);
    expect(exp.files.heures_employes.filename).toBe('heures_employes_2031-03.csv');
    expect(exp.files.frais_debours.filename).toBe('frais_debours_2031-03.csv');
    expect(exp.files.resume_projets.filename).toBe('resume_projets_2031-03.csv');
    expect(exp.scope).toBe('all');
    expect(exp).not.toHaveProperty('journalCsv');
  });

  it.each([
    ['heures_employes', HEURES_COLUMNS],
    ['frais_debours', FRAIS_COLUMNS],
    ['resume_projets', RESUME_COLUMNS],
  ])('%s: UTF-8 BOM, exact header, ";" separator, CRLF on every line', (key, columns) => {
    const content: string = exp.files[key].content;
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content.slice(1).startsWith(columns.join(';') + '\r\n')).toBe(true);
    expect(content.endsWith('\r\n')).toBe(true);
    expect(content.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const { header, rows } = parse(content);
    expect(header).toEqual(columns);
    expect(rows.length).toBe(exp.files[key].rowCount);
  });

  it('heures_employes: approved entries only, ISO dates, decimal hours and CHF amounts', () => {
    const { rows } = parse(exp.files.heures_employes.content);
    expect(rows.map((r) => r.date)).toEqual(['2031-03-05', '2031-03-06']); // draft and April excluded
    for (const r of rows) expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const w1 = rows.find((r) => r.employe_id === WORKER_1_A.id)!;
    expect(w1).toMatchObject({
      employe_nom: 'Test WORKER',
      projet_ref: prj.pm.reference,
      projet_nom: prj.pm.name,
      heures_normales: '8.00',
      heures_supplementaires: '0.50',
      heures_deplacement: '0.00',
      heures_total: '8.50',
      taux_horaire: '65.00',
      montant_total: '552.50',
      remarque: 'Pose; tableau "TD1"',
    });
    // a text containing ';' is wrapped in double quotes in the raw file
    expect(exp.files.heures_employes.content).toContain('"Pose; tableau ""TD1"""');
    const w2 = rows.find((r) => r.employe_id === WORKER_2_A.id)!;
    expect(w2).toMatchObject({ heures_deplacement: '1.00', heures_total: '1.00', montant_total: '50.00' });
  });

  it('keeps the CSV-injection guard on text cells', () => {
    const { rows } = parse(exp.files.heures_employes.content);
    expect(rows.find((r) => r.employe_id === WORKER_2_A.id)!.remarque).toBe(`'=HYPERLINK("http://evil.example")`);
  });

  it('frais_debours: §17.4 categories, VAT columns, receipt reference, approved only', () => {
    const { rows } = parse(exp.files.frais_debours.content);
    expect(rows.map((r) => r.description)).toEqual([
      'Câble TT 3x1.5', 'Location nacelle', 'Carottage', 'Repas chantier', 'Fournitures bureau',
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.description, r]));
    expect(by['Câble TT 3x1.5']).toMatchObject({
      date: '2031-03-05', categorie: 'materiel', montant_ht: '120.00', tva_taux: '0.00',
      tva_montant: '0.00', montant_ttc: '120.00', ref_justificatif: 'https://files.example/r1.pdf',
      projet_ref: prj.pm.reference,
    });
    expect(by['Location nacelle'].categorie).toBe('equipement');
    expect(by['Repas chantier'].categorie).toBe('deplacement');
    expect(by['Carottage'].categorie).toBe('sous-traitance');
    expect(by['Fournitures bureau']).toMatchObject({ categorie: 'divers', projet_ref: '', projet_nom: '' });
    for (const r of rows) {
      expect(['materiel', 'deplacement', 'equipement', 'sous-traitance', 'divers']).toContain(r.categorie);
      expect(Number(r.montant_ht) + Number(r.tva_montant)).toBeCloseTo(Number(r.montant_ttc), 2);
    }
  });

  it('resume_projets: per project and month, reconciling with the detail files', () => {
    const { rows } = parse(exp.files.resume_projets.content);
    const pmRow = rows.find((r) => r.projet_ref === prj.pm.reference)!;
    expect(pmRow).toEqual({
      projet_ref: prj.pm.reference,
      projet_nom: prj.pm.name,
      periode: '2031-03',
      total_heures: '8.50',
      cout_main_oeuvre: '552.50',
      cout_materiel: '150.00', // matériel 120 + équipement 30
      cout_deplacement: '25.00',
      cout_sous_traitance: '0.00',
      cout_divers: '0.00',
      cout_total: '727.50',
    });
    const other = rows.find((r) => r.projet_ref === prj.other.reference)!;
    expect(other).toMatchObject({ total_heures: '1.00', cout_main_oeuvre: '50.00', cout_sous_traitance: '500.00', cout_total: '550.00' });
    expect(rows).toHaveLength(2); // the expense without a project has no summary row
  });

  it('names multi-month files YYYY-MM_YYYY-MM and splits the summary by month', async () => {
    const q = await ok(admin.get('/accounting/export/fiduciary?dateFrom=2031-03-01&dateTo=2031-04-30'));
    expect(q.files.heures_employes.filename).toBe('heures_employes_2031-03_2031-04.csv');
    const periods = parse(q.files.resume_projets.content).rows
      .filter((r) => r.projet_ref === prj.pm.reference).map((r) => r.periode);
    expect(periods).toEqual(['2031-03', '2031-04']);
  });

  it('applies the §17.7 filters (category, employee)', async () => {
    const mat = await ok(admin.get(`/accounting/export/fiduciary?${MARCH}&category=materiel`));
    expect(parse(mat.files.frais_debours.content).rows.map((r) => r.categorie)).toEqual(['materiel']);
    const w2 = await ok(admin.get(`/accounting/export/fiduciary?${MARCH}&employeeId=${WORKER_2_A.id}`));
    expect(parse(w2.files.heures_employes.content).rows.map((r) => r.employe_id)).toEqual([WORKER_2_A.id]);
    expect((await admin.get(`/accounting/export/fiduciary?${MARCH}&category=material`)).status).toBe(400);
  });

  it('serves each file as raw text/csv with the exact bytes', async () => {
    const res = await fetch(`${BASE_URL}/accounting/export/fiduciary/frais_debours?${MARCH}`, {
      headers: { Authorization: `Bearer ${tokenFor(USER_A.authId)}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toContain('frais_debours_2031-03.csv');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf8')).toBe(exp.files.frais_debours.content);
    expect(bytes.includes(Buffer.from('\r\n'))).toBe(true);
    expect((await admin.get(`/accounting/export/fiduciary/journal?${MARCH}`)).status).toBe(400);
  });

  it('rejects impossible dates and reversed ranges with a 400', async () => {
    for (const q of ['dateFrom=2031-02-30&dateTo=2031-03-31', 'dateFrom=2031-03-31&dateTo=2031-03-01', 'dateFrom=2031-03-01']) {
      expect((await admin.get(`/accounting/export/fiduciary?${q}`)).status).toBe(400);
    }
  });
});

describe('Fiduciary export access (PRD §17.6)', () => {
  it('a project manager only gets rows of the projects they manage', async () => {
    const exp = await ok(pm.get(`/accounting/export/fiduciary?${MARCH}`));
    expect(exp.scope).toBe('own_projects');
    for (const key of ['heures_employes', 'frais_debours', 'resume_projets']) {
      const { rows } = parse(exp.files[key].content);
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.projet_ref))).toEqual(new Set([prj.pm.reference]));
    }
    const frais = parse(exp.files.frais_debours.content).rows.map((r) => r.description);
    expect(frais).not.toContain('Carottage');
    expect(frais).not.toContain('Fournitures bureau'); // no project → not the PM's
    expect(parse(exp.files.heures_employes.content).rows.map((r) => r.employe_id)).not.toContain(WORKER_2_A.id);
  });

  it('a project manager cannot export another manager\'s project', async () => {
    expect((await pm.get(`/accounting/export/fiduciary?${MARCH}&projectId=${prj.other.id}`)).status).toBe(403);
    expect((await pm.get(`/accounting/export/fiduciary/heures_employes?${MARCH}&projectId=${prj.other.id}`)).status).toBe(403);
    expect((await pm.get(`/accounting/export/fiduciary?${MARCH}&projectId=${prj.pm.id}`)).status).toBe(200);
  });

  it('team leaders and workers have no access', async () => {
    expect((await lead.get(`/accounting/export/fiduciary?${MARCH}`)).status).toBe(403);
    expect((await worker.get(`/accounting/export/fiduciary?${MARCH}`)).status).toBe(403);
    expect((await worker.get(`/accounting/export/fiduciary/heures_employes?${MARCH}`)).status).toBe(403);
  });
});
