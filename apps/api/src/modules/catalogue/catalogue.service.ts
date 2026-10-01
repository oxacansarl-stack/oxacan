import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, ILike, In } from 'typeorm';
import { createHash } from 'crypto';
import { CanonicalArticle } from './entities/canonical-article.entity';
import { ArticleAlias } from './entities/article-alias.entity';
import { SourceDocument } from './entities/source-document.entity';
import { SourceOccurrence } from './entities/source-occurrence.entity';
import { PriceObservation } from './entities/price-observation.entity';
import { NotFoundError, BusinessRuleError, ValidationError } from '@oxacan/shared-types';
import { CreateArticleDto, UpdateArticleDto, ImportCsvDto, ImportPdfDto } from './dto/catalogue.dto';
import { parseSoumission } from './pdf-soumission.parser';
import { extractPdfText } from './pdf-text.extractor';

/** Uploaded file name as stored: no path, no control characters, at most 255 characters. */
const safeFilename = (name: string | undefined) => {
  let raw = name ?? '';
  // Multipart parsers read the (UTF-8) filename parameter as latin1: undo it when that is what happened.
  if (/[\u0080-ÿ]/.test(raw) && !/[^\u0000-ÿ]/.test(raw)) {
    const utf8 = Buffer.from(raw, 'latin1').toString('utf8');
    if (!utf8.includes('�')) raw = utf8;
  }
  const base = raw.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (base || 'soumission.pdf').slice(0, 255);
};

/** What a source line says, independent of file layout (raw text, line numbering). */
const contentKey = (r: ImportCsvDto['rows'][number]) => [
  r.npkNumber ?? null,
  (r.description ?? '').replace(/\s+/g, ' ').trim(),
  r.unit ?? null,
  r.quantity ?? null,
  r.unitPriceCents ?? null,
  r.totalPriceCents ?? null,
  r.page ?? null,
  r.isVariant ?? false,
];

export interface ImportWarning {
  lineNumber: number;
  type: 'INTERNAL_CODE' | 'UNIT_MISMATCH' | 'TOTAL_MISMATCH';
}

/** Project-internal position numbers (000000xx) carry no meaning outside their soumission. */
const isProjectInternalCode = (code: string) => /^0{3,}\d*$/.test(code.trim());

const sameUnit = (a: string | null | undefined, b: string | null | undefined) =>
  !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();

/** Printed total differs from quantity × unit price by more than rounding (5 ct). */
const totalMismatch = (r: ImportCsvDto['rows'][number]) =>
  r.quantity != null && r.unitPriceCents != null && r.totalPriceCents != null
  && Math.abs(Math.round(r.quantity * r.unitPriceCents) - r.totalPriceCents) > 5;

interface ArticleFilters {
  search?: string;
  category?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
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

    qb.orderBy('a.npkNumber', 'ASC', 'NULLS LAST')
      .addOrderBy('a.description', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
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

  async importCsv(companyId: string, userId: string, data: ImportCsvDto) {
    // Dedup on what the document says, not how the file is laid out: a re-export of the same
    // soumission under another name or with different spacing is still the same document.
    const hashSha256 = createHash('sha256')
      .update(JSON.stringify([data.documentDate ?? null, ...data.rows.map(contentKey)]))
      .digest('hex');

    const existing = await this.documentRepo.findOne({ where: { companyId, hashSha256 } });
    if (existing) {
      throw new BusinessRuleError(
        'DUPLICATE_IMPORT',
        `This file has already been imported (document ID: ${existing.id})`,
      );
    }

    // All or nothing: a failure part-way must not leave a half-imported document behind
    // (its hash would then block a clean re-import).
    const result = await this.documentRepo.manager.transaction(async (m) => {
      // Two identical imports racing past the check above: the unique (company, hash) key decides.
      const [{ inserted }] = await m.query(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS inserted`,
        [`source_document:${companyId}:${hashSha256}`],
      );
      if (!inserted || (await m.exists(SourceDocument, { where: { companyId, hashSha256 } }))) {
        throw new BusinessRuleError('DUPLICATE_IMPORT', 'This file is already being imported or has been imported.');
      }

      const savedDoc = await m.save(
        m.create(SourceDocument, {
          companyId,
          hashSha256,
          filename: data.filename,
          projectName: data.projectName || null,
          projectYear: data.projectYear || null,
          entrepreneurName: data.entrepreneurName || null,
          documentType: data.documentType || 'soumission',
          documentDate: data.documentDate ?? null,
          importDate: new Date(),
          status: 'processing',
          totalOccurrences: data.rows.length,
          matchedOccurrences: 0,
          importedBy: userId,
        }),
      );

      // One lookup for every NPK code in the file instead of one query per line.
      const codes = [...new Set(data.rows.map((r) => r.npkNumber).filter((c): c is string => !!c))];
      const articles = codes.length
        ? await m.find(CanonicalArticle, { where: { companyId, npkNumber: In(codes), isActive: true } })
        : [];
      const articleByCode = new Map(articles.map((a) => [a.npkNumber, a]));

      // Prices are observations of the soumission's own date (R001), not of the import day.
      const observationDate = data.documentDate ? new Date(`${data.documentDate}T00:00:00Z`) : new Date();
      const touched = new Set<string>();
      let matchedCount = 0;

      const warnings: ImportWarning[] = [];

      for (const row of data.rows) {
        const candidate = row.npkNumber ? articleByCode.get(row.npkNumber) : undefined;
        let review: ImportWarning['type'] | null = null;
        if (candidate && isProjectInternalCode(row.npkNumber!)) {
          // 000000xx numbers are per-project; the same number means different things elsewhere (R003).
          review = 'INTERNAL_CODE';
        } else if (candidate && !sameUnit(candidate.unit, row.unit)) {
          // Same code, different unit: the code changed meaning or the line is misread (§6.1).
          review = 'UNIT_MISMATCH';
        }
        const article = review ? undefined : candidate;
        if (review) warnings.push({ lineNumber: row.lineNumber, type: review });
        if (totalMismatch(row)) warnings.push({ lineNumber: row.lineNumber, type: 'TOTAL_MISMATCH' });

        const occurrence = await m.save(
          m.create(SourceOccurrence, {
            sourceDocumentId: savedDoc.id,
            companyId,
            lineNumber: row.lineNumber,
            rawText: row.rawText,
            page: row.page ?? null,
            sectionCode: row.sectionCode || null,
            isVariant: row.isVariant ?? false,
            npkNumber: row.npkNumber || null,
            description: row.description || null,
            unit: row.unit || null,
            quantity: row.quantity ?? null,
            unitPriceCents: row.unitPriceCents ?? null,
            totalPriceCents: row.totalPriceCents ?? null,
            roomType: row.roomType || null,
            floor: row.floor || null,
            status: article ? 'auto_matched' : review ? 'needs_review' : 'unmatched',
            // A candidate awaiting review keeps its suggested article, at low confidence.
            canonicalArticleId: (article ?? candidate)?.id ?? null,
            matchConfidence: article ? 1.0 : candidate ? 0.3 : null,
          }),
        );
        if (!article) continue;
        matchedCount++;

        // Only a positive base-scope price is a price reference: variants are priced separately (R004),
        // and CHF 0 or negative (rabais) lines are not prices of the article (§7).
        if (row.unitPriceCents != null && row.unitPriceCents > 0 && !row.isVariant) {
          await m.save(
            m.create(PriceObservation, {
              canonicalArticleId: article.id,
              companyId,
              sourceOccurrenceId: occurrence.id,
              unitPriceCents: row.unitPriceCents,
              observationDate,
              projectName: data.projectName || null,
            }),
          );
          touched.add(article.id);
        }
      }

      for (const articleId of touched) await this.refreshArticlePriceStats(companyId, articleId, m);
      await this.recordAliases(m, companyId, data, articleByCode, savedDoc.filename);

      savedDoc.matchedOccurrences = matchedCount;
      savedDoc.status = 'matched';
      await m.save(savedDoc);
      return { document: savedDoc, matchedCount, warnings };
    });

    return {
      document: result.document,
      totalRows: data.rows.length,
      matchedRows: result.matchedCount,
      unmatchedRows: data.rows.length - result.matchedCount,
      reviewRows: result.warnings.filter((w) => w.type !== 'TOTAL_MISMATCH').length,
      warnings: result.warnings,
    };
  }

  /* ───────────── PDF Import ───────────── */

  /**
   * Imports a soumission PDF directly (§3.1, §10): its positions are read from the document and
   * go through the same import as a CSV, so dedup, matching, price observations and source
   * traceability (document + page of every occurrence) are identical.
   */
  async importPdf(
    companyId: string,
    userId: string,
    file: { buffer: Buffer; originalname: string } | undefined,
    meta: ImportPdfDto,
  ) {
    if (!file?.buffer?.length) throw new ValidationError('A PDF file is required (multipart field "file").');
    const parsed = parseSoumission(await extractPdfText(file.buffer));
    if (!parsed.rows.length) {
      throw new BusinessRuleError(
        'PDF_NO_POSITIONS',
        'No soumission positions were found in this PDF (scanned document or unsupported layout).',
      );
    }
    if (parsed.rows.length > 20000) {
      throw new ValidationError('The PDF holds more than 20 000 positions; split it before importing.');
    }
    const documentDate = meta.documentDate ?? parsed.documentDate ?? undefined;
    const result = await this.importCsv(companyId, userId, {
      filename: safeFilename(file.originalname),
      projectName: meta.projectName ?? parsed.projectName ?? undefined,
      projectYear: meta.projectYear ?? (documentDate ? Number(documentDate.slice(0, 4)) : undefined),
      entrepreneurName: meta.entrepreneurName,
      documentType: 'soumission',
      documentDate,
      rows: parsed.rows,
    });
    return { ...result, source: { reference: parsed.reference, pageCount: parsed.pageCount, documentDate: documentDate ?? null } };
  }

  /* ───────────── Internal helpers ───────────── */

  /**
   * Keeps every wording a matched code was seen with as an alias of its article (R002), so the
   * catalogue can be searched by the texts that appear in real soumissions.
   */
  private async recordAliases(
    m: EntityManager,
    companyId: string,
    data: ImportCsvDto,
    articleByCode: Map<string | null, CanonicalArticle>,
    source: string,
  ): Promise<void> {
    const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
    const wanted = new Map<string, Map<string, string>>(); // articleId → normalised key → text
    for (const row of data.rows) {
      const article = row.npkNumber ? articleByCode.get(row.npkNumber) : undefined;
      if (!article || !row.description || isProjectInternalCode(row.npkNumber!) || !sameUnit(article.unit, row.unit)) continue;
      const text = norm(row.description);
      const key = text.toLowerCase();
      if (key === norm(article.description).toLowerCase()) continue;
      if (!wanted.has(article.id)) wanted.set(article.id, new Map());
      wanted.get(article.id)!.set(key, text);
    }
    if (!wanted.size) return;

    const existing = await m.find(ArticleAlias, { where: { companyId, canonicalArticleId: In([...wanted.keys()]) } });
    for (const a of existing) wanted.get(a.canonicalArticleId)?.delete(norm(a.aliasText).toLowerCase());
    const fresh = [...wanted].flatMap(([canonicalArticleId, texts]) =>
      [...texts.values()].map((aliasText) => m.create(ArticleAlias, { canonicalArticleId, companyId, aliasText, source, matchConfidence: 1.0 })),
    );
    if (fresh.length) await m.save(fresh);
  }

  private async refreshArticlePriceStats(
    companyId: string,
    articleId: string,
    m: EntityManager = this.observationRepo.manager,
  ): Promise<void> {
    const observations = await m.find(PriceObservation, {
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
    const latestObs = await m.findOne(PriceObservation, {
      where: { canonicalArticleId: articleId, companyId },
      order: { observationDate: 'DESC', createdAt: 'DESC' },
    });

    await m.update(
      CanonicalArticle,
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
