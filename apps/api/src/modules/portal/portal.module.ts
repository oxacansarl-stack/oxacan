import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PortalToken } from './entities/portal-token.entity';
import { Project } from '../projects/entities/project.entity';
import { ProjectLot } from '../projects/entities/project-lot.entity';
import { ProjectMilestone } from '../projects/entities/project-milestone.entity';
import { Task } from '../projects/entities/task.entity';
import { DailyReport } from '../timekeeping/entities/daily-report.entity';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PortalToken,
      Project,
      ProjectLot,
      ProjectMilestone,
      Task,
      DailyReport,
    ]),
  ],
  providers: [PortalService],
  controllers: [PortalController],
  exports: [PortalService],
})
export class PortalModule {}
