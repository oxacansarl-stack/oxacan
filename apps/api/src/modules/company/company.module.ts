import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './entities/company.entity';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { SettingsController } from './settings.controller';
import { DataExportService } from './data-export.service';

@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  providers: [CompanyService, DataExportService],
  controllers: [CompanyController, SettingsController],
  exports: [CompanyService],
})
export class CompanyModule {}
