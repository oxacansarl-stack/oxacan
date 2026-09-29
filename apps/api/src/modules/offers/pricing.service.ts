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
   * Suggest articles for a room type based on business rules.
   * Returns articles with suggested quantities for the given room type.
   */
  async suggestArticlesForRoom(
    companyId: string,
    roomType: string,
  ): Promise<
    Array<{
      articleId: string;
      description: string;
      unit: string;
      suggestedQuantity: number | null;
      confidence: number;
      medianPriceCents: number | null;
    }>
  > {
    const rules = await this.ruleRepo
      .createQueryBuilder('rule')
      .leftJoinAndSelect('rule.canonicalArticle', 'article')
      .leftJoinAndSelect('rule.roomType', 'roomType')
      .where('rule.company_id = :companyId', { companyId })
      .andWhere('rule.is_active = :isActive', { isActive: true })
      .andWhere('roomType.name ILIKE :roomType', {
        roomType: `%${roomType}%`,
      })
      .orderBy('rule.confidence', 'DESC')
      .getMany();

    return rules.map((rule) => ({
      articleId: rule.canonicalArticleId,
      description: rule.canonicalArticle?.description ?? '',
      unit: rule.canonicalArticle?.unit ?? '',
      suggestedQuantity: rule.suggestedQuantity,
      confidence: rule.confidence,
      medianPriceCents: rule.canonicalArticle?.medianPriceCents ?? null,
    }));
  }
}
