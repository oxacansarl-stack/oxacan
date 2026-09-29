import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CanonicalArticle } from './entities/canonical-article.entity';
import { ArticleAlias } from './entities/article-alias.entity';
import { SourceDocument } from './entities/source-document.entity';
import { SourceOccurrence } from './entities/source-occurrence.entity';
import { PriceObservation } from './entities/price-observation.entity';
import { CatalogueService } from './catalogue.service';
import { CatalogueController } from './catalogue.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CanonicalArticle,
      ArticleAlias,
      SourceDocument,
      SourceOccurrence,
      PriceObservation,
    ]),
  ],
  providers: [CatalogueService],
  controllers: [CatalogueController],
  exports: [CatalogueService],
})
export class CatalogueModule {}
