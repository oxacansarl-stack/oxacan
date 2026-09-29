import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Offer } from './entities/offer.entity';
import { OfferLine } from './entities/offer-line.entity';
import { OfferAssumption } from './entities/offer-assumption.entity';
import { RoomType } from './entities/room-type.entity';
import { ProjectType } from './entities/project-type.entity';
import { BusinessRule } from './entities/business-rule.entity';
import { PriceObservation } from '../catalogue/entities/price-observation.entity';
import { CanonicalArticle } from '../catalogue/entities/canonical-article.entity';
import { OffersService } from './offers.service';
import { PricingService } from './pricing.service';
import { OffersController } from './offers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Offer,
      OfferLine,
      OfferAssumption,
      RoomType,
      ProjectType,
      BusinessRule,
      PriceObservation,
      CanonicalArticle,
    ]),
  ],
  providers: [OffersService, PricingService],
  controllers: [OffersController],
  exports: [OffersService],
})
export class OffersModule {}
