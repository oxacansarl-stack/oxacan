import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeEntry } from './entities/time-entry.entity';
import { Expense } from './entities/expense.entity';
import { DailyReport } from './entities/daily-report.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { TimekeepingService } from './timekeeping.service';
import { TimekeepingController } from './timekeeping.controller';
import { ExpenseService } from './expense.service';
import { ExpenseController } from './expense.controller';
import { DailyReportService } from './daily-report.service';
import { DailyReportController } from './daily-report.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeEntry, Expense, DailyReport, AppUser]),
  ],
  providers: [TimekeepingService, ExpenseService, DailyReportService],
  controllers: [TimekeepingController, ExpenseController, DailyReportController],
  exports: [TimekeepingService, ExpenseService, DailyReportService],
})
export class TimekeepingModule {}
