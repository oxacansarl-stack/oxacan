import { Module } from '@nestjs/common';
import { CatalogueService } from './catalogue.service';
import { CatalogueController } from './catalogue.controller';
@Module({ providers: [CatalogueService], controllers: [CatalogueController], exports: [CatalogueService] })
export class CatalogueModule {}
