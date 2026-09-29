import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { PlusValue } from './entities/plus-value.entity';
import { Payment } from '../accounting/entities/payment.entity';
import { JournalEntry } from '../accounting/entities/journal-entry.entity';
import { JournalEntryLine } from '../accounting/entities/journal-entry-line.entity';
import { ChartOfAccounts } from '../accounting/entities/chart-of-accounts.entity';
import { Company } from '../company/entities/company.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import { DEFAULT_VAT_RATE, DEFAULT_RETENTION_RATE } from '@oxacan/shared-types';

/* ─── helpers ─── */

function swissRound(cents: number): number {
  return Math.round(cents / 5) * 5;
}

/* ─── DTOs ─── */

interface InvoiceLineDto {
  description: string;
  unit?: string;
  quantity: number;
  unitPriceCents: number;
  cumulativeQuantity?: number;
  previousQuantity?: number;
}

interface CreateInvoiceDto {
  projectId: string;
  clientId: string;
  type: string;
  vatRate?: number;
  retentionRate?: number;
  lines: InvoiceLineDto[];
  notes?: string;
  paymentTerms?: string;
}

interface RecordPaymentDto {
  amountCents: number;
  paymentDate: string;
  paymentMethod: string;
  reference?: string;
}

interface InvoiceFilters {
  page?: number;
  limit?: number;
  projectId?: string;
  clientId?: string;
  status?: string;
  type?: string;
}

interface PlusValueFilters {
  page?: number;
  limit?: number;
  projectId?: string;
  status?: string;
}

interface CreatePlusValueDto {
  projectId: string;
  description: string;
  amountCents: number;
}

@Injectable()
export class InvoicingService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(InvoiceLine)
    private readonly lineRepo: Repository<InvoiceLine>,
    @InjectRepository(PlusValue)
    private readonly plusValueRepo: Repository<PlusValue>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    private readonly dataSource: DataSource,
  ) {}

  /* ═══════════════════════════════════════════════
     Invoices — List
     ═══════════════════════════════════════════════ */

  async findAll(companyId: string, filters: InvoiceFilters = {}) {
    const { page = 1, limit = 25, projectId, clientId, status, type } = filters;

    const qb = this.invoiceRepo
      .createQueryBuilder('invoice')
      .leftJoinAndSelect('invoice.project', 'project')
      .leftJoinAndSelect('invoice.client', 'client')
      .where('invoice.company_id = :companyId', { companyId });

    if (projectId) {
      qb.andWhere('invoice.project_id = :projectId', { projectId });
    }
    if (clientId) {
      qb.andWhere('invoice.client_id = :clientId', { clientId });
    }
    if (status) {
      qb.andWhere('invoice.status = :status', { status });
    }
    if (type) {
      qb.andWhere('invoice.type = :type', { type });
    }

    qb.orderBy('invoice.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /* ═══════════════════════════════════════════════
     Invoices — Find by ID
     ═══════════════════════════════════════════════ */

  async findById(companyId: string, id: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id, companyId },
      relations: ['lines', 'project', 'client', 'referenceInvoice'],
    });
    if (!invoice) throw new NotFoundError('Invoice', id);
    return invoice;
  }

  /* ═══════════════════════════════════════════════
     Invoices — Create
     ═══════════════════════════════════════════════ */

  async createInvoice(
    companyId: string,
    userId: string,
    dto: CreateInvoiceDto,
  ): Promise<Invoice> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      /* ── Resolve company defaults ── */
      const company = await this.companyRepo.findOne({ where: { id: companyId } });
      const vatRate = dto.vatRate ?? company?.defaultVatRate ?? DEFAULT_VAT_RATE;
      const retentionRate = dto.retentionRate ?? company?.defaultRetentionRate ?? DEFAULT_RETENTION_RATE;

      /* ── Gapless invoice number with advisory lock ── */
      const lockKey = Buffer.from(companyId.replace(/-/g, '').slice(0, 8), 'hex').readInt32BE(0);
      await queryRunner.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      const currentYear = new Date().getFullYear();
      const maxResult = await queryRunner.query(
        `SELECT MAX(invoice_number) as max_num FROM invoice
         WHERE company_id = $1 AND invoice_number LIKE $2`,
        [companyId, `${currentYear}-%`],
      );

      let nextSeq = 1;
      if (maxResult?.[0]?.max_num) {
        const parts = (maxResult[0].max_num as string).split('-');
        nextSeq = parseInt(parts[1], 10) + 1;
      }
      const invoiceNumber = `${currentYear}-${String(nextSeq).padStart(3, '0')}`;

      /* ── Build lines and compute totals ── */
      const isSituation = dto.type === 'situation';
      const lines: Partial<InvoiceLine>[] = [];
      let subtotalHtCents = 0;

      for (let i = 0; i < dto.lines.length; i++) {
        const l = dto.lines[i];
        let totalPriceCents: number;
        let periodQuantity: number | null = null;

        if (isSituation && l.cumulativeQuantity != null && l.previousQuantity != null) {
          periodQuantity = l.cumulativeQuantity - l.previousQuantity;
          totalPriceCents = Math.round(periodQuantity * l.unitPriceCents);
        } else {
          totalPriceCents = Math.round(l.quantity * l.unitPriceCents);
        }

        subtotalHtCents += totalPriceCents;

        lines.push({
          companyId,
          description: l.description,
          unit: l.unit || null,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          totalPriceCents,
          cumulativeQuantity: l.cumulativeQuantity ?? null,
          previousQuantity: l.previousQuantity ?? null,
          periodQuantity,
          sortOrder: i,
        });
      }

      /* ── Prior acomptes (for situation type) ── */
      let priorAcomptesCents = 0;
      if (dto.type === 'situation') {
        const priorResult = await queryRunner.query(
          `SELECT COALESCE(SUM(total_ttc_cents), 0) as total FROM invoice
           WHERE company_id = $1 AND project_id = $2 AND type = 'acompte'
           AND status != 'cancelled'`,
          [companyId, dto.projectId],
        );
        priorAcomptesCents = parseInt(priorResult?.[0]?.total || '0', 10);
      }

      /* ── VAT, retention, total ── */
      const vatAmountCents = swissRound(Math.round(subtotalHtCents * vatRate / 10000));
      const retentionAmountCents = swissRound(Math.round(subtotalHtCents * retentionRate / 10000));
      const totalTtcCents = swissRound(
        subtotalHtCents + vatAmountCents - retentionAmountCents - priorAcomptesCents,
      );

      /* ── Persist invoice ── */
      const invoiceEntity = queryRunner.manager.create(Invoice, {
        companyId,
        projectId: dto.projectId,
        clientId: dto.clientId,
        type: dto.type,
        invoiceNumber,
        status: 'draft',
        issueDate: new Date(),
        vatRate,
        subtotalHtCents,
        vatAmountCents,
        retentionAmountCents,
        priorAcomptesCents,
        totalTtcCents,
        amountPaidCents: 0,
        notes: dto.notes || null,
        paymentTerms: dto.paymentTerms || null,
        createdById: userId,
      });
      const savedInvoice = await queryRunner.manager.save(Invoice, invoiceEntity);

      /* ── Persist lines ── */
      for (const line of lines) {
        const lineEntity = queryRunner.manager.create(InvoiceLine, {
          ...line,
          invoiceId: savedInvoice.id,
        });
        await queryRunner.manager.save(InvoiceLine, lineEntity);
      }

      await queryRunner.commitTransaction();
      return this.findById(companyId, savedInvoice.id);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /* ═══════════════════════════════════════════════
     Invoices — Credit Note
     ═══════════════════════════════════════════════ */

  async createCreditNote(
    companyId: string,
    userId: string,
    invoiceId: string,
  ): Promise<Invoice> {
    const original = await this.findById(companyId, invoiceId);

    if (original.type === 'credit_note') {
      throw new BusinessRuleError(
        'CANNOT_CREDIT_CREDIT_NOTE',
        'Cannot create a credit note for a credit note.',
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      /* ── Gapless number ── */
      const lockKey = Buffer.from(companyId.replace(/-/g, '').slice(0, 8), 'hex').readInt32BE(0);
      await queryRunner.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      const currentYear = new Date().getFullYear();
      const maxResult = await queryRunner.query(
        `SELECT MAX(invoice_number) as max_num FROM invoice
         WHERE company_id = $1 AND invoice_number LIKE $2`,
        [companyId, `${currentYear}-%`],
      );

      let nextSeq = 1;
      if (maxResult?.[0]?.max_num) {
        const parts = (maxResult[0].max_num as string).split('-');
        nextSeq = parseInt(parts[1], 10) + 1;
      }
      const invoiceNumber = `${currentYear}-${String(nextSeq).padStart(3, '0')}`;

      /* ── Negate amounts ── */
      const creditNote = queryRunner.manager.create(Invoice, {
        companyId,
        projectId: original.projectId,
        clientId: original.clientId,
        type: 'credit_note',
        invoiceNumber,
        referenceInvoiceId: original.id,
        status: 'draft',
        issueDate: new Date(),
        vatRate: original.vatRate,
        subtotalHtCents: -original.subtotalHtCents,
        vatAmountCents: -original.vatAmountCents,
        retentionAmountCents: original.retentionAmountCents
          ? -original.retentionAmountCents
          : 0,
        priorAcomptesCents: original.priorAcomptesCents
          ? -original.priorAcomptesCents
          : 0,
        totalTtcCents: -original.totalTtcCents,
        amountPaidCents: 0,
        notes: `Credit note for invoice ${original.invoiceNumber}`,
        createdById: userId,
      });
      const saved = await queryRunner.manager.save(Invoice, creditNote);

      /* ── Negate lines ── */
      if (original.lines) {
        for (let i = 0; i < original.lines.length; i++) {
          const ol = original.lines[i];
          const line = queryRunner.manager.create(InvoiceLine, {
            invoiceId: saved.id,
            companyId,
            description: ol.description,
            unit: ol.unit,
            quantity: -ol.quantity,
            unitPriceCents: ol.unitPriceCents,
            totalPriceCents: -ol.totalPriceCents,
            cumulativeQuantity: ol.cumulativeQuantity,
            previousQuantity: ol.previousQuantity,
            periodQuantity: ol.periodQuantity != null ? -ol.periodQuantity : null,
            sortOrder: i,
          });
          await queryRunner.manager.save(InvoiceLine, line);
        }
      }

      await queryRunner.commitTransaction();
      return this.findById(companyId, saved.id);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /* ═══════════════════════════════════════════════
     Invoices — Update Status
     ═══════════════════════════════════════════════ */

  async updateStatus(
    companyId: string,
    id: string,
    status: string,
  ): Promise<Invoice> {
    const invoice = await this.findById(companyId, id);

    if (invoice.type === 'credit_note') {
      throw new BusinessRuleError(
        'CREDIT_NOTE_STATUS',
        'Cannot change the status of a credit note.',
      );
    }

    if (status === 'cancelled' && invoice.status !== 'draft') {
      throw new BusinessRuleError(
        'CANCEL_NON_DRAFT',
        'Only draft invoices can be cancelled. Sent invoices require a credit note.',
      );
    }

    invoice.status = status;

    if (status === 'sent' && !invoice.sentAt) {
      invoice.sentAt = new Date();
    }

    await this.invoiceRepo.save(invoice);
    return this.findById(companyId, id);
  }

  /* ═══════════════════════════════════════════════
     Invoices — Record Payment
     ═══════════════════════════════════════════════ */

  async recordPayment(
    companyId: string,
    userId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
  ): Promise<Payment> {
    const invoice = await this.findById(companyId, invoiceId);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      /* ── Create journal entry for payment ── */
      const bankAccount = await queryRunner.manager.findOne(ChartOfAccounts, {
        where: { companyId, accountNumber: '1020' },
      });
      const receivableAccount = await queryRunner.manager.findOne(ChartOfAccounts, {
        where: { companyId, accountNumber: '1100' },
      });

      let journalEntryId: string | null = null;

      if (bankAccount && receivableAccount) {
        /* gapless entry number */
        const maxEntry = await queryRunner.query(
          `SELECT MAX(entry_number) as max_num FROM journal_entry WHERE company_id = $1`,
          [companyId],
        );
        const nextEntryNum = (parseInt(maxEntry?.[0]?.max_num || '0', 10)) + 1;

        const entry = queryRunner.manager.create(JournalEntry, {
          companyId,
          entryNumber: nextEntryNum,
          entryDate: dto.paymentDate as any,
          description: `Payment for invoice ${invoice.invoiceNumber}`,
          referenceType: 'payment',
          referenceId: invoiceId,
          isPosted: false,
          createdById: userId,
        });
        const savedEntry = await queryRunner.manager.save(JournalEntry, entry);
        journalEntryId = savedEntry.id;

        /* debit bank, credit receivable */
        const debitLine = queryRunner.manager.create(JournalEntryLine, {
          journalEntryId: savedEntry.id,
          companyId,
          accountId: bankAccount.id,
          debitCents: dto.amountCents,
          creditCents: 0,
          description: `Payment received — ${invoice.invoiceNumber}`,
        });
        await queryRunner.manager.save(JournalEntryLine, debitLine);

        const creditLine = queryRunner.manager.create(JournalEntryLine, {
          journalEntryId: savedEntry.id,
          companyId,
          accountId: receivableAccount.id,
          debitCents: 0,
          creditCents: dto.amountCents,
          description: `Payment received — ${invoice.invoiceNumber}`,
        });
        await queryRunner.manager.save(JournalEntryLine, creditLine);
      }

      /* ── Create payment record ── */
      const payment = queryRunner.manager.create(Payment, {
        companyId,
        invoiceId,
        amountCents: dto.amountCents,
        paymentDate: dto.paymentDate as any,
        paymentMethod: dto.paymentMethod,
        reference: dto.reference || null,
        journalEntryId,
        createdById: userId,
      });
      const savedPayment = await queryRunner.manager.save(Payment, payment);

      /* ── Update invoice paid status ── */
      const newPaidAmount = (invoice.amountPaidCents || 0) + dto.amountCents;
      invoice.amountPaidCents = newPaidAmount;

      if (newPaidAmount >= invoice.totalTtcCents) {
        invoice.status = 'paid';
        invoice.paidAt = new Date();
      } else {
        invoice.status = 'partially_paid';
      }
      await queryRunner.manager.save(Invoice, invoice);

      await queryRunner.commitTransaction();
      return savedPayment;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /* ═══════════════════════════════════════════════
     Invoices — Project Summary
     ═══════════════════════════════════════════════ */

  async getProjectInvoiceSummary(companyId: string, projectId: string) {
    const result = await this.invoiceRepo
      .createQueryBuilder('invoice')
      .select('COALESCE(SUM(invoice.total_ttc_cents), 0)', 'totalInvoicedCents')
      .addSelect('COALESCE(SUM(invoice.amount_paid_cents), 0)', 'totalPaidCents')
      .addSelect(
        'COALESCE(SUM(invoice.retention_amount_cents), 0)',
        'retentionHeldCents',
      )
      .where('invoice.company_id = :companyId', { companyId })
      .andWhere('invoice.project_id = :projectId', { projectId })
      .andWhere("invoice.status != 'cancelled'")
      .getRawOne();

    const totalInvoicedCents = parseInt(result?.totalInvoicedCents || '0', 10);
    const totalPaidCents = parseInt(result?.totalPaidCents || '0', 10);
    const retentionHeldCents = parseInt(result?.retentionHeldCents || '0', 10);

    return {
      projectId,
      totalInvoicedCents,
      totalPaidCents,
      outstandingCents: totalInvoicedCents - totalPaidCents,
      retentionHeldCents,
    };
  }

  /* ═══════════════════════════════════════════════
     Plus-Values — List
     ═══════════════════════════════════════════════ */

  async findAllPlusValues(companyId: string, filters: PlusValueFilters = {}) {
    const { page = 1, limit = 25, projectId, status } = filters;

    const qb = this.plusValueRepo
      .createQueryBuilder('pv')
      .leftJoinAndSelect('pv.project', 'project')
      .where('pv.company_id = :companyId', { companyId });

    if (projectId) {
      qb.andWhere('pv.project_id = :projectId', { projectId });
    }
    if (status) {
      qb.andWhere('pv.status = :status', { status });
    }

    qb.orderBy('pv.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /* ═══════════════════════════════════════════════
     Plus-Values — Create
     ═══════════════════════════════════════════════ */

  async createPlusValue(
    companyId: string,
    userId: string,
    dto: CreatePlusValueDto,
  ): Promise<PlusValue> {
    const pv = this.plusValueRepo.create({
      companyId,
      projectId: dto.projectId,
      description: dto.description,
      amountCents: dto.amountCents,
      status: 'detected',
      approvedByClient: false,
      createdById: userId,
    });
    return this.plusValueRepo.save(pv);
  }

  /* ═══════════════════════════════════════════════
     Plus-Values — Update Status
     ═══════════════════════════════════════════════ */

  async updatePlusValueStatus(
    companyId: string,
    id: string,
    status: string,
    approvedByClient?: boolean,
  ): Promise<PlusValue> {
    const pv = await this.plusValueRepo.findOne({
      where: { id, companyId },
    });
    if (!pv) throw new NotFoundError('PlusValue', id);

    pv.status = status;

    if (approvedByClient !== undefined) {
      pv.approvedByClient = approvedByClient;
    }
    if (status === 'approved') {
      pv.approvedAt = new Date();
    }

    return this.plusValueRepo.save(pv);
  }
}
