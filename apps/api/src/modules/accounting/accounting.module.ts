import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChartOfAccounts } from './entities/chart-of-accounts.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { Invoice } from '../invoicing/entities/invoice.entity';
import { AccountingService } from './accounting.service';
import { AccountingController } from './accounting.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChartOfAccounts,
      JournalEntry,
      JournalEntryLine,
      Invoice,
    ]),
  ],
  providers: [AccountingService],
  controllers: [AccountingController],
})
export class AccountingModule {}
