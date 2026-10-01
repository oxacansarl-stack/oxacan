import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
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
import { sellingUnitCents } from '../offers/offer-pricing';
import { CreateInvoiceDto, CreatePlusValueDto, RecordPaymentDto } from './dto/invoice.dto';
import {
  invoiceNumberFormat,
  lockInvoiceNumbering,
  lockJournal,
  nextInvoiceNumber,
  parseInvoiceNumberFormat,
} from './invoice-number';
import {
  billedSoFar,
  heldRetentionCents,
  liveFinalInvoice,
  pendingDraftNumbers,
  UNCREDITED_INVOICES_SQL,
} from './final-invoice';
import { acompteScheduleItem } from '../contracts/acompte-schedule';
import { situationLineCumulativeQuantity } from '../projects/executed-quantities';

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

  /* gapless entry number — same lock as manual journal entries (AccountingService.createEntry) */
  await lockJournal(manager, companyId);
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
 *
 * The final invoice (décompte final) releases the retention held on the project: its
 * retentionAmountCents is the negated retention released, so its total includes it. It debits
 * the client for its total and credits 1100 for the released retention (the receivable the
 * situations debited is now billed to the client), so the net 1100 movement is the same formula
 * as above, shown as two lines. The credit note of a final invoice (pass releasesRetention) puts
 * the retention receivable back.
 */
function issuanceLines(inv: Invoice, releasesRetention = inv.type === 'final_invoice'): PostingLine[] {
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
  if (releasesRetention) {
    return [
      { account: '1100', amountCents: ttc, label },
      {
        account: '1100',
        amountCents: retention,
        label: `${label} — ${inv.type === 'credit_note' ? 'retention release reversed' : 'retention released'}`,
      },
      { account: '2030', amountCents: prior, label: `${label} — acomptes deducted` },
      { account: '2200', amountCents: -vat, label: `${label} — VAT` },
      { account: '3000', amountCents: -(ttc + retention + prior - vat), label },
    ];
  }
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

/* ─── Situations (PRD §15.2) ─── */

/** Offer variants that are priced work a situation may bill (not exclusions or open points). */
const SITUATION_VARIANTS = ['BASE', 'VARIANTE', 'OPTION'];

/** Quantities are REAL columns: subtract and compare at a precision they actually hold. */
const roundQuantity = (q: number): number => Math.round(q * 1e6) / 1e6;

/** A position of the project's contracted offer, as a situation bills it. */
export interface SituationPosition {
  offerLineId: string;
  positionNumber: number;
  description: string;
  unit: string;
  variantType: string;
  /** Quantity in the offer: the budget the executed quantity is compared with. */
  offerQuantity: number;
  /** Selling unit price (offer cost × margin factor); null while the position is unpriced. */
  unitPriceCents: number | null;
  /** What earlier non-cancelled, non-credited situations of the project billed for it. */
  previousQuantity: number;
}

/**
 * Positions of the project's contracted offer (project → contract → offer), each with the
 * quantity earlier situations already billed for it. Draft situations count, like their acompte
 * deduction: cancelling a draft (or crediting an issued situation) gives its quantities back.
 * `executedQuantity` is the position's validated cumulative from the executed-quantity ledger
 * (ExecutedQuantitiesService: recorded on site, validated by the project manager); null while
 * nothing is validated for it. A situation line without a cumulative quantity defaults to it
 * (situationLineCumulativeQuantity in projects/executed-quantities.ts).
 */
async function situationPositions(
  db: { query: DataSource['query'] },
  companyId: string,
  projectId: string,
  offerLineIds?: string[],
): Promise<(SituationPosition & { executedQuantity: number | null })[]> {
  const rows: {
    id: string; position_number: number; description: string; unit: string; variant_type: string;
    quantity: string; unit_price_cents: number | null; margin_factor: number | null; previous: string;
    executed: string | null;
  }[] = await db.query(
    `SELECT ol.id, ol.position_number, ol.description, ol.unit, ol.variant_type,
            ol.quantity::numeric AS quantity, ol.unit_price_cents, o.margin_factor,
            COALESCE((
              SELECT SUM(il.period_quantity::numeric)
                FROM invoice_line il
                JOIN invoice i ON i.company_id = il.company_id AND i.id = il.invoice_id
               WHERE il.company_id = p.company_id AND il.offer_line_id = ol.id
                 AND i.project_id = p.id AND i.type IN ('situation', 'final_invoice') AND i.status <> 'cancelled'
                 AND NOT EXISTS (SELECT 1 FROM invoice cn
                                  WHERE cn.company_id = i.company_id AND cn.reference_invoice_id = i.id
                                    AND cn.type = 'credit_note' AND cn.status <> 'cancelled')
            ), 0) AS previous,
            (SELECT SUM(eq.quantity_delta)
               FROM executed_quantity eq
              WHERE eq.company_id = p.company_id AND eq.project_id = p.id AND eq.offer_line_id = ol.id
                AND eq.validated_at IS NOT NULL) AS executed
       FROM project p
       JOIN contract c ON c.company_id = p.company_id AND c.id = p.contract_id
       JOIN offer o ON o.company_id = c.company_id AND o.id = c.offer_id
       JOIN offer_line ol ON ol.company_id = o.company_id AND ol.offer_id = o.id
      WHERE p.company_id = $1 AND p.id = $2 AND ol.variant_type = ANY($3::text[])
        AND ($4::uuid[] IS NULL OR ol.id = ANY($4::uuid[]))
      ORDER BY ol.sort_order, ol.position_number`,
    [companyId, projectId, SITUATION_VARIANTS, offerLineIds ?? null],
  );
  return rows.map((r) => ({
    offerLineId: r.id,
    positionNumber: r.position_number,
    description: r.description,
    unit: r.unit,
    variantType: r.variant_type,
    offerQuantity: Number(r.quantity),
    unitPriceCents: r.unit_price_cents == null ? null : sellingUnitCents(Number(r.unit_price_cents), Number(r.margin_factor ?? 100)),
    previousQuantity: roundQuantity(Number(r.previous)),
    executedQuantity: r.executed == null ? null : roundQuantity(Number(r.executed)),
  }));
}

/** Next per-project situation number; a cancelled draft gives its number back. */
async function nextSituationNumber(db: { query: DataSource['query'] }, companyId: string, projectId: string): Promise<number> {
  const [{ next }] = await db.query(
    `SELECT COALESCE(MAX(situation_number), 0) + 1 AS next FROM invoice
      WHERE company_id = $1 AND project_id = $2 AND type = 'situation' AND status <> 'cancelled'`,
    [companyId, projectId],
  );
  return Number(next);
}

/**
 * Acomptes a new situation (or the final invoice) of the project deducts. Each acompte is deducted
 * once: issued acomptes that were not credited, minus what earlier situations and the final
 * invoice of the project already deducted. A draft situation reserves its deduction (cancelling
 * it releases it), so two situations drafted in a row can't both take it.
 */
async function remainingAcomptesCents(db: { query: DataSource['query'] }, companyId: string, projectId: string): Promise<number> {
  const [{ remaining }] = await db.query(
    `WITH uncredited AS (${UNCREDITED_INVOICES_SQL})
     SELECT GREATEST(
       COALESCE((SELECT SUM(total_ttc_cents) FROM uncredited WHERE type = 'acompte' AND status <> 'draft'), 0)
       - COALESCE((SELECT SUM(prior_acomptes_cents) FROM uncredited WHERE type IN ('situation', 'final_invoice')), 0),
       0)::bigint AS remaining`,
    [companyId, projectId],
  );
  return Number(remaining);
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

/* Gapless invoice numbers in the company's format: see nextInvoiceNumber in ./invoice-number. */

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
      const isFinal = dto.type === 'final_invoice';

      /* ── Gapless invoice number with advisory lock ── */
      await lockInvoiceNumbering(queryRunner, companyId);

      const invoiceNumber = await nextInvoiceNumber(queryRunner, companyId);

      /* ── The project's contract: retention rate (PRD §15.4 "configurable par contrat"), réception finale ── */
      // FOR SHARE on the final invoice: the acceptance can't be changed until it commits.
      const [contract]: { retention_rate: number; final_acceptance_date: string | null }[] = await queryRunner.query(
        `SELECT c.retention_rate, to_char(c.final_acceptance_date, 'YYYY-MM-DD') AS final_acceptance_date
           FROM project p JOIN contract c ON c.company_id = p.company_id AND c.id = p.contract_id
          WHERE p.company_id = $1 AND p.id = $2 ${isFinal ? 'FOR SHARE OF c' : ''}`,
        [companyId, dto.projectId],
      );
      const retentionRate =
        dto.retentionRate ?? contract?.retention_rate ?? company?.defaultRetentionRate ?? DEFAULT_RETENTION_RATE;

      /* ── Final invoice (décompte final, PRD §15.1 / §15.4) ── */
      // Read under the invoice lock, like everything below, so two can't be created concurrently.
      const finalInvoice = await liveFinalInvoice(queryRunner, companyId, dto.projectId);
      if (finalInvoice && (isFinal || dto.type === 'situation' || dto.type === 'acompte')) {
        throw new BusinessRuleError(
          isFinal ? 'FINAL_INVOICE_EXISTS' : 'FINAL_INVOICE_ISSUED',
          `The project's final invoice is ${finalInvoice.invoiceNumber}` +
            (isFinal ? '.' : `; no ${dto.type === 'situation' ? 'situation' : 'acompte'} can follow it (credit it first).`),
        );
      }
      let retentionReleasedCents = 0;
      if (isFinal) {
        if (!contract?.final_acceptance_date) {
          throw new BusinessRuleError(
            'FINAL_ACCEPTANCE_REQUIRED',
            'Record the final acceptance of the works (réception finale) on the contract before its final invoice.',
          );
        }
        const drafts = await pendingDraftNumbers(queryRunner, companyId, dto.projectId);
        if (drafts.length) {
          throw new BusinessRuleError(
            'FINAL_INVOICE_DRAFTS_PENDING',
            `Issue or cancel the project's draft invoices first: ${drafts.join(', ')}.`,
          );
        }
        retentionReleasedCents = await heldRetentionCents(queryRunner, companyId, dto.projectId);
      }

      /* ── Planned acompte (PRD §15.6): the schedule item this acompte bills ── */
      if (dto.acompteScheduleItemId) {
        if (dto.type !== 'acompte') {
          throw new ValidationError('Only an acompte can bill a planned acompte (acompteScheduleItemId).');
        }
        // FOR SHARE: the item can't be changed or removed until this invoice commits.
        const [locked] = await queryRunner.query(
          `SELECT s.id FROM acompte_schedule_item s
             JOIN project p ON p.company_id = s.company_id AND p.contract_id = s.contract_id
            WHERE s.company_id = $1 AND s.id = $2 AND p.id = $3 FOR SHARE OF s`,
          [companyId, dto.acompteScheduleItemId, dto.projectId],
        );
        const item = locked ? await acompteScheduleItem(queryRunner, companyId, dto.acompteScheduleItemId) : null;
        if (!item) {
          throw new BusinessRuleError(
            'ACOMPTE_SCHEDULE_ITEM_NOT_IN_PROJECT',
            "The planned acompte isn't on the contract of this project.",
          );
        }
        if (item.invoiceId) {
          throw new BusinessRuleError(
            'ACOMPTE_SCHEDULE_ITEM_INVOICED',
            `This planned acompte is already billed by invoice ${item.invoiceNumber}.`,
          );
        }
        // Without lines of its own, the acompte bills the planned amount.
        if (!dto.lines.length && !(dto.plusValueIds ?? []).length) {
          dto = {
            ...dto,
            lines: [{
              description: item.label ? `Acompte : ${item.label}` : `Acompte selon échéancier du ${item.dueDate}`,
              unit: 'forfait',
              quantity: 1,
              unitPriceCents: item.amountHtCents,
            }],
          };
        }
      }

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
      // The final invoice may have no line: it can just release the retention and settle.
      if (dto.lines.length + plusValues.length === 0 && !isFinal) {
        throw new ValidationError('An invoice needs at least one line.');
      }

      /* ── Situation positions: what earlier situations billed, computed here (PRD §15.2) ── */
      const isSituation = dto.type === 'situation';
      // The final invoice bills the rest of the executed quantities per position, like a situation.
      const billsPositions = isSituation || isFinal;
      const offerLineIds = dto.lines.map((l) => l.offerLineId).filter((id): id is string => !!id);
      if (!billsPositions && offerLineIds.length) {
        throw new ValidationError('Only situation and final invoice lines bill offer positions (offerLineId).');
      }
      if (new Set(offerLineIds).size !== offerLineIds.length) {
        throw new ValidationError('A situation bills each offer position on one line only.');
      }
      // Read under the invoice lock, so a concurrent situation can't bill the same quantity twice.
      const positions = new Map(
        (offerLineIds.length
          ? await situationPositions(queryRunner.manager, companyId, dto.projectId, offerLineIds)
          : []
        ).map((p) => [p.offerLineId, p]),
      );
      if (positions.size !== offerLineIds.length) {
        throw new BusinessRuleError(
          'OFFER_LINE_NOT_IN_PROJECT',
          'Situation lines can only bill priced work positions of the offer contracted for this project.',
        );
      }
      const situationNumber = isSituation
        ? await nextSituationNumber(queryRunner.manager, companyId, dto.projectId)
        : null;

      /* ── Build lines and compute totals ── */
      const lines: Partial<InvoiceLine>[] = [];
      let subtotalHtCents = 0;

      for (let i = 0; i < dto.lines.length; i++) {
        const l = dto.lines[i];
        const position = l.offerLineId ? positions.get(l.offerLineId)! : null;

        if (position) {
          // Billed for the period: executed to date minus what earlier situations already billed.
          const previousQuantity = position.previousQuantity;
          // The request's cumulative, else what the project manager validated on site.
          const cumulativeQuantity = situationLineCumulativeQuantity(l.cumulativeQuantity, position);
          if (cumulativeQuantity == null) {
            throw new ValidationError(
              `Line ${i + 1}: no executed quantity is recorded for position ${position.positionNumber}; give its cumulative quantity.`,
            );
          }
          if (roundQuantity(cumulativeQuantity) < previousQuantity) {
            throw new ValidationError(
              `Line ${i + 1}: cumulative quantity ${cumulativeQuantity} is lower than the ${previousQuantity} already invoiced by earlier situations.`,
            );
          }
          const periodQuantity = roundQuantity(cumulativeQuantity - previousQuantity);
          // The contracted selling price; the request's price is used only for a position the offer
          // left unpriced ("prix à compléter").
          const unitPriceCents = position.unitPriceCents ?? l.unitPriceCents;
          const totalPriceCents = Math.round(periodQuantity * unitPriceCents);
          subtotalHtCents += totalPriceCents;
          lines.push({
            companyId,
            offerLineId: position.offerLineId,
            description: l.description,
            unit: l.unit || position.unit || null,
            quantity: position.offerQuantity,
            unitPriceCents,
            totalPriceCents,
            cumulativeQuantity,
            previousQuantity,
            periodQuantity,
            sortOrder: i,
          });
          continue;
        }

        if (billsPositions && l.cumulativeQuantity != null) {
          throw new ValidationError(
            `Line ${i + 1}: cumulative quantities are tracked per offer position; set the line's offerLineId.`,
          );
        }
        if (l.quantity == null) {
          throw new ValidationError(`Line ${i + 1}: quantity is required.`);
        }
        const totalPriceCents = Math.round(l.quantity * l.unitPriceCents);
        subtotalHtCents += totalPriceCents;
        lines.push({
          companyId,
          offerLineId: null,
          description: l.description,
          unit: l.unit || null,
          quantity: l.quantity,
          unitPriceCents: l.unitPriceCents,
          totalPriceCents,
          cumulativeQuantity: l.cumulativeQuantity ?? null,
          previousQuantity: null,
          periodQuantity: null,
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

      /* ── Prior acomptes (situations and the final invoice): each acompte deducted once, drafts reserve ── */
      let priorAcomptesCents = 0;
      if (dto.type === 'situation' || isFinal) {
        priorAcomptesCents = await remainingAcomptesCents(queryRunner.manager, companyId, dto.projectId);
      }

      /* ── VAT, retention, total ── */
      // Retention guarantees executed work, so an advance payment request carries none, and
      // nothing is held back any more once the final invoice released it. The final invoice holds
      // none on its own work and releases what the project held: its retention amount is the
      // negated release, so total = HT + VAT + released retention − acomptes not yet deducted.
      const appliedRetentionRate = dto.type === 'acompte' || isFinal || finalInvoice ? 0 : retentionRate;
      const vatAmountCents = swissRound(Math.round(subtotalHtCents * vatRate / 10000));
      const retentionAmountCents = isFinal
        ? -retentionReleasedCents
        : swissRound(Math.round(subtotalHtCents * appliedRetentionRate / 10000));
      const totalTtcCents = swissRound(
        subtotalHtCents + vatAmountCents - retentionAmountCents - priorAcomptesCents,
      );
      if (isFinal && totalTtcCents < 0) {
        throw new BusinessRuleError(
          'FINAL_INVOICE_NEGATIVE',
          `The acomptes not yet deducted exceed what the final invoice settles by ${(-totalTtcCents / 100).toFixed(2)} CHF; credit the excess acompte first.`,
        );
      }

      /* ── Persist invoice ── */
      const invoiceEntity = queryRunner.manager.create(Invoice, {
        companyId,
        projectId: dto.projectId,
        clientId: dto.clientId,
        type: dto.type,
        invoiceNumber,
        situationNumber,
        status: 'draft',
        issueDate: new Date(),
        vatRate,
        subtotalHtCents,
        vatAmountCents,
        retentionAmountCents,
        priorAcomptesCents,
        totalTtcCents,
        amountPaidCents: 0,
        acompteScheduleItemId: dto.acompteScheduleItemId ?? null,
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
      await lockInvoiceNumbering(queryRunner, companyId);

      const invoiceNumber = await nextInvoiceNumber(queryRunner, companyId);

      // The final invoice settled everything billed before it (released its retention, deducted its
      // acomptes): crediting one of those would undo them a second time. Credit the final first.
      const finalInvoice = await liveFinalInvoice(queryRunner, companyId, original.projectId);
      if (finalInvoice && finalInvoice.id !== original.id && new Date(original.createdAt) < new Date(finalInvoice.createdAt)) {
        throw new BusinessRuleError(
          'FINAL_INVOICE_ISSUED',
          `Final invoice ${finalInvoice.invoiceNumber} settled invoice ${original.invoiceNumber}; credit the final invoice first.`,
        );
      }

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
            offerLineId: ol.offerLineId,
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
        lines: issuanceLines(saved, original.type === 'final_invoice'),
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
     Situations — what the next situation of a project starts from
     ═══════════════════════════════════════════════ */

  /**
   * The server's values for the next situation of a project: its number, the acomptes it would
   * deduct, and each offer position with its budget and the quantity already billed. The
   * situation itself recomputes all of these under the invoice lock when it is created.
   */
  async getSituationPreview(companyId: string, projectId: string) {
    await assertProjectExists(this.invoiceRepo.manager, companyId, projectId);
    const positions = await situationPositions(this.dataSource, companyId, projectId);
    const situationNumber = await nextSituationNumber(this.dataSource, companyId, projectId);
    const acomptesToDeductCents = await remainingAcomptesCents(this.dataSource, companyId, projectId);
    return { projectId, situationNumber, acomptesToDeductCents, positions };
  }

  /* ═══════════════════════════════════════════════
     Final invoice — décompte final (PRD §15.1, §15.4)
     ═══════════════════════════════════════════════ */

  /**
   * What the project's final invoice settles, from the server's values: everything billed so far
   * (issued invoices and situations, not cancelled or credited), the retention they hold (released
   * by the final invoice), the acomptes not deducted yet, the positions with what was billed of
   * them (the final invoice bills the rest like a situation), the approved plus-values not billed
   * yet, and what blocks creating it. Creating the final invoice recomputes all of it under the
   * invoice lock.
   *
   * The final invoice's total = its HT (remaining positions + plus-values + other lines) + VAT
   * + retention released − acomptes not yet deducted. Together with what was billed before, the
   * client pays: total executed + plus-values (TTC) − acomptes.
   */
  async getFinalInvoicePreview(companyId: string, projectId: string) {
    await assertProjectExists(this.invoiceRepo.manager, companyId, projectId);
    const [contract] = await this.dataSource.query(
      `SELECT c.id, c.reference, c.retention_rate, to_char(c.final_acceptance_date, 'YYYY-MM-DD') AS final_acceptance_date
         FROM project p JOIN contract c ON c.company_id = p.company_id AND c.id = p.contract_id
        WHERE p.company_id = $1 AND p.id = $2`,
      [companyId, projectId],
    );
    const finalInvoice = await liveFinalInvoice(this.dataSource, companyId, projectId);
    const drafts = await pendingDraftNumbers(this.dataSource, companyId, projectId);
    const billed = await billedSoFar(this.dataSource, companyId, projectId);
    const retentionToReleaseCents = await heldRetentionCents(this.dataSource, companyId, projectId);
    const acomptesToDeductCents = await remainingAcomptesCents(this.dataSource, companyId, projectId);
    const positions = await situationPositions(this.dataSource, companyId, projectId);
    const plusValues: { id: string; description: string; amount_cents: string }[] = await this.dataSource.query(
      `SELECT id, description, amount_cents FROM plus_value
        WHERE company_id = $1 AND project_id = $2 AND status = 'approved' AND invoice_id IS NULL
        ORDER BY created_at`,
      [companyId, projectId],
    );

    const blockers: { rule: string; message: string }[] = [];
    if (finalInvoice) {
      blockers.push({ rule: 'FINAL_INVOICE_EXISTS', message: `The project's final invoice is ${finalInvoice.invoiceNumber}.` });
    }
    if (!contract?.final_acceptance_date) {
      blockers.push({ rule: 'FINAL_ACCEPTANCE_REQUIRED', message: 'The final acceptance of the works is not recorded on the contract yet.' });
    }
    if (drafts.length) {
      blockers.push({ rule: 'FINAL_INVOICE_DRAFTS_PENDING', message: `Draft invoices to issue or cancel first: ${drafts.join(', ')}.` });
    }

    return {
      projectId,
      contract: contract
        ? {
            id: contract.id,
            reference: contract.reference,
            retentionRate: Number(contract.retention_rate),
            finalAcceptanceDate: contract.final_acceptance_date,
          }
        : null,
      finalInvoice,
      canCreate: blockers.length === 0,
      blockers,
      /** Issued invoices and situations so far (HT includes the plus-values they billed). */
      billedSoFar: billed,
      retentionToReleaseCents,
      acomptesToDeductCents,
      positions: positions.map((p) => ({
        ...p,
        /** Offer quantity not billed yet, and its value at the contracted price. */
        remainingOfferQuantity: Math.max(roundQuantity(p.offerQuantity - p.previousQuantity), 0),
        remainingOfferValueCents:
          p.unitPriceCents == null ? null : Math.round(Math.max(p.offerQuantity - p.previousQuantity, 0) * p.unitPriceCents),
      })),
      plusValuesToInvoice: plusValues.map((pv) => ({ id: pv.id, description: pv.description, amountCents: Number(pv.amount_cents) })),
    };
  }

  /* ═══════════════════════════════════════════════
     Invoice number format (PRD §15.1 "Format configurable par entreprise")
     ═══════════════════════════════════════════════ */

  /** The company's format and the number the next invoice would get (not reserved). */
  async getInvoiceNumberFormat(companyId: string) {
    const format = await invoiceNumberFormat(this.dataSource, companyId);
    return { format, nextNumber: await nextInvoiceNumber(this.dataSource, companyId) };
  }

  /**
   * Changes the format of the company's next invoice numbers. Existing numbers never change. Under
   * the invoice numbering lock, so no invoice is numbered with a half-changed format.
   */
  async setInvoiceNumberFormat(companyId: string, format: string) {
    parseInvoiceNumberFormat(format);
    await this.dataSource.transaction(async (m) => {
      await lockInvoiceNumbering(m, companyId);
      await m.query('UPDATE company SET invoice_number_format = $2, updated_at = now() WHERE id = $1', [companyId, format]);
    });
    return this.getInvoiceNumberFormat(companyId);
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
