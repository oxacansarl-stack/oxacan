import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { createHash } from 'crypto';
import { CanonicalArticle } from './entities/canonical-article.entity';
import { ArticleAlias } from './entities/article-alias.entity';
import { SourceDocument } from './entities/source-document.entity';
import { SourceOccurrence } from './entities/source-occurrence.entity';
import { PriceObservation } from './entities/price-observation.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';

interface ArticleFilters {
  search?: string;
  category?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

interface CreateArticleDto {
  npkNumber?: string;
  description: string;
  unit: string;
  category?: string;
  isComposed?: boolean;
  composedComponents?: Array<{
    articleId: string;
    quantity: number;
    unitPriceCents: number;
  }>;
}

interface UpdateArticleDto {
  npkNumber?: string;
  description?: string;
  unit?: string;
  category?: string;
  isComposed?: boolean;
  composedComponents?: Array<{
    articleId: string;
    quantity: number;
    unitPriceCents: number;
  }>;
  isActive?: boolean;
}

interface CsvRow {
  lineNumber: number;
  rawText: string;
  npkNumber?: string;
  description?: string;
  unit?: string;
  quantity?: number;
  unitPriceCents?: number;
  totalPriceCents?: number;
  roomType?: string;
  floor?: string;
}

interface CsvImportData {
  filename: string;
  projectName?: string;
  projectYear?: number;
  entrepreneurName?: string;
  documentType?: string;
  rows: CsvRow[];
}

@Injectable()
export class CatalogueService {
  constructor(
    @InjectRepository(CanonicalArticle)
    private readonly articleRepo: Repository<CanonicalArticle>,
    @InjectRepository(ArticleAlias)
    private readonly aliasRepo: Repository<ArticleAlias>,
    @InjectRepository(SourceDocument)
    private readonly documentRepo: Repository<SourceDocument>,
    @InjectRepository(SourceOccurrence)
    private readonly occurrenceRepo: Repository<SourceOccurrence>,
    @InjectRepository(PriceObservation)
    private readonly observationRepo: Repository<PriceObservation>,
  ) {}

  /* ───────────── Articles CRUD ───────────── */

  async findAllArticles(companyId: string, filters: ArticleFilters = {}) {
    const { search, category, isActive, page = 1, limit = 50 } = filters;

    const qb = this.articleRepo
      .createQueryBuilder('a')
      .where('a.company_id = :companyId', { companyId });

    if (search) {
      qb.andWhere(
        '(a.description ILIKE :search OR a.npk_number ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (category) {
      qb.andWhere('a.category = :category', { category });
    }

    if (isActive !== undefined) {
      qb.andWhere('a.is_active = :isActive', { isActive });
    }

    qb.orderBy('a.npk_number', 'ASC', 'NULLS LAST')
      .addOrderBy('a.description', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, limit };
  }

  async findArticleById(companyId: string, id: string) {
    const article = await this.articleRepo.findOne({
      where: { id, companyId },
    });
    if (!article) throw new NotFoundError('CanonicalArticle', id);

    const aliases = await this.aliasRepo.find({
      where: { canonicalArticleId: id, companyId },
      order: { createdAt: 'DESC' },
    });

    const priceStats = await this.getPriceStats(companyId, id);

    return { ...article, aliases, priceStats };
  }

  async createArticle(
    companyId: string,
    dto: CreateArticleDto,
  ): Promise<CanonicalArticle> {
    const article = this.articleRepo.create({
      companyId,
      npkNumber: dto.npkNumber || null,
      description: dto.description,
      unit: dto.unit,
      category: dto.category || null,
      isComposed: dto.isComposed ?? false,
      composedComponents: dto.composedComponents || null,
    });
    return this.articleRepo.save(article);
  }

  async updateArticle(
    companyId: string,
    id: string,
    dto: UpdateArticleDto,
  ): Promise<CanonicalArticle> {
    const article = await this.articleRepo.findOne({
      where: { id, companyId },
    });
    if (!article) throw new NotFoundError('CanonicalArticle', id);

    Object.assign(article, dto);
    return this.articleRepo.save(article);
  }

  /* ───────────── Price stats ───────────── */

  async getPriceStats(companyId: string, articleId: string) {
    const article = await this.articleRepo.findOne({
      where: { id: articleId, companyId },
    });
    if (!article) throw new NotFoundError('CanonicalArticle', articleId);

    const observations = await this.observationRepo.find({
      where: { canonicalArticleId: articleId, companyId },
      order: { observationDate: 'DESC' },
    });

    return {
      medianPriceCents: article.medianPriceCents,
      minPriceCents: article.minPriceCents,
      maxPriceCents: article.maxPriceCents,
      observationCount: article.observationCount,
      lastPriceDate: article.lastPriceDate,
      confidenceClassification: article.confidenceClassification,
      observations,
    };
  }

  /* ───────────── CSV Import ───────────── */

  async importCsv(companyId: string, userId: string, data: CsvImportData) {
    // Compute SHA-256 hash of the CSV content for dedup
    const contentForHash = JSON.stringify(data.rows);
    const hashSha256 = createHash('sha256')
      .update(contentForHash)
      .digest('hex');

    // Check for duplicate import
    const existing = await this.documentRepo.findOne({
      where: { companyId, hashSha256 },
    });
    if (existing) {
      throw new BusinessRuleError(
        'DUPLICATE_IMPORT',
        `This file has already been imported (document ID: ${existing.id})`,
      );
    }

    // Create source document
    const doc = this.documentRepo.create({
      companyId,
      hashSha256,
      filename: data.filename,
      projectName: data.projectName || null,
      projectYear: data.projectYear || null,
      entrepreneurName: data.entrepreneurName || null,
      documentType: data.documentType || 'soumission',
      importDate: new Date(),
      status: 'processing',
      totalOccurrences: data.rows.length,
      matchedOccurrences: 0,
      importedBy: userId,
    });
    const savedDoc = await this.documentRepo.save(doc);

    let matchedCount = 0;
    const createdOccurrences: SourceOccurrence[] = [];

    for (const row of data.rows) {
      // Create immutable source occurrence
      const occurrence = this.occurrenceRepo.create({
        sourceDocumentId: savedDoc.id,
        companyId,
        lineNumber: row.lineNumber,
        rawText: row.rawText,
        npkNumber: row.npkNumber || null,
        description: row.description || null,
        unit: row.unit || null,
        quantity: row.quantity ?? null,
        unitPriceCents: row.unitPriceCents ?? null,
        totalPriceCents: row.totalPriceCents ?? null,
        roomType: row.roomType || null,
        floor: row.floor || null,
        status: 'unmatched',
      });

      // Try to match by npk_number
      if (row.npkNumber) {
        const matchedArticle = await this.articleRepo.findOne({
          where: { companyId, npkNumber: row.npkNumber, isActive: true },
        });

        if (matchedArticle) {
          occurrence.canonicalArticleId = matchedArticle.id;
          occurrence.matchConfidence = 1.0;
          occurrence.status = 'auto_matched';
          matchedCount++;

          // Create price observation if we have a unit price
          if (row.unitPriceCents != null) {
            const observation = this.observationRepo.create({
              canonicalArticleId: matchedArticle.id,
              companyId,
              unitPriceCents: row.unitPriceCents,
              observationDate: new Date(),
              projectName: data.projectName || null,
            });
            await this.observationRepo.save(observation);

            // Update article price stats
            await this.refreshArticlePriceStats(companyId, matchedArticle.id);
          }
        }
      }

      const saved = await this.occurrenceRepo.save(occurrence);
      createdOccurrences.push(saved);
    }

    // Update document status
    savedDoc.matchedOccurrences = matchedCount;
    savedDoc.status = 'matched';
    await this.documentRepo.save(savedDoc);

    return {
      document: savedDoc,
      totalRows: data.rows.length,
      matchedRows: matchedCount,
      unmatchedRows: data.rows.length - matchedCount,
    };
  }

  /* ───────────── Internal helpers ───────────── */

  private async refreshArticlePriceStats(
    companyId: string,
    articleId: string,
  ): Promise<void> {
    const observations = await this.observationRepo.find({
      where: {
        canonicalArticleId: articleId,
        companyId,
        isOutlier: false,
      },
      order: { unitPriceCents: 'ASC' },
    });

    if (observations.length === 0) return;

    const prices = observations.map((o) => o.unitPriceCents);
    const minPrice = prices[0];
    const maxPrice = prices[prices.length - 1];

    // Compute median
    const mid = Math.floor(prices.length / 2);
    const medianPrice =
      prices.length % 2 === 0
        ? Math.round((prices[mid - 1] + prices[mid]) / 2)
        : prices[mid];

    // Confidence: simple heuristic based on observation count
    // 0 obs → 0, 1 → 0.2, 3 → 0.5, 5 → 0.7, 10+ → 0.9
    const count = observations.length;
    const confidence = Math.min(0.9, count * 0.1 + (count > 0 ? 0.1 : 0));

    // Get the latest observation date
    const latestObs = await this.observationRepo.findOne({
      where: { canonicalArticleId: articleId, companyId },
      order: { observationDate: 'DESC' },
    });

    await this.articleRepo.update(
      { id: articleId, companyId },
      {
        medianPriceCents: medianPrice,
        minPriceCents: minPrice,
        maxPriceCents: maxPrice,
        observationCount: count,
        lastPriceDate: latestObs?.observationDate || null,
        confidenceClassification: confidence,
      },
    );
  }
}
