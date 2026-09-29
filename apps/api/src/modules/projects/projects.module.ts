import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './entities/project.entity';
import { ProjectLot } from './entities/project-lot.entity';
import { ProjectMilestone } from './entities/project-milestone.entity';
import { Task } from './entities/task.entity';
import { TaskDependency } from './entities/task-dependency.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { Offer } from '../offers/entities/offer.entity';
import { OfferLine } from '../offers/entities/offer-line.entity';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';
import { ProjectsController } from './projects.controller';
import { ContractsModule } from '../contracts/contracts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectLot,
      ProjectMilestone,
      Task,
      TaskDependency,
      Contract,
      Offer,
      OfferLine,
    ]),
    forwardRef(() => ContractsModule),
  ],
  providers: [ProjectsService, TasksService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
