import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeEntry } from './entities/time-entry.entity';
import { Expense } from './entities/expense.entity';
import { DailyReport } from './entities/daily-report.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { Team } from '../hr/entities/team.entity';
import { TeamMember } from '../hr/entities/team-member.entity';
import { Project } from '../projects/entities/project.entity';
import { Task } from '../projects/entities/task.entity';
import { AccessScopeService } from './access-scope.service';
import { TimekeepingService } from './timekeeping.service';
import { TimekeepingController } from './timekeeping.controller';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';
import { DailyReportService } from './daily-report.service';
import { DailyReportController } from './daily-report.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TimeEntry,
      Expense,
      DailyReport,
      AppUser,
      Team,
      TeamMember,
      Project,
      Task,
    ]),
  ],
  providers: [AccessScopeService, TimekeepingService, ExpenseService, DailyReportService],
  controllers: [TimekeepingController, ExpenseController, DailyReportController],
  exports: [AccessScopeService, TimekeepingService, ExpenseService, DailyReportService],
})
export class TimekeepingModule {}
