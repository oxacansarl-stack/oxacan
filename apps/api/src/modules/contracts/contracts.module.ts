import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract } from './entities/contract.entity';
import { ContractAmendment } from './entities/contract-amendment.entity';
import { Offer } from '../offers/entities/offer.entity';
import { Company } from '../company/entities/company.entity';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      ContractAmendment,
      Offer,
      Company,
    ]),
    forwardRef(() => ProjectsModule),
  ],
  providers: [ContractsService],
  controllers: [ContractsController],
  exports: [ContractsService],
})
export class ContractsModule {}
