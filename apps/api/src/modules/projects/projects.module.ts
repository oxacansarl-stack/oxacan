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
import { TeamMember } from '../hr/entities/team-member.entity';
import { ExecutedQuantity } from './entities/executed-quantity.entity';
import { AccessScopeService } from '../timekeeping/access-scope.service';
import { ExecutedQuantitiesService } from './executed-quantities.service';
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
      TeamMember,
      ExecutedQuantity,
    ]),
    forwardRef(() => ContractsModule),
  ],
  providers: [ProjectsService, TasksService, AccessScopeService, ExecutedQuantitiesService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
