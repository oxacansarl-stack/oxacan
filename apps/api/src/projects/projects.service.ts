import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { computeSituation } from '@oxacan/engine';
import { PrismaService } from '../prisma/prisma.service';
import { toEngineOffer } from '../offers/offers.mapper';

const OFFER_TREE = { zones: { include: { cfcs: { include: { chapters: { include: { lines: true } } } } } } } as const;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) { return this.prisma.project.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, include: { offer: { select: { reference: true, clientName: true } }, _count: { select: { lots: true, situations: true } } } }); }

  async get(tenantId: string, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, tenantId }, include: { offer: { select: { reference: true, clientName: true, sellFactor: true, vatRate: true } }, lots: { include: { tasks: { include: { line: { select: { position: true, quantity: true, executed: true, unit: true } } }, orderBy: { line: { position: 'asc' } } } } }, situations: { orderBy: { number: 'asc' } } } });
    if (!p) throw new NotFoundException('project not found');
    return p;
  }

  /** Tableau de bord chantier : budget vs heures timbrées (heures saisies sur les tâches), marge estimée. */
  async dashboard(tenantId: string, id: string) {
    const p = await this.get(tenantId, id);
    const budgetHours = p.lots.reduce((s, l) => s + Number(l.budgetHours), 0);
    const hoursDone = p.lots.reduce((s, l) => s + l.tasks.reduce((t, x) => t + Number(x.hoursDone), 0), 0);
    const tasks = p.lots.flatMap((l) => l.tasks);
    const done = tasks.filter((t) => t.status === 'TERMINE').length;
    return { projectId: p.id, name: p.name, status: p.status, budgetHours, hoursDone, hoursDriftPercent: budgetHours ? Math.round(((hoursDone - budgetHours) / budgetHours) * 10000) / 100 : 0, tasksTotal: tasks.length, tasksDone: done, progressPercent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
  }

  async updateTask(tenantId: string, taskId: string, patch: { status?: 'A_FAIRE' | 'EN_COURS' | 'TERMINE'; hoursDone?: number }) {
    const t = await this.prisma.task.findFirst({ where: { id: taskId, lot: { project: { tenantId } } } });
    if (!t) throw new NotFoundException('task not found');
    return this.prisma.task.update({ where: { id: taskId }, data: patch });
  }

  /** Saisie des quantités exécutées (base des situations, Q28). Cumulatives. */
  async setExecuted(tenantId: string, projectId: string, executed: { lineId: string; executedQuantity: number }[]) {
    const p = await this.get(tenantId, projectId);
    const lineIds = new Set(p.lots.flatMap((l) => l.tasks.map((t) => t.lineId)));
    for (const e of executed) if (!lineIds.has(e.lineId)) throw new BadRequestException(`line ${e.lineId} is not part of this project`);
    await this.prisma.$transaction(executed.map((e) => this.prisma.offerLine.update({ where: { id: e.lineId }, data: { executed: e.executedQuantity } })));
    return { updated: executed.length };
  }

  /** Crée la situation N à partir des quantités exécutées ; déduit situations précédentes, retenue et acomptes. */
  async createSituation(tenantId: string, projectId: string, input: { retentionPercent: number }) {
    const p = await this.get(tenantId, projectId);
    const offer = await this.prisma.offer.findUniqueOrThrow({ where: { id: p.offerId }, include: OFFER_TREE });
    const previous = p.situations;
    const prevClaimed = previous.reduce((s, x) => s + x.periodExclVat, 0);
    const prevRetained = previous.reduce((s, x) => s + x.retentionThisPeriod, 0);
    const deposits = await this.prisma.invoice.aggregate({ where: { tenantId, kind: 'ACOMPTE', status: { not: 'ANNULEE' } }, _sum: { totalExclVat: true } });
    const alreadyDeducted = previous.reduce((s, x) => s + x.depositsDeducted, 0);
    const executed = offer.zones.flatMap((z) => z.cfcs.flatMap((c) => c.chapters.flatMap((ch) => ch.lines.map((l) => ({ lineId: l.id, executedQuantity: Number(l.executed) })))));
    const totals = computeSituation(toEngineOffer(offer), { number: previous.length + 1, executed, previouslyClaimedExclVat: prevClaimed, depositsInvoicedExclVat: Math.max((deposits._sum.totalExclVat ?? 0) - alreadyDeducted, 0), retentionPercent: input.retentionPercent, previouslyRetained: prevRetained, vatRatePercent: Number(offer.vatRate) });
    if (totals.periodExclVat === 0) throw new BadRequestException('aucune quantité exécutée nouvelle depuis la dernière situation — rien à facturer');
    return this.prisma.situation.create({ data: { projectId, number: totals.number, cumulativeExclVat: totals.cumulativeExclVat, periodExclVat: totals.periodExclVat, retentionThisPeriod: totals.retentionThisPeriod, depositsDeducted: totals.depositsDeducted, netExclVat: totals.netExclVat, vatAmount: totals.vatAmount, netInclVat: totals.netInclVat, snapshot: totals as object } });
  }
}
