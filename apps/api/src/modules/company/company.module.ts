import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './entities/company.entity';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';
import { SettingsController } from './settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  providers: [CompanyService],
  controllers: [CompanyController, SettingsController],
  exports: [CompanyService],
})
export class CompanyModule {}
