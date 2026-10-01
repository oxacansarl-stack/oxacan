import { swissRound } from '../../common/util/money';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Company } from '../company/entities/company.entity';
import { LINES_IN_TOTAL, sellingLineCents } from './offer-pricing';
import { Offer } from './entities/offer.entity';
import { OfferLine } from './entities/offer-line.entity';
import { OfferAssumption } from './entities/offer-assumption.entity';
import {
  NotFoundError,
  BusinessRuleError,
} from '@oxacan/shared-types';
import type { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';
import type {
  AddOfferLineDto as AddLineDto,
  UpdateOfferLineDto as UpdateLineDto,
} from './dto/offer-line.dto';
import type {
  AddOfferAssumptionDto as AddAssumptionDto,
  UpdateOfferAssumptionDto as UpdateAssumptionDto,
} from './dto/offer-assumption.dto';
import { PricingService } from './pricing.service';

interface OfferFilters {
  page?: number;
  limit?: number;
  status?: string;
  clientId?: string;
  search?: string;
}

/** Only an offer still being prepared can change; once sent, changes go into a new version (§14). */
export const EDITABLE_STATUSES = ['draft', 'in_progress'];

/** Allowed status changes. A sent offer never goes back to draft: duplicate it instead. */
export const NEXT_STATUSES: Record<string, string[]> = {
  draft: ['in_progress', 'submitted', 'archived'],
  in_progress: ['draft', 'submitted', 'archived'],
  submitted: ['accepted', 'rejected', 'archived'],
  accepted: ['archived'],
  rejected: ['archived'],
  archived: [],
};

/** Line / assumption types that still need a decision before the offer can be sent (R005, §14). */
const PENDING_TYPES = ['HYPOTHESE_A_VALIDER', 'INFORMATION_MANQUANTE'];

/** Strategies that look the price up in the article's price history (R010). */
const HISTORY_STRATEGIES = ['LATEST', 'MEDIAN_N', 'INDEXED', 'COMPOSED'];

/** Adds what the UI needs to know about an offer's lifecycle. */
export function withLifecycle<T extends { status: string }>(offer: T) {
  return { ...offer, editable: EDITABLE_STATUSES.includes(offer.status), nextStatuses: NEXT_STATUSES[offer.status] ?? [] };
}


@Injectable()
export class OffersService {
  constructor(
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(OfferLine)
    private readonly lineRepo: Repository<OfferLine>,
    @InjectRepository(OfferAssumption)
    private readonly assumptionRepo: Repository<OfferAssumption>,
    private readonly dataSource: DataSource,
    private readonly pricing: PricingService,
  ) {}

  /** Throws unless the offer can still be changed. */
  private assertEditable(offer: Offer): void {
    if (!EDITABLE_STATUSES.includes(offer.status)) {
      throw new BusinessRuleError(
        'OFFER_LOCKED',
        `This offer is ${offer.status} and can no longer be changed. Create a new version to modify it.`,
      );
    }
  }

  /** Fills a missing unit price from the article's price history when a history strategy is chosen. */
  private async priceFromHistory(
    companyId: string,
    articleId: string | null | undefined,
    strategy: string | null | undefined,
  ): Promise<{ unitPriceCents: number; confidence: number } | null> {
    if (!articleId || !strategy || !HISTORY_STRATEGIES.includes(strategy)) return null;
    return this.pricing.resolvePrice(companyId, articleId, strategy as 'LATEST');
  }

  /* ───────────── Offer CRUD ───────────── */

  async findAll(companyId: string, filters: OfferFilters = {}) {
    const { page = 1, limit = 25, status, clientId, search } = filters;

    const qb = this.offerRepo
      .createQueryBuilder('offer')
      .leftJoinAndSelect('offer.client', 'client')
      .leftJoinAndSelect('offer.projectType', 'projectType')
      .where('offer.company_id = :companyId', { companyId });

    if (status) {
      qb.andWhere('offer.status = :status', { status });
    }

    if (clientId) {
      qb.andWhere('offer.client_id = :clientId', { clientId });
    }

    if (search) {
      qb.andWhere(
        '(offer.project_name ILIKE :search OR offer.reference ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    qb.orderBy('offer.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(companyId: string, id: string): Promise<Offer> {
    const offer = await this.offerRepo.findOne({
      where: { id, companyId },
      relations: [
        'lines',
        'lines.canonicalArticle',
        'assumptions',
        'client',
        'projectType',
      ],
    });
    if (!offer) throw new NotFoundError('Offer', id);
    return offer;
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateOfferDto,
  ): Promise<Offer> {
    return this.dataSource.transaction(async (m) => {
      const company = await m.findOne(Company, { where: { id: companyId } });
      // Serialise per company so the yearly OFF-YYYY-NNNN sequence has no duplicates.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`offer:${companyId}`]);
      let reference = dto.reference || null;
      if (!reference) {
        const prefix = `OFF-${new Date().getFullYear()}-`;
        const [{ max }] = await m.query(
          `SELECT MAX(substring(reference from '[0-9]+$')::int) AS max
           FROM offer WHERE company_id = $1 AND reference LIKE $2`,
          [companyId, `${prefix}%`],
        );
        reference = `${prefix}${String((max ?? 0) + 1).padStart(4, '0')}`;
      }
      return m.save(
        m.create(Offer, {
          companyId,
          clientId: dto.clientId,
          projectName: dto.projectName,
          projectTypeId: dto.projectTypeId || null,
          reference,
          marginFactor: dto.marginFactor ?? company?.defaultMarginFactor ?? 120,
          vatRate: dto.vatRate ?? company?.defaultVatRate ?? 810,
          validityDays: dto.validityDays ?? 30,
          notes: dto.notes || null,
          status: 'draft',
          version: 1,
          createdBy: userId,
          updatedBy: userId,
        }),
      );
    });
  }

  async update(
    companyId: string,
    id: string,
    userId: string,
    dto: UpdateOfferDto,
  ): Promise<Offer> {
    const offer = await this.findById(companyId, id);
    this.assertEditable(offer);
    Object.assign(offer, {
      ...dto,
      updatedBy: userId,
    });
    return this.offerRepo.save(offer);
  }

  async updateStatus(
    companyId: string,
    id: string,
    userId: string,
    newStatus: string,
  ): Promise<Offer> {
    const offer = await this.findById(companyId, id);
    if (newStatus === offer.status) return offer;

    const allowed = NEXT_STATUSES[offer.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BusinessRuleError(
        'INVALID_STATUS_TRANSITION',
        `An offer cannot go from '${offer.status}' to '${newStatus}'.` +
          (allowed.length ? ` Allowed: ${allowed.join(', ')}.` : ''),
        { from: offer.status, to: newStatus, allowed },
      );
    }

    if (newStatus === 'submitted') {
      const lines = await this.lineRepo.find({
        where: { offerId: id, companyId },
      });

      // 100% rule: every BASE line must be priced ("prix à compléter" blocks sending).
      const unpricedLines = lines.filter(
        (line) => line.variantType === 'BASE' && line.unitPriceCents == null,
      );

      if (unpricedLines.length > 0) {
        throw new BusinessRuleError(
          'PRIX_A_COMPLETER',
          `Cannot submit offer: ${unpricedLines.length} line(s) have no price (positions: ${unpricedLines.map((l) => l.positionNumber).join(', ')}). All lines must be priced before submission.`,
        );
      }

      // Nothing goes out while a hypothesis or missing information is still open (R005, §14 Validation).
      const pendingLines = lines.filter((l) => PENDING_TYPES.includes(l.variantType));
      const pendingAssumptions = offer.assumptions.filter((a) => PENDING_TYPES.includes(a.type) && a.status === 'open');
      if (pendingLines.length || pendingAssumptions.length) {
        throw new BusinessRuleError(
          'VALIDATION_PENDING',
          `Cannot submit offer: ${pendingLines.length} line(s) and ${pendingAssumptions.length} point(s) still need a decision ` +
            '(hypothèse à valider / information manquante). Confirm, change or exclude them first.',
          { lines: pendingLines.map((l) => l.positionNumber), assumptions: pendingAssumptions.map((a) => a.id) },
        );
      }

      offer.submittedAt = new Date();
    }

    if (newStatus === 'accepted') {
      offer.acceptedAt = new Date();
    }

    offer.status = newStatus;
    offer.updatedBy = userId;
    return this.offerRepo.save(offer);
  }

  /* ───────────── Offer Lines ───────────── */

  async addLine(
    companyId: string,
    offerId: string,
    dto: AddLineDto,
  ): Promise<OfferLine> {
    this.assertEditable(await this.findById(companyId, offerId));

    // Auto-set positionNumber: max existing + 1
    const maxPos = await this.lineRepo
      .createQueryBuilder('line')
      .select('COALESCE(MAX(line.position_number), 0)', 'maxPos')
      .where('line.offer_id = :offerId', { offerId })
      .andWhere('line.company_id = :companyId', { companyId })
      .getRawOne();

    const positionNumber = (maxPos?.maxPos ?? 0) + 1;

    // No price given but a history strategy chosen → take it from the article's observations (R010);
    // still null when there is no history ("prix à compléter", never CHF 0).
    const fromHistory =
      dto.unitPriceCents === undefined
        ? await this.priceFromHistory(companyId, dto.canonicalArticleId, dto.pricingStrategy)
        : null;
    const unitPriceCents = dto.unitPriceCents ?? fromHistory?.unitPriceCents ?? null;
    const totalPriceCents =
      unitPriceCents != null
        ? swissRound(Math.round(dto.quantity * unitPriceCents))
        : null;

    const line = this.lineRepo.create({
      offerId,
      companyId,
      canonicalArticleId: dto.canonicalArticleId || null,
      positionNumber,
      description: dto.description,
      unit: dto.unit,
      quantity: dto.quantity,
      unitPriceCents,
      totalPriceCents,
      pricingStrategy: dto.pricingStrategy || null,
      // A confidence sent with a proposed line (R008) wins over the pricing strategy's own.
      confidenceScore: dto.confidenceScore ?? fromHistory?.confidence ?? null,
      ruleId: dto.ruleId || null,
      evidence: dto.evidence ?? [],
      roomType: dto.roomType || null,
      variantType: dto.variantType ?? 'BASE',
      sortOrder: dto.sortOrder ?? 0,
    });

    return this.lineRepo.save(line);
  }

  async updateLine(
    companyId: string,
    offerId: string,
    lineId: string,
    dto: UpdateLineDto,
  ): Promise<OfferLine> {
    this.assertEditable(await this.findById(companyId, offerId));

    const line = await this.lineRepo.findOne({
      where: { id: lineId, offerId, companyId },
    });
    if (!line) throw new NotFoundError('OfferLine', lineId);

    Object.assign(line, dto);

    // Switching to a history strategy without typing a price re-prices the line from history.
    if (dto.pricingStrategy !== undefined && dto.unitPriceCents === undefined) {
      const fromHistory = await this.priceFromHistory(companyId, line.canonicalArticleId, dto.pricingStrategy);
      if (fromHistory) {
        line.unitPriceCents = fromHistory.unitPriceCents;
        if (dto.confidenceScore === undefined) line.confidenceScore = fromHistory.confidence;
      }
    }

    // Recalculate line total if we have both quantity and unit price
    const quantity = line.quantity;
    const unitPrice = line.unitPriceCents;
    line.totalPriceCents =
      unitPrice != null
        ? swissRound(Math.round(quantity * unitPrice))
        : null;

    return this.lineRepo.save(line);
  }

  async removeLine(
    companyId: string,
    offerId: string,
    lineId: string,
  ): Promise<void> {
    this.assertEditable(await this.findById(companyId, offerId));

    const line = await this.lineRepo.findOne({
      where: { id: lineId, offerId, companyId },
    });
    if (!line) throw new NotFoundError('OfferLine', lineId);

    await this.lineRepo.remove(line);
  }

  /* ───────────── Assumptions ───────────── */

  async addAssumption(
    companyId: string,
    offerId: string,
    dto: AddAssumptionDto,
  ): Promise<OfferAssumption> {
    this.assertEditable(await this.findById(companyId, offerId));

    const assumption = this.assumptionRepo.create({
      offerId,
      companyId,
      type: dto.type,
      description: dto.description,
      impactAmountCents: dto.impactAmountCents ?? null,
      status: dto.status ?? 'open',
    });

    return this.assumptionRepo.save(assumption);
  }

  /** Records the decision on an open point (confirmed / rejected), which unblocks sending. */
  async updateAssumption(
    companyId: string,
    offerId: string,
    assumptionId: string,
    dto: UpdateAssumptionDto,
  ): Promise<OfferAssumption> {
    this.assertEditable(await this.findById(companyId, offerId));
    const assumption = await this.assumptionRepo.findOne({ where: { id: assumptionId, offerId, companyId } });
    if (!assumption) throw new NotFoundError('OfferAssumption', assumptionId);
    Object.assign(assumption, dto);
    return this.assumptionRepo.save(assumption);
  }

  /* ───────────── Recalculation ───────────── */

  async recalculateTotals(
    companyId: string,
    offerId: string,
  ): Promise<Offer> {
    const offer = await this.findById(companyId, offerId);
    // A sent offer's totals are what the client received; they must not move.
    this.assertEditable(offer);

    // Sum all BASE lines (skip EXCLU variant types)
    const lines = await this.lineRepo.find({
      where: { offerId, companyId },
    });

    // Line totals stay at cost (internal); the offer total is the sum of BASE selling prices,
    // so the client document adds up line by line. Only the payable TTC is rounded to 5 ct.
    let totalHt = 0;
    for (const line of lines) {
      if (line.variantType === 'EXCLU' || line.unitPriceCents == null) continue;
      line.totalPriceCents = Math.round(Number(line.quantity) * line.unitPriceCents);
      await this.lineRepo.save(line);
      if (LINES_IN_TOTAL.includes(line.variantType)) {
        totalHt += sellingLineCents(line.quantity, line.unitPriceCents, offer.marginFactor);
      }
    }

    // vatRate is stored in basis points (810 = 8.10 %)
    const totalVat = Math.round((totalHt * offer.vatRate) / 10000);
    const totalTtc = swissRound(totalHt + totalVat);

    offer.totalHtCents = totalHt;
    offer.totalVatCents = totalVat;
    offer.totalTtcCents = totalTtc;

    return this.offerRepo.save(offer);
  }

  /* ───────────── Duplicate ───────────── */

  async duplicateOffer(
    companyId: string,
    offerId: string,
    userId: string,
  ): Promise<Offer> {
    const source = await this.findById(companyId, offerId);

    // Find max version for the same project
    const maxVersion = await this.offerRepo
      .createQueryBuilder('offer')
      .select('COALESCE(MAX(offer.version), 0)', 'maxVersion')
      .where('offer.company_id = :companyId', { companyId })
      .andWhere('offer.project_name = :projectName', {
        projectName: source.projectName,
      })
      .andWhere('offer.client_id = :clientId', { clientId: source.clientId })
      .getRawOne();

    const newVersion = (maxVersion?.maxVersion ?? 0) + 1;

    // Create the new offer
    const newOffer = this.offerRepo.create({
      companyId,
      clientId: source.clientId,
      projectName: source.projectName,
      projectTypeId: source.projectTypeId,
      reference: source.reference,
      marginFactor: source.marginFactor,
      vatRate: source.vatRate,
      validityDays: source.validityDays,
      notes: source.notes,
      status: 'draft',
      version: newVersion,
      totalHtCents: source.totalHtCents,
      totalVatCents: source.totalVatCents,
      totalTtcCents: source.totalTtcCents,
      createdBy: userId,
      updatedBy: userId,
    });
    const savedOffer = await this.offerRepo.save(newOffer);

    // Duplicate all lines
    for (const line of source.lines) {
      const newLine = this.lineRepo.create({
        offerId: savedOffer.id,
        companyId,
        canonicalArticleId: line.canonicalArticleId,
        positionNumber: line.positionNumber,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        totalPriceCents: line.totalPriceCents,
        pricingStrategy: line.pricingStrategy,
        confidenceScore: line.confidenceScore,
        ruleId: line.ruleId,
        evidence: line.evidence ?? [],
        roomType: line.roomType,
        variantType: line.variantType,
        sortOrder: line.sortOrder,
      });
      await this.lineRepo.save(newLine);
    }

    // Duplicate all assumptions
    for (const assumption of source.assumptions) {
      const newAssumption = this.assumptionRepo.create({
        offerId: savedOffer.id,
        companyId,
        type: assumption.type,
        description: assumption.description,
        impactAmountCents: assumption.impactAmountCents,
        status: assumption.status,
      });
      await this.assumptionRepo.save(newAssumption);
    }

    // Return the full new offer with relations
    return this.findById(companyId, savedOffer.id);
  }
}
