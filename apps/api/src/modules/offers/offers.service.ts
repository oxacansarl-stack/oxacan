import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Offer } from './entities/offer.entity';
import { OfferLine } from './entities/offer-line.entity';
import { OfferAssumption } from './entities/offer-assumption.entity';
import {
  NotFoundError,
  BusinessRuleError,
  SWISS_ROUNDING_STEP,
} from '@oxacan/shared-types';

interface OfferFilters {
  page?: number;
  limit?: number;
  status?: string;
  clientId?: string;
  search?: string;
}

interface CreateOfferDto {
  projectName: string;
  clientId: string;
  projectTypeId?: string;
  reference?: string;
  marginFactor?: number;
  vatRate?: number;
  validityDays?: number;
  notes?: string;
}

interface UpdateOfferDto {
  projectName?: string;
  clientId?: string;
  projectTypeId?: string;
  reference?: string;
  marginFactor?: number;
  vatRate?: number;
  validityDays?: number;
  notes?: string;
}

interface AddLineDto {
  canonicalArticleId?: string;
  description: string;
  unit: string;
  quantity: number;
  unitPriceCents?: number | null;
  pricingStrategy?: string;
  roomType?: string;
  variantType?: string;
  sortOrder?: number;
}

interface UpdateLineDto {
  description?: string;
  unit?: string;
  quantity?: number;
  unitPriceCents?: number | null;
  pricingStrategy?: string;
  roomType?: string;
  variantType?: string;
  sortOrder?: number;
  positionNumber?: number;
}

interface AddAssumptionDto {
  type: string;
  description: string;
  impactAmountCents?: number;
  status?: string;
}

/**
 * Swiss 5-centime rounding: round to nearest 5 centimes.
 */
function swissRound(amount: number): number {
  return Math.round(amount / SWISS_ROUNDING_STEP) * SWISS_ROUNDING_STEP;
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
  ) {}

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

    qb.orderBy('offer.created_at', 'DESC')
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
    const offer = this.offerRepo.create({
      companyId,
      clientId: dto.clientId,
      projectName: dto.projectName,
      projectTypeId: dto.projectTypeId || null,
      reference: dto.reference || null,
      marginFactor: dto.marginFactor ?? 120,
      vatRate: dto.vatRate ?? 810,
      validityDays: dto.validityDays ?? 30,
      notes: dto.notes || null,
      status: 'draft',
      version: 1,
      createdBy: userId,
      updatedBy: userId,
    });
    return this.offerRepo.save(offer);
  }

  async update(
    companyId: string,
    id: string,
    userId: string,
    dto: UpdateOfferDto,
  ): Promise<Offer> {
    const offer = await this.findById(companyId, id);
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

    // 100% rule: cannot submit if any line has unitPriceCents = NULL
    if (newStatus === 'submitted') {
      const lines = await this.lineRepo.find({
        where: { offerId: id, companyId },
      });

      const unpricedLines = lines.filter(
        (line) => line.variantType === 'BASE' && line.unitPriceCents == null,
      );

      if (unpricedLines.length > 0) {
        throw new BusinessRuleError(
          'PRIX_A_COMPLETER',
          `Cannot submit offer: ${unpricedLines.length} line(s) have no price (positions: ${unpricedLines.map((l) => l.positionNumber).join(', ')}). All lines must be priced before submission.`,
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
    // Ensure offer exists and belongs to company
    await this.findById(companyId, offerId);

    // Auto-set positionNumber: max existing + 1
    const maxPos = await this.lineRepo
      .createQueryBuilder('line')
      .select('COALESCE(MAX(line.position_number), 0)', 'maxPos')
      .where('line.offer_id = :offerId', { offerId })
      .andWhere('line.company_id = :companyId', { companyId })
      .getRawOne();

    const positionNumber = (maxPos?.maxPos ?? 0) + 1;

    // Calculate totalPriceCents if unitPriceCents is provided
    const unitPriceCents = dto.unitPriceCents ?? null;
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
    // Ensure offer exists and belongs to company
    await this.findById(companyId, offerId);

    const line = await this.lineRepo.findOne({
      where: { id: lineId, offerId, companyId },
    });
    if (!line) throw new NotFoundError('OfferLine', lineId);

    Object.assign(line, dto);

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
    // Ensure offer exists and belongs to company
    await this.findById(companyId, offerId);

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
    // Ensure offer exists and belongs to company
    await this.findById(companyId, offerId);

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

  /* ───────────── Recalculation ───────────── */

  async recalculateTotals(
    companyId: string,
    offerId: string,
  ): Promise<Offer> {
    const offer = await this.findById(companyId, offerId);

    // Sum all BASE lines (skip EXCLU variant types)
    const lines = await this.lineRepo.find({
      where: { offerId, companyId },
    });

    let sumLineTotals = 0;
    for (const line of lines) {
      if (line.variantType === 'EXCLU') continue;

      if (line.unitPriceCents != null) {
        const lineTotal = Math.round(line.quantity * line.unitPriceCents);
        // Update the individual line total
        line.totalPriceCents = swissRound(lineTotal);
        await this.lineRepo.save(line);
        sumLineTotals += lineTotal;
      }
    }

    // Apply margin: marginFactor is stored as integer (120 = 1.20x)
    const marginMultiplier = offer.marginFactor / 100;
    const totalHt = swissRound(Math.round(sumLineTotals * marginMultiplier));

    // Apply VAT: vatRate is stored in basis points (810 = 8.10%)
    const vatMultiplier = offer.vatRate / 10000;
    const totalVat = swissRound(Math.round(totalHt * vatMultiplier));

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
