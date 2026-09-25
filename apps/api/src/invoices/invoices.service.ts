import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatDocumentNumber, applyPercent, roundToFiveCents, findGaps } from '@oxacan/engine';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  private async next(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], tenantId: string, kind: 'invoice' | 'credit_note') {
    const year = new Date().getFullYear();
    const seq = await tx.documentSequence.upsert({ where: { tenantId_kind_year: { tenantId, kind, year } }, create: { tenantId, kind, year, last: 1 }, update: { last: { increment: 1 } } });
    return formatDocumentNumber(kind, year, seq.last);
  }

  list(tenantId: string) { return this.prisma.invoice.findMany({ where: { tenantId }, orderBy: { issuedAt: 'desc' } }); }

  /** Facture depuis une situation : montants figés à l'émission. */
  async fromSituation(tenantId: string, situationId: string, dueDays = 30) {
    const s = await this.prisma.situation.findFirst({ where: { id: situationId, project: { tenantId } }, include: { invoice: true } });
    if (!s) throw new NotFoundException('situation not found');
    if (s.invoice) throw new BadRequestException('situation already invoiced');
    return this.prisma.$transaction(async (tx) => {
      const number = await this.next(tx, tenantId, 'invoice');
      return tx.invoice.create({ data: { tenantId, number, kind: 'SITUATION', situationId, totalExclVat: s.netExclVat, vatAmount: s.vatAmount, totalInclVat: s.netInclVat, status: 'ENVOYEE', dueAt: new Date(Date.now() + dueDays * 86400000) } });
    });
  }

  /** Acompte ou facture one-shot. */
  async create(tenantId: string, input: { kind: 'ACOMPTE' | 'ONE_SHOT' | 'FINALE'; totalExclVat: number; vatRate: number; dueDays?: number }) {
    const vatAmount = applyPercent(input.totalExclVat, input.vatRate);
    return this.prisma.$transaction(async (tx) => {
      const number = await this.next(tx, tenantId, 'invoice');
      return tx.invoice.create({ data: { tenantId, number, kind: input.kind, totalExclVat: input.totalExclVat, vatAmount, totalInclVat: roundToFiveCents(input.totalExclVat + vatAmount), status: 'ENVOYEE', dueAt: new Date(Date.now() + (input.dueDays ?? 30) * 86400000) } });
    });
  }

  /** Q20 : une facture émise ne se modifie pas — elle se corrige par un avoir qui la référence. */
  async creditNote(tenantId: string, invoiceId: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!inv) throw new NotFoundException('invoice not found');
    if (inv.kind === 'AVOIR') throw new BadRequestException('cannot credit a credit note');
    return this.prisma.$transaction(async (tx) => {
      const number = await this.next(tx, tenantId, 'credit_note');
      const cn = await tx.invoice.create({ data: { tenantId, number, kind: 'AVOIR', correctsId: inv.id, totalExclVat: -inv.totalExclVat, vatAmount: -inv.vatAmount, totalInclVat: -inv.totalInclVat, status: 'ENVOYEE' } });
      await tx.invoice.update({ where: { id: inv.id }, data: { status: 'ANNULEE' } });
      return cn;
    });
  }

  async markPaid(tenantId: string, invoiceId: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!inv) throw new NotFoundException('invoice not found');
    return this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'ENCAISSEE' } });
  }

  /** Portefeuille : Encaissé / En attente / Échu + contrôle de continuité de numérotation. */
  async portfolio(tenantId: string) {
    const all = await this.prisma.invoice.findMany({ where: { tenantId, kind: { not: 'AVOIR' } } });
    const now = Date.now();
    const sum = (f: (i: (typeof all)[number]) => boolean) => all.filter(f).reduce((s, i) => s + i.totalInclVat, 0);
    const year = new Date().getFullYear();
    const seqs = all.filter((i) => i.number.startsWith(`F-${year}-`)).map((i) => Number(i.number.split('-')[2]));
    return { encaisse: sum((i) => i.status === 'ENCAISSEE'), enAttente: sum((i) => i.status === 'ENVOYEE' && (!i.dueAt || i.dueAt.getTime() >= now)), echu: sum((i) => i.status === 'ENVOYEE' && !!i.dueAt && i.dueAt.getTime() < now), enPreparation: sum((i) => i.status === 'EN_PREPARATION'), numberingGaps: findGaps(seqs) };
  }
}
