import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

let app: INestApplication; let http: ReturnType<typeof request>;
let tokenA: string, tokenB: string, techToken: string;
let offerId: string, projectId: string, situationId: string, invoiceId: string, lineA1: string, lineA2: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication(); app.useGlobalFilters(new HttpExceptionFilter()); app.setGlobalPrefix('api');
  await app.init(); http = request(app.getHttpServer());
});
afterAll(async () => { await app.close(); });

const csv = `Code;Désignation;Unité;Matériel;Main d'oeuvre;Chapitre
511.211.100;Prise T13 encastrée;pce;20,00;30,00;511
511.311.100;Interrupteur simple;pce;15,00;25,00;511
574.100.100;Tableau divisionnaire 24 modules;pce;0,00;0,00;574
`;

describe('OXACAN end-to-end: catalogue → offre → adjudication → chantier → situation → facture', () => {
  it('bootstraps two companies (tenants) and a technician', async () => {
    const a = await http.post('/api/auth/bootstrap').send({ companyName: 'Électro Léman SA', email: 'dir@electro-leman.ch', password: 'password123', fullName: 'Direction' }).expect(201);
    tokenA = a.body.token;
    const b = await http.post('/api/auth/bootstrap').send({ companyName: 'Autre Entreprise Sàrl', email: 'dir@autre.ch', password: 'password123', fullName: 'Autre' }).expect(201);
    tokenB = b.body.token;
    const t = await http.post('/api/auth/users').set('Authorization', `Bearer ${tokenA}`).send({ email: 'tech@electro-leman.ch', password: 'password123', fullName: 'Technicien', role: 'TECHNICIEN' }).expect(201);
    expect(t.body.role).toBe('TECHNICIEN');
    techToken = (await http.post('/api/auth/login').send({ email: 'tech@electro-leman.ch', password: 'password123' }).expect(201)).body.token;
  });

  it('rejects unauthenticated access and wrong roles', async () => {
    await http.get('/api/offers').expect(401);
    await http.post('/api/offers').set('Authorization', `Bearer ${techToken}`).send({}).expect(403);
  });

  it('imports the company catalogue via CSV mapping (Option C) with a per-line error report', async () => {
    const r = await http.post('/api/catalogue/import').set('Authorization', `Bearer ${tokenA}`).send({ csv: csv + '\n;sans code;pce;1,00;1,00;511\n', mapping: { code: 'Code', label: 'Désignation', unit: 'Unité', material: 'Matériel', labour: "Main d'oeuvre", chapter: 'Chapitre', delimiter: ';', decimal: ',' } }).expect(201);
    expect(r.body).toMatchObject({ imported: 3, skipped: 1 });
    expect(r.body.errors[0].message).toBe('missing code');
    const list = await http.get('/api/catalogue?chapter=511').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0]).toMatchObject({ code: '511.211.100', material: 2000, labour: 3000 });
  });

  it('creates a composed article from catalogue positions (Q25)', async () => {
    const c = await http.post('/api/catalogue/composed').set('Authorization', `Bearer ${tokenA}`).send({ code: 'ART-PL-01', label: 'Point lumineux complet', unit: 'pce', components: [{ catalogueCode: '511.211.100', quantity: 1 }, { catalogueCode: '511.311.100', quantity: 1.25 }] }).expect(201);
    const cost = await http.get(`/api/catalogue/composed/${c.body.id}/cost`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(cost.body.cost).toEqual({ material: 2000 + 1875, labour: 3000 + 3125, subcontract: 0 });
  });

  it('creates an offer Zone > CFC > Chapitre > Article with numbered reference', async () => {
    const r = await http.post('/api/offers').set('Authorization', `Bearer ${tokenA}`).send({ clientName: 'Régie du Lac', title: 'Rénovation 24 appartements — lot électricité',
      zones: [
        { label: 'Rez-de-chaussée', cfcs: [{ code: '232', label: 'Installations à courant fort', chapters: [{ code: '511', label: 'Installations électriques', lines: [
          { kind: 'CATALOGUE', code: '511.211.100', quantity: 10 },
          { kind: 'COMPOSED', code: 'ART-PL-01', quantity: 4 },
        ] }] }] },
        { label: 'Étage', cfcs: [{ code: '232', label: 'Installations à courant fort', chapters: [{ code: '574', label: 'Tableaux', lines: [
          { kind: 'CUSTOM', code: 'TAB-01', label: 'Tableau divisionnaire (sous-traité)', unit: 'pce', quantity: 1, subcontract: 80000 },
          { kind: 'CATALOGUE', code: '574.100.100', quantity: 3, excluded: true },
        ] }] }] },
      ] }).expect(201);
    offerId = r.body.id;
    expect(r.body.reference).toBe(`O-${new Date().getFullYear()}-00001`);
    expect(r.body.status).toBe('PREPARATION');
    const lines = r.body.zones[0].cfcs[0].chapters[0].lines;
    lineA1 = lines[0].id; lineA2 = lines[1].id;
    expect(lines[0]).toMatchObject({ label: 'Prise T13 encastrée', material: 2000, labour: 3000 });
    expect(lines[1]).toMatchObject({ material: 3875, labour: 6125 });
  });

  it('refuses catalogue codes the company does not own', async () => {
    const r = await http.post('/api/offers').set('Authorization', `Bearer ${tokenA}`).send({ clientName: 'x', title: 'x', zones: [{ label: 'z', cfcs: [{ code: '232', label: 'c', chapters: [{ code: '511', label: 'c', lines: [{ kind: 'CATALOGUE', code: '999.999.999', quantity: 1 }] }] }] }] }).expect(400);
    expect(r.body.message).toMatch(/999\.999\.999/);
  });

  it('computes totals through the engine (factor 1.2, TVA 8.1 %, 5-cent rounding)', async () => {
    const t = (await http.get(`/api/offers/${offerId}/totals`).set('Authorization', `Bearer ${tokenA}`).expect(200)).body.totals;
    // 10 × 60.00 + 4 × 120.00 + 960.00 = 2'040.00 HT
    expect(t.totalExclVat).toBe(204000);
    expect(t.vatAmount).toBe(16524);
    expect(t.totalInclVat).toBe(220525); // 2'205.24 → 2'205.25
    expect(t.zones.map((z: { totalPrice: number }) => z.totalPrice)).toEqual([108000, 96000]);
    expect(t.lines.find((l: { code: string }) => l.code === '574.100.100').excluded).toBe(true);
  });

  it('isolates tenants: company B cannot see company A offers', async () => {
    await http.get(`/api/offers/${offerId}`).set('Authorization', `Bearer ${tokenB}`).expect(404);
    expect((await http.get('/api/offers').set('Authorization', `Bearer ${tokenB}`).expect(200)).body).toEqual([]);
    expect((await http.get('/api/catalogue').set('Authorization', `Bearer ${tokenB}`).expect(200)).body).toEqual([]);
  });

  it('awards the offer → project + lots + tasks generated without re-entry (Q34)', async () => {
    const p = await http.patch(`/api/offers/${offerId}/status`).set('Authorization', `Bearer ${tokenA}`).send({ status: 'ADJUGEE' }).expect(200);
    projectId = p.body.id;
    expect(p.body.lots).toHaveLength(2);
    expect(p.body.lots[0]).toMatchObject({ zoneLabel: 'Rez-de-chaussée', chapterCode: '511', budgetLabourCents: 30000 + 24500 });
    expect(p.body.lots[0].tasks).toHaveLength(2);
    expect(p.body.lots[1].tasks).toHaveLength(1); // excluded line generates no task
    await http.patch(`/api/offers/${offerId}/status`).set('Authorization', `Bearer ${tokenA}`).send({ status: 'ADJUGEE' }).expect(400);
  });

  it('tracks hours and progress on the site dashboard', async () => {
    const p = (await http.get(`/api/projects/${projectId}`).set('Authorization', `Bearer ${tokenA}`).expect(200)).body;
    const task = p.lots[0].tasks[0];
    await http.patch(`/api/projects/tasks/${task.id}`).set('Authorization', `Bearer ${techToken}`).send({ status: 'TERMINE', hoursDone: 4.5 }).expect(200);
    const d = (await http.get(`/api/projects/${projectId}/dashboard`).set('Authorization', `Bearer ${tokenA}`).expect(200)).body;
    expect(d).toMatchObject({ tasksTotal: 3, tasksDone: 1, progressPercent: 33, hoursDone: 4.5 });
    expect(d.budgetHours).toBeCloseTo(5.74, 2); // 545.00 / 95.00
  });

  it('creates situation n°1 from executed quantities with 5 % retention and deducts a deposit invoice', async () => {
    const dep = await http.post('/api/invoices').set('Authorization', `Bearer ${tokenA}`).send({ kind: 'ACOMPTE', totalExclVat: 20000, vatRate: 8.1 }).expect(201);
    expect(dep.body.number).toBe(`F-${new Date().getFullYear()}-00001`);
    await http.post(`/api/projects/${projectId}/executed`).set('Authorization', `Bearer ${tokenA}`).send({ executed: [{ lineId: lineA1, executedQuantity: 5 }, { lineId: lineA2, executedQuantity: 2 }] }).expect(201);
    const s = await http.post(`/api/projects/${projectId}/situations`).set('Authorization', `Bearer ${tokenA}`).send({ retentionPercent: 5 }).expect(201);
    situationId = s.body.id;
    expect(s.body).toMatchObject({ number: 1, cumulativeExclVat: 54000, retentionThisPeriod: 2700, depositsDeducted: 20000, netExclVat: 31300 });
  });

  it('invoices the situation with a continuous number, then corrects by credit note (Q20)', async () => {
    const inv = await http.post('/api/invoices/from-situation').set('Authorization', `Bearer ${tokenA}`).send({ situationId }).expect(201);
    invoiceId = inv.body.id;
    expect(inv.body.number).toBe(`F-${new Date().getFullYear()}-00002`);
    await http.post('/api/invoices/from-situation').set('Authorization', `Bearer ${tokenA}`).send({ situationId }).expect(400);
    const cn = await http.post(`/api/invoices/${invoiceId}/credit-note`).set('Authorization', `Bearer ${tokenA}`).expect(201);
    expect(cn.body.number).toBe(`AV-${new Date().getFullYear()}-00001`);
    expect(cn.body.totalInclVat).toBe(-inv.body.totalInclVat);
    const pf = (await http.get('/api/invoices/portfolio').set('Authorization', `Bearer ${tokenA}`).expect(200)).body;
    expect(pf.numberingGaps).toEqual([]);
    expect(pf.enAttente).toBe(21620); // acompte 200.00 + 8.1 % = 216.20
  });

  it('exposes a health endpoint hitting the database', async () => {
    expect((await http.get('/api/health').expect(200)).body).toMatchObject({ status: 'ok', db: 'ok' });
  });
});
