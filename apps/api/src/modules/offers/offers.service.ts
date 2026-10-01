import { swissRound } from '../../common/util/money';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Company } from '../company/entities/company.entity';
import { LINES_IN_TOTAL, PENDING_LINE_TYPES, sellingLineCents, variantSemantics } from './offer-pricing';
import {
  combinedConfidence,
  ConfidenceDimensions,
  NO_PRICE,
  USER_VALIDATED,
} from './offer-confidence';
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
import { HISTORY_STRATEGIES, PricingService, PricingStrategy } from './pricing.service';

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
const PENDING_TYPES = PENDING_LINE_TYPES;

/** A line's price with its strategy and the price dimension of its confidence (§7.4, §7.7). */
interface LinePrice {
  unitPriceCents: number | null;
  pricingStrategy: string | null;
  confidencePrice: number;
}

/** What the confidence dimensions of a line are computed from. */
type ScoredLine = Pick<OfferLine, 'canonicalArticleId' | 'roomType' | 'ruleId' | 'evidence'>;

/** A line proposed by a rule or a room profile (R007/R008), as opposed to one made by hand. */
const isProposed = (line: ScoredLine) => !!line.ruleId || (line.evidence ?? []).length > 0;

/** Adds what the UI needs to know about an offer's lifecycle. */
export function withLifecycle<T extends { status: string }>(offer: T) {
  return { ...offer, editable: EDITABLE_STATUSES.includes(offer.status), nextStatuses: NEXT_STATUSES[offer.status] ?? [] };
}


/**
 * Object.assign for partial DTOs: with ES2022 class fields every declared DTO property exists as
 * `undefined` on the instance, and copying those would wipe loaded entity values (e.g. quantity,
 * leaving quantity * price = NaN). Only sent (defined) fields are applied.
 */
function assignDefined<T extends object>(target: T, dto: object): T {
  return Object.assign(target, Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)));
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

  /** Loads the offer and locks its row until the end of the transaction (SELECT … FOR UPDATE). */
  private async lockOffer(m: EntityManager, companyId: string, offerId: string): Promise<Offer> {
    const offer = await m.getRepository(Offer).findOne({
      where: { id: offerId, companyId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!offer) throw new NotFoundError('Offer', offerId);
    return offer;
  }

  /**
   * Runs a change to an offer or its lines / assumptions in one transaction that holds the offer
   * row lock, so "sent offers are locked" is checked and the write made atomically: a status
   * change waits for an edit in progress to commit, and an edit waiting on a status change sees
   * the new status and is refused.
   */
  private editLocked<T>(companyId: string, offerId: string, fn: (m: EntityManager, offer: Offer) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (m) => {
      const offer = await this.lockOffer(m, companyId, offerId);
      this.assertEditable(offer);
      return fn(m, offer);
    });
  }

  /** Fills a missing unit price from the article's price history when a history strategy is chosen. */
  private async priceFromHistory(
    m: EntityManager,
    companyId: string,
    articleId: string | null | undefined,
    strategy: string | null | undefined,
  ): Promise<{ unitPriceCents: number; confidence: number } | null> {
    if (!articleId || !strategy || !HISTORY_STRATEGIES.includes(strategy)) return null;
    return this.pricing.resolvePrice(companyId, articleId, strategy as PricingStrategy, m);
  }

  /**
   * A price the user typed. If it is exactly what the chosen history strategy gives, the user
   * accepted the suggestion and it keeps the history's confidence; otherwise it is a manual price
   * (§7.4 MANUAL), scored as validated by the user (§7.7), and a history strategy no longer
   * describes it, so the line switches to MANUAL.
   */
  private async typedPrice(
    m: EntityManager,
    companyId: string,
    articleId: string | null,
    strategy: string | null,
    unitPriceCents: number,
  ): Promise<LinePrice> {
    const fromHistory = await this.priceFromHistory(m, companyId, articleId, strategy);
    if (fromHistory && fromHistory.unitPriceCents === unitPriceCents) {
      return { unitPriceCents, pricingStrategy: strategy, confidencePrice: fromHistory.confidence };
    }
    const manual = strategy && HISTORY_STRATEGIES.includes(strategy) ? 'MANUAL' : strategy;
    return { unitPriceCents, pricingStrategy: manual, confidencePrice: USER_VALIDATED };
  }

  /** Classification (§7.7): from the cited source lines' match, else the user's own pick (1). */
  private async classificationOf(m: EntityManager, companyId: string, line: ScoredLine, sent?: number | null) {
    if (sent != null) return sent;
    if (!line.canonicalArticleId) return null;
    const fromEvidence = await this.pricing.classificationConfidence(companyId, line.canonicalArticleId, line.evidence ?? [], m);
    return fromEvidence ?? USER_VALIDATED;
  }

  /** Mapping (§7.7): the room profile's share for a proposed line, 1 for one placed by hand. */
  private async mappingOf(m: EntityManager, companyId: string, line: ScoredLine, sent?: number | null) {
    if (sent != null) return sent;
    if (!line.canonicalArticleId || !line.roomType?.trim()) return null;
    if (!isProposed(line)) return USER_VALIDATED;
    return this.pricing.mappingConfidence(companyId, line.canonicalArticleId, line.roomType, m);
  }

  /** Rule (§7.7): the proposing business rule's own confidence. */
  private async ruleOf(m: EntityManager, companyId: string, line: ScoredLine, sent?: number | null) {
    if (sent != null) return sent;
    if (!line.ruleId) return null;
    return this.pricing.ruleConfidence(companyId, line.ruleId, m);
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
    await this.editLocked(companyId, id, async (m, offer) => {
      Object.assign(offer, {
        ...dto,
        updatedBy: userId,
      });
      await m.save(offer);
    });
    return this.findById(companyId, id);
  }

  async updateStatus(
    companyId: string,
    id: string,
    userId: string,
    newStatus: string,
  ): Promise<Offer> {
    // The row lock serialises this with line edits: no line can slip in between the checks
    // below and the status change (see editLocked).
    await this.dataSource.transaction(async (m) => {
      const offer = await this.lockOffer(m, companyId, id);
      if (newStatus === offer.status) return;

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
        const lines = await m.find(OfferLine, { where: { offerId: id, companyId } });
        const assumptions = await m.find(OfferAssumption, { where: { offerId: id, companyId } });

        // 100% rule (§7.9): every line counted in the total must be priced ("prix à compléter" blocks sending).
        const unpricedLines = lines.filter(
          (line) => variantSemantics(line.variantType).mustBePriced && line.unitPriceCents == null,
        );

        if (unpricedLines.length > 0) {
          throw new BusinessRuleError(
            'PRIX_A_COMPLETER',
            `Cannot submit offer: ${unpricedLines.length} line(s) have no price (positions: ${unpricedLines.map((l) => l.positionNumber).join(', ')}). All lines must be priced before submission.`,
          );
        }

        // Nothing goes out while a hypothesis or missing information is still open (R005, §14 Validation).
        const pendingLines = lines.filter((l) => PENDING_TYPES.includes(l.variantType));
        const pendingAssumptions = assumptions.filter((a) => PENDING_TYPES.includes(a.type) && a.status === 'open');
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
      await m.save(offer);
    });
    return this.findById(companyId, id);
  }

  /* ───────────── Offer Lines ───────────── */

  async addLine(
    companyId: string,
    offerId: string,
    dto: AddLineDto,
  ): Promise<OfferLine> {
    return this.editLocked(companyId, offerId, async (m) => {
      // Auto-set positionNumber: max existing + 1 (under the offer lock, so never twice the same).
      const maxPos = await m
        .getRepository(OfferLine)
        .createQueryBuilder('line')
        .select('COALESCE(MAX(line.position_number), 0)', 'maxPos')
        .where('line.offer_id = :offerId', { offerId })
        .andWhere('line.company_id = :companyId', { companyId })
        .getRawOne();

      const positionNumber = (maxPos?.maxPos ?? 0) + 1;
      const articleId = dto.canonicalArticleId || null;
      const strategy = dto.pricingStrategy || null;

      // No price given but a history strategy chosen → take it from the article's observations (R010);
      // still null when there is no history ("prix à compléter", never CHF 0).
      let price: LinePrice;
      if (dto.unitPriceCents === undefined) {
        const fromHistory = await this.priceFromHistory(m, companyId, articleId, strategy);
        price = {
          unitPriceCents: fromHistory?.unitPriceCents ?? null,
          pricingStrategy: strategy,
          confidencePrice: fromHistory?.confidence ?? NO_PRICE,
        };
      } else if (dto.unitPriceCents === null) {
        price = { unitPriceCents: null, pricingStrategy: strategy, confidencePrice: NO_PRICE };
      } else {
        price = await this.typedPrice(m, companyId, articleId, strategy, dto.unitPriceCents);
      }

      const unitPriceCents = price.unitPriceCents;
      const totalPriceCents =
        unitPriceCents != null
          ? swissRound(Math.round(dto.quantity * unitPriceCents))
          : null;

      const scored: ScoredLine = {
        canonicalArticleId: articleId,
        roomType: dto.roomType || null,
        ruleId: dto.ruleId || null,
        evidence: dto.evidence ?? [],
      };
      const dimensions: ConfidenceDimensions = {
        confidenceClassification: await this.classificationOf(m, companyId, scored, dto.confidenceClassification),
        confidenceMapping: await this.mappingOf(m, companyId, scored, dto.confidenceMapping),
        confidencePrice: price.confidencePrice,
        confidenceRule: await this.ruleOf(m, companyId, scored, dto.confidenceRule),
      };

      const line = m.getRepository(OfferLine).create({
        offerId,
        companyId,
        ...scored,
        positionNumber,
        description: dto.description,
        unit: dto.unit,
        quantity: dto.quantity,
        unitPriceCents,
        totalPriceCents,
        pricingStrategy: price.pricingStrategy,
        ...dimensions,
        // A confidence sent with a proposed line (R008) wins over the engine's combined score.
        confidenceScore: dto.confidenceScore ?? combinedConfidence(dimensions),
        variantType: dto.variantType ?? 'BASE',
        sortOrder: dto.sortOrder ?? 0,
      });

      return m.save(line);
    });
  }

  async updateLine(
    companyId: string,
    offerId: string,
    lineId: string,
    dto: UpdateLineDto,
  ): Promise<OfferLine> {
    return this.editLocked(companyId, offerId, async (m) => {
      const line = await m.findOne(OfferLine, {
        where: { id: lineId, offerId, companyId },
      });
      if (!line) throw new NotFoundError('OfferLine', lineId);

      const previous = { unitPriceCents: line.unitPriceCents, confidencePrice: line.confidencePrice };
      assignDefined(line, dto);

      // Price: a typed price is manual unless it is the strategy's own; switching to a history
      // strategy without typing a price re-prices the line from history (R010).
      const priceTouched = dto.unitPriceCents !== undefined || dto.pricingStrategy !== undefined;
      if (priceTouched) {
        const strategy = line.pricingStrategy || null;
        let price: LinePrice;
        if (dto.unitPriceCents === null) {
          price = { unitPriceCents: null, pricingStrategy: strategy, confidencePrice: NO_PRICE };
        } else if (dto.unitPriceCents !== undefined) {
          price = await this.typedPrice(m, companyId, line.canonicalArticleId, strategy, dto.unitPriceCents);
        } else {
          const fromHistory = await this.priceFromHistory(m, companyId, line.canonicalArticleId, strategy);
          const kept = previous.unitPriceCents;
          price = fromHistory
            ? { unitPriceCents: fromHistory.unitPriceCents, pricingStrategy: strategy, confidencePrice: fromHistory.confidence }
            : {
                // No history: the price stays; it is the user's own unless it came from history.
                unitPriceCents: kept,
                pricingStrategy: strategy,
                confidencePrice:
                  kept == null
                    ? NO_PRICE
                    : strategy && HISTORY_STRATEGIES.includes(strategy)
                      ? previous.confidencePrice ?? USER_VALIDATED
                      : USER_VALIDATED,
              };
        }
        Object.assign(line, price);
      }

      // Re-score only the dimensions whose inputs changed; the others keep their stored value.
      const classTouched = dto.evidence !== undefined || dto.confidenceClassification !== undefined;
      const mapTouched =
        dto.roomType !== undefined || dto.ruleId !== undefined || dto.evidence !== undefined || dto.confidenceMapping !== undefined;
      const ruleTouched = dto.ruleId !== undefined || dto.confidenceRule !== undefined;
      if (classTouched) line.confidenceClassification = await this.classificationOf(m, companyId, line, dto.confidenceClassification);
      if (mapTouched) line.confidenceMapping = await this.mappingOf(m, companyId, line, dto.confidenceMapping);
      if (ruleTouched) line.confidenceRule = await this.ruleOf(m, companyId, line, dto.confidenceRule);
      if (priceTouched || classTouched || mapTouched || ruleTouched || dto.confidenceScore !== undefined) {
        line.confidenceScore = dto.confidenceScore ?? combinedConfidence(line);
      }

      // Recalculate line total if we have both quantity and unit price
      const quantity = line.quantity;
      const unitPrice = line.unitPriceCents;
      line.totalPriceCents =
        unitPrice != null
          ? swissRound(Math.round(quantity * unitPrice))
          : null;

      return m.save(line);
    });
  }

  async removeLine(
    companyId: string,
    offerId: string,
    lineId: string,
  ): Promise<void> {
    await this.editLocked(companyId, offerId, async (m) => {
      const line = await m.findOne(OfferLine, {
        where: { id: lineId, offerId, companyId },
      });
      if (!line) throw new NotFoundError('OfferLine', lineId);

      await m.remove(line);
    });
  }

  /* ───────────── Assumptions ───────────── */

  async addAssumption(
    companyId: string,
    offerId: string,
    dto: AddAssumptionDto,
  ): Promise<OfferAssumption> {
    return this.editLocked(companyId, offerId, async (m) => {
      const assumption = m.create(OfferAssumption, {
        offerId,
        companyId,
        type: dto.type,
        description: dto.description,
        impactAmountCents: dto.impactAmountCents ?? null,
        status: dto.status ?? 'open',
      });

      return m.save(assumption);
    });
  }

  /** Records the decision on an open point (confirmed / rejected), which unblocks sending. */
  async updateAssumption(
    companyId: string,
    offerId: string,
    assumptionId: string,
    dto: UpdateAssumptionDto,
  ): Promise<OfferAssumption> {
    return this.editLocked(companyId, offerId, async (m) => {
      const assumption = await m.findOne(OfferAssumption, { where: { id: assumptionId, offerId, companyId } });
      if (!assumption) throw new NotFoundError('OfferAssumption', assumptionId);
      assignDefined(assumption, dto);
      return m.save(assumption);
    });
  }

  /* ───────────── Recalculation ───────────── */

  async recalculateTotals(
    companyId: string,
    offerId: string,
  ): Promise<Offer> {
    // A sent offer's totals are what the client received; they must not move (editLocked refuses).
    await this.editLocked(companyId, offerId, async (m, offer) => {
      const lines = await m.find(OfferLine, {
        where: { offerId, companyId },
      });

      // Line totals stay at cost (internal); the offer total is the sum of the selling prices of the
      // lines counted in the total (BASE and hypotheses, see offer-pricing.ts), so the client
      // document adds up line by line. Only the payable TTC is rounded to 5 ct.
      let totalHt = 0;
      const priced: OfferLine[] = [];
      for (const line of lines) {
        if (line.variantType === 'EXCLU' || line.unitPriceCents == null) continue;
        line.totalPriceCents = Math.round(Number(line.quantity) * line.unitPriceCents);
        priced.push(line);
        if (LINES_IN_TOTAL.includes(line.variantType)) {
          totalHt += sellingLineCents(line.quantity, line.unitPriceCents, offer.marginFactor);
        }
      }
      if (priced.length) await m.save(priced);

      // vatRate is stored in basis points (810 = 8.10 %)
      const totalVat = Math.round((totalHt * offer.vatRate) / 10000);
      const totalTtc = swissRound(totalHt + totalVat);

      offer.totalHtCents = totalHt;
      offer.totalVatCents = totalVat;
      offer.totalTtcCents = totalTtc;

      await m.save(offer);
    });
    return this.findById(companyId, offerId);
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
        confidenceClassification: line.confidenceClassification,
        confidenceMapping: line.confidenceMapping,
        confidencePrice: line.confidencePrice,
        confidenceRule: line.confidenceRule,
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
