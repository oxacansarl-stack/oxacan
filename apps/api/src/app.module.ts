import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { OffersModule } from './offers/offers.module';
import { ProjectsModule } from './projects/projects.module';
import { InvoicesModule } from './invoices/invoices.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [PrismaModule, AuthModule, CatalogueModule, OffersModule, ProjectsModule, InvoicesModule],
  controllers: [HealthController],
})
export class AppModule {}
