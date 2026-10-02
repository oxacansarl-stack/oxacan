import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CanonicalArticle } from './entities/canonical-article.entity';
import { ArticleAlias } from './entities/article-alias.entity';
import { SourceDocument } from './entities/source-document.entity';
import { SourceOccurrence } from './entities/source-occurrence.entity';
import { PriceObservation } from './entities/price-observation.entity';
import { CatalogueService } from './catalogue.service';
import { CatalogueController } from './catalogue.controller';
import { MatchingService } from './matching.service';
import { ImportReviewService } from './import-review.service';
import { ImportDraft } from './entities/import-draft.entity';
import { ImportDraftRow } from './entities/import-draft-row.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CanonicalArticle,
      ArticleAlias,
      SourceDocument,
      SourceOccurrence,
      PriceObservation,
      ImportDraft,
      ImportDraftRow,
    ]),
  ],
  providers: [CatalogueService, MatchingService, ImportReviewService],
  controllers: [CatalogueController],
  exports: [CatalogueService, MatchingService, ImportReviewService],
})
export class CatalogueModule {}
