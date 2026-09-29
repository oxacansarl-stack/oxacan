import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { PlusValue } from './entities/plus-value.entity';
import { Payment } from '../accounting/entities/payment.entity';
import { Company } from '../company/entities/company.entity';
import { ChartOfAccounts } from '../accounting/entities/chart-of-accounts.entity';
import { JournalEntry } from '../accounting/entities/journal-entry.entity';
import { JournalEntryLine } from '../accounting/entities/journal-entry-line.entity';
import { InvoicingService } from './invoicing.service';
import { InvoicingController } from './invoicing.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceLine,
      PlusValue,
      Payment,
      Company,
      ChartOfAccounts,
      JournalEntry,
      JournalEntryLine,
    ]),
  ],
  providers: [InvoicingService],
  controllers: [InvoicingController],
  exports: [InvoicingService],
})
export class InvoicingModule {}
