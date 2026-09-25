import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { computeOffer, formatDocumentNumber, offerToWorkLots } from '@oxacan/engine';
import { PrismaService } from '../prisma/prisma.service';
import { toEngineOffer, type OfferWithTree } from './offers.mapper';

export interface LineInput { kind: 'CATALOGUE' | 'COMPOSED' | 'CUSTOM'; code: string; label?: string; unit?: string; quantity: number; material?: number; labour?: number; subcontract?: number; factorOverride?: number; excluded?: boolean; }
export interface ChapterInput { code: string; label: string; lines: LineInput[]; }
export interface CfcInput { code: string; label: string; chapters: ChapterInput[]; }
export interface ZoneInput { label: string; cfcs: CfcInput[]; }
export interface OfferInput { clientName: string; title: string; sellFactor?: number; vatRate?: number; discountPercent?: number; zones: ZoneInput[]; }

const TREE = { zones: { include: { cfcs: { include: { chapters: { include: { lines: true } } } } } } } as const;

@Injectable()
export class OffersService {
  constructor(private readonly prisma: PrismaService) {}

  private async nextReference(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], tenantId: string, kind: 'offer' | 'invoice' | 'credit_note') {
    const year = new Date().getFullYear();
    const seq = await tx.documentSequence.upsert({ where: { tenantId_kind_year: { tenantId, kind, year } }, create: { tenantId, kind, year, last: 1 }, update: { last: { increment: 1 } } });
    return formatDocumentNumber(kind, year, seq.last);
  }

  /** Les lignes CATALOGUE prennent leur coût dans le catalogue de l'entreprise ; CUSTOM porte son coût ; COMPOSED est résolu via ses composants. */
  async create(tenantId: string, input: OfferInput) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const codes = input.zones.flatMap((z) => z.cfcs.flatMap((c) => c.chapters.flatMap((ch) => ch.lines.filter((l) => l.kind === 'CATALOGUE').map((l) => l.code))));
    const items = await this.prisma.catalogueItem.findMany({ where: { tenantId, code: { in: codes } } });
    const missing = [...new Set(codes)].filter((c) => !items.some((i) => i.code === c));
    if (missing.length) throw new BadRequestException(`catalogue codes not found for this company: ${missing.join(', ')}`);
    const composedCodes = input.zones.flatMap((z) => z.cfcs.flatMap((c) => c.chapters.flatMap((ch) => ch.lines.filter((l) => l.kind === 'COMPOSED').map((l) => l.code))));
    const composed = await this.prisma.composedArticle.findMany({ where: { tenantId, code: { in: composedCodes } }, include: { components: true } });
    const compItems = await this.prisma.catalogueItem.findMany({ where: { tenantId, code: { in: composed.flatMap((c) => c.components.map((x) => x.catalogueCode)) } } });
    const resolve = (l: LineInput) => {
      if (l.kind === 'CATALOGUE') { const it = items.find((i) => i.code === l.code)!; return { label: l.label ?? it.label, unit: l.unit ?? it.unit, material: it.material, labour: it.labour, subcontract: it.subcontract }; }
      if (l.kind === 'COMPOSED') {
        const c = composed.find((x) => x.code === l.code); if (!c) throw new BadRequestException(`composed article not found: ${l.code}`);
        const cost = c.components.reduce((acc, x) => { const it = compItems.find((i) => i.code === x.catalogueCode); if (!it) throw new BadRequestException(`component ${x.catalogueCode} missing from catalogue`); const q = Number(x.quantity); return { material: acc.material + Math.round(it.material * q), labour: acc.labour + Math.round(it.labour * q), subcontract: acc.subcontract + Math.round(it.subcontract * q) }; }, { material: 0, labour: 0, subcontract: 0 });
        return { label: l.label ?? c.label, unit: l.unit ?? c.unit, ...cost };
      }
      if (!l.label) throw new BadRequestException(`custom line ${l.code} requires a label`);
      return { label: l.label, unit: l.unit ?? 'pce', material: l.material ?? 0, labour: l.labour ?? 0, subcontract: l.subcontract ?? 0 };
    };
    return this.prisma.$transaction(async (tx) => {
      const reference = await this.nextReference(tx, tenantId, 'offer');
      const offer = await tx.offer.create({ data: {
        tenantId, reference, clientName: input.clientName, title: input.title,
        sellFactor: input.sellFactor ?? Number(tenant.sellFactor), vatRate: input.vatRate ?? Number(tenant.vatRate), discountPercent: input.discountPercent ?? 0,
        zones: { create: input.zones.map((z, zi) => ({ position: zi, label: z.label, cfcs: { create: z.cfcs.map((c, ci) => ({ position: ci, code: c.code, label: c.label, chapters: { create: c.chapters.map((ch, chi) => ({ position: chi, code: ch.code, label: ch.label, lines: { create: ch.lines.map((l, li) => { const r = resolve(l); return { position: li, kind: l.kind, code: l.code, label: r.label, unit: r.unit, quantity: l.quantity, material: r.material, labour: r.labour, subcontract: r.subcontract, factorOverride: l.factorOverride ?? null, excluded: l.excluded ?? false }; }) } })) } })) } })) },
      }, include: TREE });
      await tx.auditLog.create({ data: { tenantId, action: 'offer.created', entity: 'Offer', entityId: offer.id } });
      return offer;
    });
  }

  async get(tenantId: string, id: string): Promise<OfferWithTree> {
    const o = await this.prisma.offer.findFirst({ where: { id, tenantId }, include: TREE });
    if (!o) throw new NotFoundException('offer not found');
    return o;
  }

  list(tenantId: string) { return this.prisma.offer.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, select: { id: true, reference: true, clientName: true, title: true, status: true, version: true, createdAt: true } }); }

  async compute(tenantId: string, id: string) {
    const o = await this.get(tenantId, id);
    return { offer: { id: o.id, reference: o.reference, status: o.status, clientName: o.clientName, title: o.title }, totals: computeOffer(toEngineOffer(o)) };
  }

  /** Pipeline commercial : Préparation → Envoyée → Négociation → Adjugée / Perdue. */
  async setStatus(tenantId: string, id: string, status: 'PREPARATION' | 'ENVOYEE' | 'NEGOCIATION' | 'ADJUGEE' | 'PERDUE') {
    if (status === 'ADJUGEE') return this.award(tenantId, id);
    await this.get(tenantId, id);
    return this.prisma.offer.update({ where: { id }, data: { status } });
  }

  /** Adjudication : crée le projet, les lots et les tâches depuis la structure de l'offre — continuité numérique, zéro ressaisie. */
  async award(tenantId: string, id: string) {
    const o = await this.get(tenantId, id);
    if (o.status === 'ADJUGEE') throw new BadRequestException('offer already awarded');
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const lots = offerToWorkLots(toEngineOffer(o), tenant.hourlyRate);
    const lineById = new Map(o.zones.flatMap((z) => z.cfcs.flatMap((c) => c.chapters.flatMap((ch) => ch.lines))).map((l) => [l.id, l]));
    return this.prisma.$transaction(async (tx) => {
      await tx.offer.update({ where: { id }, data: { status: 'ADJUGEE' } });
      const project = await tx.project.create({ data: {
        tenantId, offerId: id, name: o.title, status: 'PLANIFIE',
        lots: { create: lots.map((l) => ({ zoneLabel: l.zoneLabel, chapterCode: l.chapterCode, chapterLabel: l.chapterLabel, budgetLabourCents: l.budgetLabourCents, budgetHours: l.budgetHours, budgetMaterialCents: l.budgetMaterialCents,
          tasks: { create: l.lineIds.map((lid) => { const ln = lineById.get(lid)!; return { lineId: lid, title: `${ln.code} — ${ln.label} (${Number(ln.quantity)} ${ln.unit})` }; }) } })) },
      }, include: { lots: { include: { tasks: true } } } });
      await tx.auditLog.create({ data: { tenantId, action: 'offer.awarded', entity: 'Offer', entityId: id } });
      return project;
    });
  }
}
