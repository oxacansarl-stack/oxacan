import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CanonicalArticle } from './entities/canonical-article.entity';
import { ArticleAlias } from './entities/article-alias.entity';
import {
  cosine,
  EMBEDDING_PROVIDER,
  EmbeddingProvider,
  MAX_EMBEDDING_BATCH,
} from '../ai/embedding.provider';

/**
 * Below this a match is not worth showing: measured on real soumission wordings, genuine matches
 * scored 0.22 and above while out-of-trade text ("peinture", "carrelage") topped out at 0.19.
 */
const MIN_SCORE = 0.2;
/** Above this the wording is close enough that only the unit still needs a human eye. */
const STRONG_SCORE = 0.45;
/** Candidates offered per line: enough to choose from, few enough to read. */
const TOP_N = 3;
/** Articles compared against in one request; beyond this the answer says it was cut short. */
const MAX_ARTICLES = 480;
/** Distinct wordings looked at in one request. */
const MAX_TEXTS = 48;

export interface MatchCandidate {
  articleId: string;
  npkNumber: string | null;
  description: string;
  unit: string;
  score: number;
  /** Same wording, different unit — nearly always a different article (§6.1). */
  unitDiffers: boolean;
}

export interface MatchSuggestion {
  description: string;
  unit: string | null;
  npkNumber: string | null;
  occurrenceIds: string[];
  candidates: MatchCandidate[];
}

export interface MatchSuggestionResult {
  enabled: boolean;
  provider: string | null;
  suggestions: MatchSuggestion[];
  /** Set when the comparison was cut short, so the answer is never silently partial. */
  truncated: { articles: boolean; texts: boolean };
}

/**
 * Suggests which catalogue article an unmatched soumission line is, for lines whose code the
 * catalogue does not know (the ones exact-code matching can never recover).
 *
 * It only ever suggests. Nothing is written and no status changes: a human confirms the match,
 * as PRD §18.6 requires of every AI output. When no provider is configured — which is production's
 * default — it answers `enabled: false` instead of failing, so the screen degrades to the manual
 * list it already is.
 *
 * Only trade text leaves the system: an article's or a line's own description and unit. Client
 * names, project names and addresses are deliberately not sent (nLPD/RGPD, PRD §24.2), which is
 * why the texts are read here rather than handed in by the caller.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CanonicalArticle) private readonly articleRepo: Repository<CanonicalArticle>,
    @InjectRepository(ArticleAlias) private readonly aliasRepo: Repository<ArticleAlias>,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
  ) {}

  async suggestForUnmatched(companyId: string, limit = MAX_TEXTS): Promise<MatchSuggestionResult> {
    const off = { enabled: false, provider: null, suggestions: [], truncated: { articles: false, texts: false } };
    if (!this.embeddings.enabled) return off;

    const wanted = Math.min(Math.max(1, limit), MAX_TEXTS);
    // One row per distinct wording: the same line repeated across soumissions is one question.
    const texts: { description: string; unit: string | null; npkNumber: string | null; occurrenceIds: string[] }[] =
      await this.dataSource.query(
        `SELECT o.description, min(o.unit) AS unit, min(o.npk_number) AS "npkNumber",
                array_agg(o.id::text) AS "occurrenceIds"
           FROM source_occurrence o
          WHERE o.company_id = $1 AND o.canonical_article_id IS NULL
            AND o.description IS NOT NULL AND length(btrim(o.description)) > 2
          GROUP BY o.description
          ORDER BY count(*) DESC, o.description
          LIMIT $2`,
        [companyId, wanted + 1],
      );
    const textsTruncated = texts.length > wanted;
    const batch = texts.slice(0, wanted);
    if (batch.length === 0) {
      return { enabled: true, provider: this.embeddings.name, suggestions: [], truncated: { articles: false, texts: false } };
    }

    const articles = await this.articleRepo.find({
      where: { companyId, isActive: true },
      select: { id: true, npkNumber: true, description: true, unit: true },
      order: { npkNumber: 'ASC' },
      take: MAX_ARTICLES + 1,
    });
    const articlesTruncated = articles.length > MAX_ARTICLES;
    const pool = articles.slice(0, MAX_ARTICLES);
    if (pool.length === 0) {
      return { enabled: true, provider: this.embeddings.name, suggestions: [], truncated: { articles: false, texts: textsTruncated } };
    }
    if (articlesTruncated || textsTruncated) {
      this.logger.warn(`Match suggestions cut short for ${companyId}: ${articles.length} articles, ${texts.length} wordings.`);
    }

    // Every wording an article has already been seen under is another way to recognise it (R002).
    const aliases = await this.aliasRepo.find({
      where: { companyId },
      select: { canonicalArticleId: true, aliasText: true },
    });
    const aliasByArticle = new Map<string, string[]>();
    for (const a of aliases) {
      if (!aliasByArticle.has(a.canonicalArticleId)) aliasByArticle.set(a.canonicalArticleId, []);
      aliasByArticle.get(a.canonicalArticleId)!.push(a.aliasText);
    }

    // An article is represented by its own wording and each alias; its score is its best one.
    const entries: { articleId: string; text: string }[] = [];
    for (const a of pool) {
      entries.push({ articleId: a.id, text: a.description });
      for (const alias of (aliasByArticle.get(a.id) ?? []).slice(0, 4)) {
        entries.push({ articleId: a.id, text: alias });
      }
    }

    let docVectors: number[][];
    let queryVectors: number[][];
    try {
      docVectors = await this.embedAll(entries.map((e) => e.text), 'passage');
      queryVectors = await this.embedAll(batch.map((t) => t.description), 'query');
    } catch (err) {
      // The provider being down is not a failure of the screen: it falls back to manual matching.
      this.logger.warn(`Match suggestions unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return off;
    }

    const byId = new Map(pool.map((a) => [a.id, a]));
    const suggestions: MatchSuggestion[] = batch.map((t, qi) => {
      const best = new Map<string, number>();
      for (let i = 0; i < entries.length; i++) {
        const score = cosine(queryVectors[qi], docVectors[i]);
        const prev = best.get(entries[i].articleId);
        if (prev === undefined || score > prev) best.set(entries[i].articleId, score);
      }
      const candidates = [...best]
        .filter(([, score]) => score >= MIN_SCORE)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_N)
        .map(([articleId, score]) => {
          const a = byId.get(articleId)!;
          return {
            articleId,
            npkNumber: a.npkNumber,
            description: a.description,
            unit: a.unit,
            score: Math.round(score * 1000) / 1000,
            unitDiffers: !!t.unit && !!a.unit && t.unit.trim().toLowerCase() !== a.unit.trim().toLowerCase(),
          };
        });
      return { description: t.description, unit: t.unit, npkNumber: t.npkNumber, occurrenceIds: t.occurrenceIds, candidates };
    });

    return {
      enabled: true,
      provider: this.embeddings.name,
      suggestions,
      truncated: { articles: articlesTruncated, texts: textsTruncated },
    };
  }

  /** Splits into the provider's batch size and keeps the inputs' order. */
  private async embedAll(texts: string[], kind: 'query' | 'passage'): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_EMBEDDING_BATCH) {
      out.push(...(await this.embeddings.embed(texts.slice(i, i + MAX_EMBEDDING_BATCH), kind)));
    }
    return out;
  }
}

/** How a score should be presented: never as a decision, only as how hard to look. */
export const scoreBand = (score: number): 'strong' | 'possible' =>
  score >= STRONG_SCORE ? 'strong' : 'possible';
