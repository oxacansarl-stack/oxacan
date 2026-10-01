import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In, QueryRunner } from 'typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { PlusValue } from './entities/plus-value.entity';
import { Payment } from '../accounting/entities/payment.entity';
import { JournalEntry } from '../accounting/entities/journal-entry.entity';
import { JournalEntryLine } from '../accounting/entities/journal-entry-line.entity';
import { ChartOfAccounts } from '../accounting/entities/chart-of-accounts.entity';
import { Company } from '../company/entities/company.entity';
import { NotFoundError, BusinessRuleError, ValidationError } from '@oxacan/shared-types';
import { DEFAULT_VAT_RATE, DEFAULT_RETENTION_RATE } from '@oxacan/shared-types';
import { assertProjectExists } from '../../common/util/assert-project';
import { swissRound } from '../../common/util/money';
import { CreateInvoiceDto, CreatePlusValueDto, RecordPaymentDto } from './dto/invoice.dto';

/** One side of a journal entry: positive amounts are debits, negative amounts credits. */
interface PostingLine { account: string; amountCents: number; label: string }

/**
 * Writes a balanced journal entry (not posted) with the next gapless entry number. Returns null
 * and writes nothing when one of the accounts is missing from the company's chart, as before the
 * chart is seeded.
 */
async function postJournalEntry(
  manager: EntityManager,
  companyId: string,
  userId: string,
  entry: { date: string | Date; description: string; referenceType: string; referenceId: string; lines: PostingLine[] },
): Promise<string | null> {
  const lines = entry.lines.filter((l) => l.amountCents !== 0);
  if (!lines.length) return null;
  if (lines.reduce((sum, l) => sum + l.amountCents, 0) !== 0) {
    throw new Error(`Unbalanced journal entry for ${entry.referenceType} ${entry.referenceId}`);
  }
  const numbers = [...new Set(lines.map((l) => l.account))];
  const accounts = await manager.find(ChartOfAccounts, { where: { companyId, accountNumber: In(numbers) } });
  if (accounts.length !== numbers.length) return null;
  const idOf = new Map(accounts.map((a) => [a.accountNumber, a.id]));

  /* gapless entry number — same lock as manual journal entries */
  const journalLockKey = Buffer.from(companyId.replace(/-/g, '').slice(0, 8), 'hex').readInt32BE(0) + 1;
  await manager.query('SELECT pg_advisory_xact_lock($1)', [journalLockKey]);
  const [{ max_num }] = await manager.query(
    'SELECT MAX(entry_number) AS max_num FROM journal_entry WHERE company_id = $1',
    [companyId],
  );
  const saved = await manager.save(
    manager.create(JournalEntry, {
      companyId,
      entryNumber: parseInt(max_num || '0', 10) + 1,
      entryDate: entry.date as any,
      description: entry.description,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      isPosted: false,
      createdById: userId,
    }),
  );
  for (const l of lines) {
    await manager.save(
      manager.create(JournalEntryLine, {
        journalEntryId: saved.id,
        companyId,
        accountId: idOf.get(l.account)!,
        debitCents: Math.max(l.amountCents, 0),
        creditCents: Math.max(-l.amountCents, 0),
        description: l.label,
      }),
    );
  }
  return saved.id;
}

/**
 * Journal lines for issuing an invoice. Acomptes are advances (2030), not revenue. Other invoices
 * debit the client for what is due now plus the retention held back, release the acomptes they
 * deduct, owe the VAT, and book the remainder (HT net of 5-centime rounding) as revenue.
 * A credit note carries negated amounts, so the same lines reverse the original.
 */
function issuanceLines(inv: Invoice): PostingLine[] {
  const label = `Invoice ${inv.invoiceNumber}`;
  const ttc = Number(inv.totalTtcCents);
  if (inv.type === 'acompte') {
    return [
      { account: '1100', amountCents: ttc, label },
      { account: '2030', amountCents: -ttc, label },
    ];
  }
  const retention = Number(inv.retentionAmountCents || 0);
  const prior = Number(inv.priorAcomptesCents || 0);
  const vat = Number(inv.vatAmountCents);
  return [
    { account: '1100', amountCents: ttc + retention, label },
    { account: '2030', amountCents: prior, label: `${label} — acomptes deducted` },
    { account: '2200', amountCents: -vat, label: `${label} — VAT` },
    { account: '3000', amountCents: -(ttc + retention + prior - vat), label },
  ];
}

/** Puts the plus-values billed by a cancelled or credited invoice back to 'approved'. */
async function releasePlusValues(db: { query: DataSource['query'] }, companyId: string, invoiceId: string) {
  await db.query(
    `UPDATE plus_value SET status = 'approved', invoice_id = NULL, updated_at = now()
      WHERE company_id = $1 AND invoice_id = $2`,
    [companyId, invoiceId],
  );
}

/* ─── DTOs ─── */

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

const INVOICE_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['overdue'],
  partially_paid: ['overdue'],
  overdue: [],
  paid: [],
  cancelled: [],
};
const PAYABLE_STATUSES = ['sent', 'partially_paid', 'overdue'];
/** 'invoiced' is set only by billing the plus-value on an invoice (and undone by cancel / credit note). */
const PLUS_VALUE_TRANSITIONS: Record<string, string[]> = {
  detected: ['submitted', 'approved', 'rejected'],
  submitted: ['approved', 'rejected', 'detected'],
  approved: ['rejected'],
  rejected: ['detected'],
  invoiced: [],
};

/** Next gapless number YYYY-NNN for the current year; caller must hold the company's invoice lock. */
async function nextInvoiceNumber(queryRunner: QueryRunner, companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const [{ max }] = await queryRunner.query(
    `SELECT MAX(substring(invoice_number from '[0-9]+$')::int) AS max
     FROM invoice WHERE company_id = $1 AND invoice_number LIKE $2`,
    [companyId, `${year}-%`],
  );
  return `${year}-${String((max ?? 0) + 1).padStart(3, '0')}`;
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
    const payments = await this.dataSource.getRepository(Payment).find({
      where: { invoiceId: id, companyId },
      order: { paymentDate: 'ASC' },
    });
    return Object.assign(invoice, { payments });
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

      const invoiceNumber = await nextInvoiceNumber(queryRunner, companyId);

      /* ── Plus-values billed on this invoice: approved, this project, not yet invoiced ── */
      const plusValueIds = [...new Set(dto.plusValueIds ?? [])];
      const plusValues: { id: string; description: string; amount_cents: string }[] = plusValueIds.length
        ? await queryRunner.query(
            `SELECT id, description, amount_cents FROM plus_value
              WHERE company_id = $1 AND project_id = $2 AND id = ANY($3::uuid[])
                AND status = 'approved' AND invoice_id IS NULL
              ORDER BY created_at FOR UPDATE`,
            [companyId, dto.projectId, plusValueIds],
          )
        : [];
      if (plusValues.length !== plusValueIds.length) {
        throw new BusinessRuleError(
          'PLUS_VALUE_NOT_INVOICEABLE',
          'Only approved plus-values of this project that are not invoiced yet can be billed.',
        );
      }
      if (dto.lines.length + plusValues.length === 0) {
        throw new ValidationError('An invoice needs at least one line.');
      }

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
          if (periodQuantity < 0) {
            throw new ValidationError(
              `Line ${i + 1}: cumulative quantity is lower than the previously invoiced quantity.`,
            );
          }
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

      for (const pv of plusValues) {
        const amount = Number(pv.amount_cents);
        subtotalHtCents += amount;
        lines.push({
          companyId,
          description: `Plus-value : ${pv.description}`,
          unit: 'forfait',
          quantity: 1,
          unitPriceCents: amount,
          totalPriceCents: amount,
          cumulativeQuantity: null,
          previousQuantity: null,
          periodQuantity: null,
          sortOrder: lines.length,
        });
      }

      /* ── Prior acomptes (for situation type) ── */
      // Each acompte is deducted once: issued acomptes that were not credited, minus what earlier
      // situations of the project already deducted. A draft situation reserves its deduction
      // (cancelling it releases it), so two situations drafted in a row can't both take it.
      let priorAcomptesCents = 0;
      if (dto.type === 'situation') {
        const [{ remaining }] = await queryRunner.query(
          `WITH uncredited AS (
             SELECT i.* FROM invoice i
              WHERE i.company_id = $1 AND i.project_id = $2 AND i.status <> 'cancelled'
                AND NOT EXISTS (SELECT 1 FROM invoice cn
                                 WHERE cn.company_id = i.company_id AND cn.reference_invoice_id = i.id
                                   AND cn.type = 'credit_note' AND cn.status <> 'cancelled'))
           SELECT GREATEST(
             COALESCE((SELECT SUM(total_ttc_cents) FROM uncredited WHERE type = 'acompte' AND status <> 'draft'), 0)
             - COALESCE((SELECT SUM(prior_acomptes_cents) FROM uncredited WHERE type = 'situation'), 0),
             0)::bigint AS remaining`,
          [companyId, dto.projectId],
        );
        priorAcomptesCents = Number(remaining);
      }

      /* ── VAT, retention, total ── */
      // Retention guarantees executed work, so an advance payment request carries none.
      const appliedRetentionRate = dto.type === 'acompte' ? 0 : retentionRate;
      const vatAmountCents = swissRound(Math.round(subtotalHtCents * vatRate / 10000));
      const retentionAmountCents = swissRound(Math.round(subtotalHtCents * appliedRetentionRate / 10000));
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

      if (plusValues.length) {
        await queryRunner.query(
          `UPDATE plus_value SET status = 'invoiced', invoice_id = $3, updated_at = now()
            WHERE company_id = $1 AND id = ANY($2::uuid[])`,
          [companyId, plusValues.map((pv) => pv.id), savedInvoice.id],
        );
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
    if (original.status === 'draft' || original.status === 'cancelled') {
      throw new BusinessRuleError(
        'CREDIT_NOTE_NOT_ISSUED',
        'Only issued invoices can be credited. Cancel a draft invoice instead.',
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      /* ── Gapless number ── */
      const lockKey = Buffer.from(companyId.replace(/-/g, '').slice(0, 8), 'hex').readInt32BE(0);
      await queryRunner.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      const invoiceNumber = await nextInvoiceNumber(queryRunner, companyId);

      const [existingCredit] = await queryRunner.query(
        `SELECT invoice_number FROM invoice
         WHERE company_id = $1 AND reference_invoice_id = $2 AND type = 'credit_note'`,
        [companyId, original.id],
      );
      if (existingCredit) {
        throw new BusinessRuleError(
          'CREDIT_NOTE_EXISTS',
          `Invoice ${original.invoiceNumber} was already credited by ${existingCredit.invoice_number}.`,
        );
      }

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

      // A credited invoice no longer bills its plus-values; they can go on a new invoice.
      await releasePlusValues(queryRunner.manager, companyId, original.id);
      await postJournalEntry(queryRunner.manager, companyId, userId, {
        date: saved.issueDate,
        description: `Credit note ${saved.invoiceNumber} for invoice ${original.invoiceNumber}`,
        referenceType: 'invoice',
        referenceId: saved.id,
        lines: issuanceLines(saved),
      });

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
    userId: string,
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
    if (!(INVOICE_TRANSITIONS[invoice.status] ?? []).includes(status)) {
      throw new BusinessRuleError(
        'INVALID_STATUS_TRANSITION',
        `Cannot move an invoice from '${invoice.status}' to '${status}'.`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      // Guarded on the old status so two concurrent requests can't both issue (and journal) it.
      const [, affected] = await manager.query(
        `UPDATE invoice SET status = $3, sent_at = CASE WHEN $3 = 'sent' THEN COALESCE(sent_at, now()) ELSE sent_at END,
                updated_at = now()
          WHERE id = $1 AND company_id = $2 AND status = $4`,
        [id, companyId, status, invoice.status],
      );
      if (!affected) {
        throw new BusinessRuleError('STATUS_CHANGED', 'The invoice status was changed by someone else. Reload and retry.');
      }
      if (status === 'cancelled') await releasePlusValues(manager, companyId, id);
      if (invoice.status === 'draft' && status === 'sent') {
        await postJournalEntry(manager, companyId, userId, {
          date: invoice.issueDate,
          description: `Invoice ${invoice.invoiceNumber}`,
          referenceType: 'invoice',
          referenceId: id,
          lines: issuanceLines(invoice),
        });
      }
    });
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
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Row lock so concurrent payments can't overwrite each other's amountPaidCents.
      const invoice = await queryRunner.manager.findOne(Invoice, {
        where: { id: invoiceId, companyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!invoice) throw new NotFoundError('Invoice', invoiceId);
      if (invoice.type === 'credit_note' || !PAYABLE_STATUSES.includes(invoice.status)) {
        throw new BusinessRuleError(
          'INVOICE_NOT_PAYABLE',
          `Payments can only be recorded on sent invoices (this one is '${invoice.status}').`,
        );
      }
      const outstanding = invoice.totalTtcCents - (invoice.amountPaidCents || 0);
      if (dto.amountCents > outstanding) {
        throw new BusinessRuleError(
          'OVERPAYMENT',
          `Payment exceeds the outstanding amount of ${(outstanding / 100).toFixed(2)} CHF.`,
        );
      }

      /* ── Journal: debit bank, credit receivable ── */
      const journalEntryId = await postJournalEntry(queryRunner.manager, companyId, userId, {
        date: dto.paymentDate,
        description: `Payment for invoice ${invoice.invoiceNumber}`,
        referenceType: 'payment',
        referenceId: invoiceId,
        lines: [
          { account: '1020', amountCents: dto.amountCents, label: `Payment received — ${invoice.invoiceNumber}` },
          { account: '1100', amountCents: -dto.amountCents, label: `Payment received — ${invoice.invoiceNumber}` },
        ],
      });

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
    await assertProjectExists(this.invoiceRepo.manager, companyId, projectId);
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

    const [pv] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0)::bigint AS "approved",
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'invoiced'), 0)::bigint AS "invoiced"
         FROM plus_value WHERE company_id = $1 AND project_id = $2`,
      [companyId, projectId],
    );

    return {
      projectId,
      totalInvoicedCents,
      totalPaidCents,
      outstandingCents: totalInvoicedCents - totalPaidCents,
      retentionHeldCents,
      plusValues: {
        approvedToInvoiceCents: Number(pv.approved),
        invoicedCents: Number(pv.invoiced),
      },
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

    if (pv.status !== status && !(PLUS_VALUE_TRANSITIONS[pv.status] ?? []).includes(status)) {
      throw new BusinessRuleError(
        'INVALID_STATUS_TRANSITION',
        `Cannot move a plus-value from '${pv.status}' to '${status}'.`,
      );
    }
    if (approvedByClient !== undefined) {
      pv.approvedByClient = approvedByClient;
    }
    // PRD §15.3: extra work is approved by the client before it is executed and billed.
    if (status === 'approved' && !pv.approvedByClient) {
      throw new BusinessRuleError('PLUS_VALUE_CLIENT_APPROVAL', 'A plus-value needs the client\'s approval first.');
    }
    if (status === 'approved' && pv.status !== 'approved') {
      pv.approvedAt = new Date();
    }
    pv.status = status;

    return this.plusValueRepo.save(pv);
  }
}
