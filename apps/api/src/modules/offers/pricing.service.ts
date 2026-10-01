import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PriceObservation } from '../catalogue/entities/price-observation.entity';
import { CanonicalArticle } from '../catalogue/entities/canonical-article.entity';
import { BusinessRule } from './entities/business-rule.entity';
import { historyPriceConfidence, NO_PRICE, round2 as roundScore, USER_VALIDATED } from './offer-confidence';

export interface PriceResult {
  unitPriceCents: number;
  /** Price dimension of the confidence score (§7.7), 0–1. */
  confidence: number;
}

export type PricingStrategy = 'LATEST' | 'MEDIAN_N' | 'INDEXED' | 'COMPOSED' | 'MANUAL';

/** Strategies that look the price up in the article's price history (R010). */
export const HISTORY_STRATEGIES: string[] = ['LATEST', 'MEDIAN_N', 'INDEXED', 'COMPOSED'];

/**
 * INDEXED default: +2.00 % a year (basis points, like company.default_vat_rate). The PRD names the
 * index (glossary: SSE-IPB, the Swiss construction price index; §7.4 "ajusté à l'inflation") but
 * gives no rate, so the engine's historical rate is the default. Each company sets its own in
 * company.price_index_rate_bp (migration 1727500000033), normally the yearly change of the
 * construction price index for its trade (OFS/BFS "Indice suisse des prix de la construction",
 * published every April and October).
 */
export const DEFAULT_PRICE_INDEX_RATE_BP = 200;

/** Observations MEDIAN_N takes the median of. */
const MEDIAN_WINDOW = 10;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string | null | undefined): value is string => !!value && UUID_RE.test(value);

@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PriceObservation)
    private readonly observationRepo: Repository<PriceObservation>,
    @InjectRepository(BusinessRule)
    private readonly ruleRepo: Repository<BusinessRule>,
  ) {}

  /**
   * Resolve a unit price for the given article using the specified strategy.
   * Returns { unitPriceCents, confidence } or null if no price is available.
   * `m` lets a caller holding a transaction (and the offer row lock) run the lookups on it.
   *
   * "Prix a completer" rule: if no price available, returns null (never 0).
   */
  async resolvePrice(
    companyId: string,
    articleId: string,
    strategy: PricingStrategy,
    m: EntityManager = this.observationRepo.manager,
  ): Promise<PriceResult | null> {
    switch (strategy) {
      case 'LATEST':
        return this.resolveLatest(m, companyId, articleId);
      case 'MEDIAN_N':
        return this.resolveMedianN(m, companyId, articleId);
      case 'INDEXED':
        return this.resolveIndexed(m, companyId, articleId);
      case 'COMPOSED':
        return this.resolveComposed(m, companyId, articleId);
      case 'MANUAL':
        return null;
      default:
        return null;
    }
  }

  /** Yearly INDEXED rate of the company, in basis points (200 = +2.00 %/year). */
  async priceIndexRateBp(companyId: string, m: EntityManager = this.observationRepo.manager): Promise<number> {
    // Read straight from the settings column: the company entity belongs to the company module.
    const [row] = await m.query('SELECT price_index_rate_bp FROM company WHERE id = $1', [companyId]);
    const rate = row?.price_index_rate_bp;
    return rate == null ? DEFAULT_PRICE_INDEX_RATE_BP : Number(rate);
  }

  private latestObservation(m: EntityManager, companyId: string, articleId: string) {
    return m.getRepository(PriceObservation).findOne({
      where: { canonicalArticleId: articleId, companyId, isOutlier: false },
      order: { observationDate: 'DESC', createdAt: 'DESC' },
    });
  }

  /**
   * LATEST: get the most recent price observation for this article.
   */
  private async resolveLatest(m: EntityManager, companyId: string, articleId: string): Promise<PriceResult | null> {
    const latest = await this.latestObservation(m, companyId, articleId);
    if (!latest) return null;
    return {
      unitPriceCents: Number(latest.unitPriceCents),
      confidence: historyPriceConfidence(1, yearsSince(latest.observationDate)),
    };
  }

  /**
   * MEDIAN_N: get last 10 observations, return median price.
   */
  private async resolveMedianN(m: EntityManager, companyId: string, articleId: string): Promise<PriceResult | null> {
    const observations = await m.getRepository(PriceObservation).find({
      where: { canonicalArticleId: articleId, companyId, isOutlier: false },
      order: { observationDate: 'DESC', createdAt: 'DESC' },
      take: MEDIAN_WINDOW,
    });
    if (observations.length === 0) return null;

    const prices = observations.map((o) => Number(o.unitPriceCents)).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const medianPrice = prices.length % 2 === 0 ? Math.round((prices[mid - 1] + prices[mid]) / 2) : prices[mid];
    const meanAge = observations.reduce((n, o) => n + yearsSince(o.observationDate), 0) / observations.length;

    return { unitPriceCents: medianPrice, confidence: historyPriceConfidence(observations.length, meanAge) };
  }

  /**
   * INDEXED: latest price brought forward to today with the company's yearly index, compounded.
   */
  private async resolveIndexed(m: EntityManager, companyId: string, articleId: string): Promise<PriceResult | null> {
    const latest = await this.latestObservation(m, companyId, articleId);
    if (!latest) return null;

    const years = yearsSince(latest.observationDate);
    const rate = (await this.priceIndexRateBp(companyId, m)) / 10_000;
    return {
      unitPriceCents: Math.round(Number(latest.unitPriceCents) * Math.pow(1 + rate, years)),
      confidence: historyPriceConfidence(1, years, true),
    };
  }

  /**
   * COMPOSED: sum of the components of the article's composed_components JSONB. Its confidence is
   * the mean of the components': a price set in the bundle editor is the user's (1), one taken
   * from history scores like LATEST, an unpriced component scores 0 (the sum is then too low).
   */
  private async resolveComposed(m: EntityManager, companyId: string, articleId: string): Promise<PriceResult | null> {
    const article = await m.getRepository(CanonicalArticle).findOne({ where: { id: articleId, companyId } });
    if (!article || !article.isComposed || !article.composedComponents?.length) return null;

    let totalCents = 0;
    let confidenceSum = 0;
    for (const component of article.composedComponents) {
      if (component.unitPriceCents != null && component.unitPriceCents > 0) {
        totalCents += Math.round(component.quantity * component.unitPriceCents);
        confidenceSum += USER_VALIDATED;
        continue;
      }
      const subPrice = await this.resolveLatest(m, companyId, component.articleId);
      if (subPrice) {
        totalCents += Math.round(component.quantity * subPrice.unitPriceCents);
        confidenceSum += subPrice.confidence;
      } else {
        confidenceSum += NO_PRICE;
      }
    }
    if (totalCents === 0) return null;

    return { unitPriceCents: totalCents, confidence: roundScore(confidenceSum / article.composedComponents.length) };
  }

  /* ───────────── Confidence dimensions (§7.7) ───────────── */

  /**
   * Classification: mean match confidence of the source lines a proposal cites for this article
   * (1 = matched on its NPK code, 0.3 = candidate awaiting review). Null when the evidence holds
   * no matched source line of the article, for the caller to fall back on.
   */
  async classificationConfidence(
    companyId: string,
    articleId: string,
    evidence: string[],
    m: EntityManager = this.observationRepo.manager,
  ): Promise<number | null> {
    const ids = evidence.filter(isUuid);
    if (!ids.length) return null;
    const [row] = await m.query(
      `SELECT AVG(match_confidence)::float8 AS confidence FROM source_occurrence
       WHERE company_id = $1 AND canonical_article_id = $2 AND id = ANY($3::uuid[]) AND match_confidence IS NOT NULL`,
      [companyId, articleId, ids],
    );
    return row?.confidence == null ? null : roundScore(Number(row.confidence));
  }

  /**
   * Mapping: share of the company's projects having this room type in which the article appears
   * there, like the room profile (roomProfile). Null when no project has the room type yet.
   */
  async mappingConfidence(
    companyId: string,
    articleId: string,
    roomType: string,
    m: EntityManager = this.observationRepo.manager,
  ): Promise<number | null> {
    const [row] = await m.query(
      `SELECT COUNT(DISTINCT project)::int AS "roomProjects",
              (COUNT(DISTINCT project) FILTER (WHERE canonical_article_id = $3))::int AS "articleProjects"
       FROM (
         SELECT o.canonical_article_id, COALESCE(NULLIF(d.project_name, ''), d.id::text) AS project
         FROM source_occurrence o
         JOIN source_document d ON d.id = o.source_document_id AND d.company_id = o.company_id
         WHERE o.company_id = $1
           AND o.canonical_article_id IS NOT NULL
           AND o.status NOT IN ('unmatched', 'needs_review', 'rejected')
           AND o.is_variant = false
           AND lower(o.room_type) = lower($2)
       ) occ`,
      [companyId, roomType.trim(), articleId],
    );
    return row?.roomProjects ? roundScore(row.articleProjects / row.roomProjects) : null;
  }

  /** Rule: the confidence of the company's business rule, when ruleId is one. */
  async ruleConfidence(
    companyId: string,
    ruleId: string,
    m: EntityManager = this.observationRepo.manager,
  ): Promise<number | null> {
    if (!isUuid(ruleId)) return null;
    const rule = await m.getRepository(BusinessRule).findOne({ where: { id: ruleId, companyId } });
    return rule ? roundScore(Number(rule.confidence)) : null;
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

/** Years elapsed since a date (fractional, never negative). */
function yearsSince(value: Date | string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / MS_PER_YEAR) : 0;
}
