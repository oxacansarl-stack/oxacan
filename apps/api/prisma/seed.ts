/**
 * Données de démonstration : une entreprise fictive, un catalogue réduit (codes de structure CAN 511/574,
 * prix fictifs — aucune donnée CRB), un article composé, une offre, un projet adjugé.
 * Identifiants : dir@demo.oxacan.ch / demo12345 (Dirigeant), tech@demo.oxacan.ch / demo12345 (Technicien).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { offerToWorkLots, formatDocumentNumber } from '@oxacan/engine';

const prisma = new PrismaClient();

const CATALOGUE = [
  ['511.211.100', 'Prise T13 encastrée, y c. raccordement', 'pce', 12.5, 28.0, '511'],
  ['511.211.110', 'Prise T13 double encastrée', 'pce', 18.9, 30.0, '511'],
  ['511.311.100', 'Interrupteur simple encastré', 'pce', 14.2, 25.0, '511'],
  ['511.311.120', 'Interrupteur va-et-vient', 'pce', 16.8, 27.0, '511'],
  ['511.411.100', 'Point lumineux plafond, boîte et raccordement', 'pce', 9.4, 32.0, '511'],
  ['511.611.200', 'Tube M20 encastré, y c. tirage', 'm', 1.9, 6.5, '511'],
  ['511.621.300', 'Câble TT 3×1.5 mm² en tube', 'm', 1.1, 2.2, '511'],
  ['511.621.310', 'Câble TT 3×2.5 mm² en tube', 'm', 1.7, 2.4, '511'],
  ['574.100.100', 'Tableau divisionnaire 24 modules, pose et raccordement', 'pce', 320.0, 380.0, '574'],
  ['574.210.100', 'Disjoncteur 13A courbe C', 'pce', 18.0, 12.0, '574'],
  ['574.210.200', 'Disjoncteur 16A courbe C', 'pce', 19.5, 12.0, '574'],
  ['574.310.100', 'Interrupteur différentiel 40A/30mA', 'pce', 58.0, 18.0, '574'],
] as const;

async function main() {
  const email = 'dir@demo.oxacan.ch';
  if (await prisma.user.findFirst({ where: { email } })) { console.log('seed already applied'); return; }
  const hash = await bcrypt.hash('demo12345', 10);
  const tenant = await prisma.tenant.create({ data: { name: 'Électro Démo SA', hourlyRate: 9500, users: { create: [
    { email, passwordHash: hash, fullName: 'Direction Démo', role: 'DIRIGEANT' },
    { email: 'chef@demo.oxacan.ch', passwordHash: hash, fullName: 'Chef de projet Démo', role: 'CHEF_PROJET' },
    { email: 'tech@demo.oxacan.ch', passwordHash: hash, fullName: 'Technicien Démo', role: 'TECHNICIEN' },
  ] } } });
  await prisma.catalogueItem.createMany({ data: CATALOGUE.map(([code, label, unit, mat, lab, chapter]) => ({ tenantId: tenant.id, code, label, unit, chapter, material: Math.round(mat * 100), labour: Math.round(lab * 100) })) });
  await prisma.composedArticle.create({ data: { tenantId: tenant.id, code: 'ART-PL-01', label: 'Point lumineux complet (boîte, tube 3 m, câble 3 m, interrupteur)', unit: 'pce', components: { create: [
    { catalogueCode: '511.411.100', quantity: 1 }, { catalogueCode: '511.611.200', quantity: 3 }, { catalogueCode: '511.621.300', quantity: 3 }, { catalogueCode: '511.311.100', quantity: 1 } ] } } });
  const items = await prisma.catalogueItem.findMany({ where: { tenantId: tenant.id } });
  const c = (code: string) => items.find((i) => i.code === code)!;
  const seq = await prisma.documentSequence.upsert({ where: { tenantId_kind_year: { tenantId: tenant.id, kind: 'offer', year: 2026 } }, create: { tenantId: tenant.id, kind: 'offer', year: 2026, last: 1 }, update: { last: { increment: 1 } } });
  const line = (pos: number, code: string, qty: number, kind: 'CATALOGUE' | 'CUSTOM' = 'CATALOGUE', extra: object = {}) => ({ position: pos, kind, code, label: c(code).label, unit: c(code).unit, quantity: qty, material: c(code).material, labour: c(code).labour, subcontract: 0, ...extra });
  const offer = await prisma.offer.create({ data: { tenantId: tenant.id, reference: formatDocumentNumber('offer', 2026, seq.last), clientName: 'Régie du Lac SA', title: 'Rénovation 24 appartements — lot électricité', sellFactor: 1.2, vatRate: 8.1, status: 'PREPARATION',
    zones: { create: [
      { position: 0, label: 'Appartements types (×24)', cfcs: { create: [{ position: 0, code: '232', label: 'Installations à courant fort', chapters: { create: [
        { position: 0, code: '511', label: 'Installations électriques', lines: { create: [line(0, '511.211.100', 240), line(1, '511.211.110', 96), line(2, '511.311.100', 120), line(3, '511.311.120', 48), line(4, '511.411.100', 168), line(5, '511.611.200', 2400), line(6, '511.621.300', 1800), line(7, '511.621.310', 900)] } },
        { position: 1, code: '574', label: 'Tableaux et protections', lines: { create: [line(0, '574.100.100', 24), line(1, '574.210.100', 240), line(2, '574.210.200', 96), line(3, '574.310.100', 48)] } },
      ] } }] } },
      { position: 1, label: 'Communs et cave', cfcs: { create: [{ position: 0, code: '232', label: 'Installations à courant fort', chapters: { create: [
        { position: 0, code: '511', label: 'Installations électriques', lines: { create: [line(0, '511.411.100', 32), line(1, '511.311.120', 16), line(2, '511.611.200', 400), { position: 3, kind: 'CUSTOM', code: 'ST-ECL-01', label: 'Éclairage de secours (sous-traité)', unit: 'ens', quantity: 1, material: 0, labour: 0, subcontract: 640000 }] } },
      ] } }] } },
    ] } }, include: { zones: { include: { cfcs: { include: { chapters: { include: { lines: true } } } } } } } });
  console.log(`seeded tenant ${tenant.name}, offer ${offer.reference}`);
}
main().finally(() => prisma.$disconnect());
