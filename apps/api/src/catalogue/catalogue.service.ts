import { Injectable, NotFoundException } from '@nestjs/common';
import { importCatalogue, composeCosts, type CatalogueMapping } from '@oxacan/engine';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogueService {
  constructor(private readonly prisma: PrismaService) {}

  /** Import CSV avec mapping : upsert par code, rapport d'erreurs ligne par ligne. Aucune ligne invalide n'est écrite. */
  async import(tenantId: string, csvText: string, mapping: CatalogueMapping) {
    const report = importCatalogue(csvText, mapping);
    if (report.rows.length) {
      await this.prisma.$transaction(report.rows.map((r) => this.prisma.catalogueItem.upsert({
        where: { tenantId_code: { tenantId, code: r.code } },
        create: { tenantId, code: r.code, label: r.label, unit: r.unit, chapter: r.chapter ?? null, material: r.material, labour: r.labour, subcontract: r.subcontract },
        update: { label: r.label, unit: r.unit, chapter: r.chapter ?? null, material: r.material, labour: r.labour, subcontract: r.subcontract, importedAt: new Date() },
      })));
    }
    return { imported: report.rows.length, skipped: report.skipped, errors: report.errors };
  }

  list(tenantId: string, q?: string, chapter?: string) {
    return this.prisma.catalogueItem.findMany({ where: { tenantId, ...(chapter ? { chapter } : {}), ...(q ? { OR: [{ code: { contains: q } }, { label: { contains: q, mode: 'insensitive' } }] } : {}) }, orderBy: { code: 'asc' }, take: 500 });
  }

  /** Article composé : composants = codes catalogue × quantité ; le coût est agrégé à la demande (toujours à jour). */
  async createComposed(tenantId: string, input: { code: string; label: string; unit: string; components: { catalogueCode: string; quantity: number }[] }) {
    const codes = input.components.map((c) => c.catalogueCode);
    const items = await this.prisma.catalogueItem.findMany({ where: { tenantId, code: { in: codes } } });
    const missing = codes.filter((c) => !items.some((i) => i.code === c));
    if (missing.length) throw new NotFoundException(`unknown catalogue codes: ${missing.join(', ')}`);
    return this.prisma.composedArticle.create({ data: { tenantId, code: input.code, label: input.label, unit: input.unit, components: { create: input.components.map((c) => ({ catalogueCode: c.catalogueCode, quantity: c.quantity })) } }, include: { components: true } });
  }

  async composedCost(tenantId: string, composedId: string) {
    const c = await this.prisma.composedArticle.findFirst({ where: { id: composedId, tenantId }, include: { components: true } });
    if (!c) throw new NotFoundException('composed article not found');
    const items = await this.prisma.catalogueItem.findMany({ where: { tenantId, code: { in: c.components.map((x) => x.catalogueCode) } } });
    const cost = composeCosts(c.components.map((x) => { const it = items.find((i) => i.code === x.catalogueCode)!; return { code: x.catalogueCode, quantity: Number(x.quantity), material: it.material, labour: it.labour, subcontract: it.subcontract }; }));
    return { id: c.id, code: c.code, label: c.label, unit: c.unit, cost };
  }
}
