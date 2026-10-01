import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PriceObservation } from '../catalogue/entities/price-observation.entity';
import { CanonicalArticle } from '../catalogue/entities/canonical-article.entity';
import { BusinessRule } from './entities/business-rule.entity';

interface PriceResult {
  unitPriceCents: number;
  confidence: number;
}

type PricingStrategy = 'LATEST' | 'MEDIAN_N' | 'INDEXED' | 'COMPOSED' | 'MANUAL';

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PriceObservation)
    private readonly observationRepo: Repository<PriceObservation>,
    @InjectRepository(CanonicalArticle)
    private readonly articleRepo: Repository<CanonicalArticle>,
    @InjectRepository(BusinessRule)
    private readonly ruleRepo: Repository<BusinessRule>,
  ) {}

  /**
   * Resolve a unit price for the given article using the specified strategy.
   * Returns { unitPriceCents, confidence } or null if no price is available.
   *
   * "Prix a completer" rule: if no price available, returns null (never 0).
   */
  async resolvePrice(
    companyId: string,
    articleId: string,
    strategy: PricingStrategy,
  ): Promise<PriceResult | null> {
    switch (strategy) {
      case 'LATEST':
        return this.resolveLatest(companyId, articleId);
      case 'MEDIAN_N':
        return this.resolveMedianN(companyId, articleId);
      case 'INDEXED':
        return this.resolveIndexed(companyId, articleId);
      case 'COMPOSED':
        return this.resolveComposed(companyId, articleId);
      case 'MANUAL':
        return null;
      default:
        return null;
    }
  }

  /**
   * LATEST: get the most recent price observation for this article.
   */
  private async resolveLatest(
    companyId: string,
    articleId: string,
  ): Promise<PriceResult | null> {
    const latest = await this.observationRepo.findOne({
      where: {
        canonicalArticleId: articleId,
        companyId,
        isOutlier: false,
      },
      order: { observationDate: 'DESC' },
    });

    if (!latest) return null;

    return {
      unitPriceCents: latest.unitPriceCents,
      confidence: 0.7,
    };
  }

  /**
   * MEDIAN_N: get last 10 observations, return median price.
   */
  private async resolveMedianN(
    companyId: string,
    articleId: string,
  ): Promise<PriceResult | null> {
    const observations = await this.observationRepo.find({
      where: {
        canonicalArticleId: articleId,
        companyId,
        isOutlier: false,
      },
      order: { observationDate: 'DESC' },
      take: 10,
    });

    if (observations.length === 0) return null;

    // Sort by price to compute median
    const prices = observations
      .map((o) => o.unitPriceCents)
      .sort((a, b) => a - b);

    const mid = Math.floor(prices.length / 2);
    const medianPrice =
      prices.length % 2 === 0
        ? Math.round((prices[mid - 1] + prices[mid]) / 2)
        : prices[mid];

    // Confidence scales with observation count: more data = more confident
    const confidence = Math.min(0.9, observations.length * 0.1);

    return {
      unitPriceCents: medianPrice,
      confidence,
    };
  }

  /**
   * INDEXED: get latest price, apply 2% annual indexation from observation date to today.
   */
  private async resolveIndexed(
    companyId: string,
    articleId: string,
  ): Promise<PriceResult | null> {
    const latest = await this.observationRepo.findOne({
      where: {
        canonicalArticleId: articleId,
        companyId,
        isOutlier: false,
      },
      order: { observationDate: 'DESC' },
    });

    if (!latest) return null;

    const observationDate = new Date(latest.observationDate);
    const now = new Date();

    // Calculate years elapsed (fractional)
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const yearsElapsed =
      (now.getTime() - observationDate.getTime()) / msPerYear;

    // Apply 2% annual indexation compounded
    const indexedPrice = Math.round(
      latest.unitPriceCents * Math.pow(1.02, yearsElapsed),
    );

    return {
      unitPriceCents: indexedPrice,
      confidence: 0.5, // Lower confidence due to estimation
    };
  }

  /**
   * COMPOSED: get the article's composed_components JSONB, sum component prices.
   */
  private async resolveComposed(
    companyId: string,
    articleId: string,
  ): Promise<PriceResult | null> {
    const article = await this.articleRepo.findOne({
      where: { id: articleId, companyId },
    });

    if (!article || !article.isComposed || !article.composedComponents) {
      return null;
    }

    let totalCents = 0;
    let allResolved = true;

    for (const component of article.composedComponents) {
      // Each component has: { articleId, quantity, unitPriceCents }
      // If the component has a stored price, use it; otherwise try to resolve
      if (component.unitPriceCents != null && component.unitPriceCents > 0) {
        totalCents += Math.round(component.quantity * component.unitPriceCents);
      } else {
        // Try to get price from observations for the sub-article
        const subPrice = await this.resolveLatest(companyId, component.articleId);
        if (subPrice) {
          totalCents += Math.round(component.quantity * subPrice.unitPriceCents);
        } else {
          allResolved = false;
        }
      }
    }

    if (totalCents === 0) return null;

    return {
      unitPriceCents: totalCents,
      confidence: allResolved ? 0.8 : 0.4,
    };
  }

  /**
   * Articles to propose for a room type (§7.6, §8), most reliable first. Two sources:
   *  1. the company's active business rules for that room type (manual or validated), then
   *  2. its room profile, derived from its own imported soumissions: every article matched in a
   *     room of that type, with how often and in how many projects it appears there.
   * Profile suggestions are statistical observations still to be validated by the user (§7.3
   * step 10); each carries the source lines it rests on (R007) and a confidence (R008).
   */
  async suggestArticlesForRoom(companyId: string, roomType: string | undefined): Promise<RoomSuggestion[]> {
    const term = (roomType ?? '').trim();
    if (!term) return [];
    const pattern = `%${escapeLike(term)}%`;

    const rules = await this.ruleRepo
      .createQueryBuilder('rule')
      .leftJoinAndSelect('rule.canonicalArticle', 'article')
      .innerJoinAndSelect('rule.roomType', 'roomType')
      .where('rule.company_id = :companyId', { companyId })
      .andWhere('rule.is_active = :isActive', { isActive: true })
      .andWhere("roomType.name ILIKE :pattern ESCAPE '!'", { pattern })
      .orderBy('rule.confidence', 'DESC')
      .getMany();

    const fromRules: RoomSuggestion[] = rules.map((rule) => ({
      articleId: rule.canonicalArticleId,
      description: rule.canonicalArticle?.description ?? '',
      unit: rule.canonicalArticle?.unit ?? '',
      roomType: rule.roomType?.name ?? term,
      suggestedQuantity: rule.suggestedQuantity,
      confidence: rule.confidence,
      medianPriceCents: toNumber(rule.canonicalArticle?.medianPriceCents),
      source: rule.source ?? 'manual',
      ruleId: rule.id,
      status: 'REGLE_ACTIVE',
      observationCount: null,
      projectCount: null,
      quantityMin: null,
      quantityMax: null,
      evidence: [],
    }));

    const covered = new Set(fromRules.map((r) => `${r.roomType.toLowerCase()}|${r.articleId}`));
    const fromProfile = (await this.roomProfile(companyId, pattern)).filter(
      (p) => !covered.has(`${p.roomType.toLowerCase()}|${p.articleId}`),
    );
    return [...fromRules, ...fromProfile];
  }

  /**
   * Room profile from the company's own source lines. Only confirmed article matches count
   * (lines awaiting review only carry a candidate), and variants are left out: they are
   * alternatives, not what the room normally gets (R004). Mapping confidence (§7.7) is the share
   * of the company's projects having that room type in which the article appears there.
   */
  private async roomProfile(companyId: string, pattern: string): Promise<RoomSuggestion[]> {
    const rows: Array<Record<string, any>> = await this.observationRepo.manager.query(
      `WITH occ AS (
         SELECT o.id, o.room_type, o.canonical_article_id, o.quantity, d.document_date,
                COALESCE(NULLIF(d.project_name, ''), d.id::text) AS project
         FROM source_occurrence o
         JOIN source_document d ON d.id = o.source_document_id AND d.company_id = o.company_id
         WHERE o.company_id = $1
           AND o.canonical_article_id IS NOT NULL
           AND o.status NOT IN ('unmatched', 'needs_review', 'rejected')
           AND o.is_variant = false
           AND o.room_type ILIKE $2 ESCAPE '!'
       ), rooms AS (
         SELECT room_type, COUNT(DISTINCT project) AS room_projects FROM occ GROUP BY room_type
       )
       SELECT occ.room_type AS "roomType",
              occ.canonical_article_id AS "articleId",
              a.description, a.unit,
              a.median_price_cents AS "medianPriceCents",
              COUNT(*)::int AS "observationCount",
              COUNT(DISTINCT occ.project)::int AS "projectCount",
              r.room_projects::int AS "roomProjectCount",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY occ.quantity::float8) AS "quantityMedian",
              MIN(occ.quantity) AS "quantityMin",
              MAX(occ.quantity) AS "quantityMax",
              (array_agg(occ.id::text ORDER BY occ.document_date DESC NULLS LAST, occ.id))[1:${MAX_EVIDENCE}] AS evidence
       FROM occ
       JOIN rooms r ON r.room_type = occ.room_type
       JOIN canonical_article a ON a.id = occ.canonical_article_id AND a.company_id = $1 AND a.is_active = true
       GROUP BY occ.room_type, occ.canonical_article_id, a.description, a.unit, a.median_price_cents, r.room_projects
       ORDER BY COUNT(DISTINCT occ.project)::float / r.room_projects DESC, COUNT(*) DESC, a.description
       LIMIT ${MAX_PROFILE_SUGGESTIONS}`,
      [companyId, pattern],
    );

    return rows.map((row) => ({
      articleId: row.articleId,
      description: row.description,
      unit: row.unit,
      roomType: row.roomType,
      suggestedQuantity: round2(toNumber(row.quantityMedian)),
      confidence: round2(row.roomProjectCount ? row.projectCount / row.roomProjectCount : 0) ?? 0,
      medianPriceCents: toNumber(row.medianPriceCents),
      source: 'statistical',
      ruleId: null,
      status: 'OBSERVATION_A_VALIDER',
      observationCount: row.observationCount,
      projectCount: row.projectCount,
      quantityMin: toNumber(row.quantityMin),
      quantityMax: toNumber(row.quantityMax),
      evidence: row.evidence ?? [],
    }));
  }
}

/** Most source lines returned as evidence per suggestion. */
const MAX_EVIDENCE = 10;
/** Most profile suggestions per request. */
const MAX_PROFILE_SUGGESTIONS = 100;

export interface RoomSuggestion {
  articleId: string;
  description: string;
  unit: string;
  /** Room type the suggestion comes from (the query matches room types by substring). */
  roomType: string;
  suggestedQuantity: number | null;
  /** 0–1. Rules: the rule's own confidence; profile: share of projects with the article in that room. */
  confidence: number;
  medianPriceCents: number | null;
  /** 'manual' | 'statistical' | 'ai_suggested' for rules; 'statistical' for the room profile. */
  source: string;
  /** Business rule id when the suggestion comes from a rule. */
  ruleId: string | null;
  status: 'REGLE_ACTIVE' | 'OBSERVATION_A_VALIDER';
  observationCount: number | null;
  projectCount: number | null;
  quantityMin: number | null;
  quantityMax: number | null;
  /** Source occurrence ids the suggestion rests on, most recent soumission first (R007). */
  evidence: string[];
}

/** Escapes LIKE wildcards with '!' so a room name is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (c) => `!${c}`);
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number | null): number | null {
  return value == null ? null : Math.round(value * 100) / 100;
}
