import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChartOfAccounts } from './entities/chart-of-accounts.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { AccountingService } from './accounting.service';
import { AccountingController } from './accounting.controller';
import { FinancialStatementsService } from './financial-statements.service';
import { BankReconciliationService } from './bank-reconciliation.service';
import { BankReconciliationController } from './bank-reconciliation.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChartOfAccounts,
      JournalEntry,
      JournalEntryLine,
    ]),
    // Bank reconciliation records matched receipts through InvoicingService.recordPayment.
    InvoicingModule,
  ],
  providers: [AccountingService, FinancialStatementsService, BankReconciliationService],
  controllers: [AccountingController, BankReconciliationController],
})
export class AccountingModule {}
