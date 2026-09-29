import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AccountingService } from './accounting.service';

@Controller('accounting')
export class AccountingController {
  constructor(private readonly service: AccountingService) {}

  /* ═══════════════════════════════════════════════
     Chart of Accounts
     ═══════════════════════════════════════════════ */

  @Get('accounts')
  @Roles('ADMIN')
  async findAllAccounts(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.service.findAllAccounts(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      type,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get('accounts/:id')
  @Roles('ADMIN')
  async findAccountById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findAccountById(companyId, id);
  }

  @Post('accounts')
  @Roles('ADMIN')
  async createAccount(
    @CompanyId() companyId: string,
    @Body()
    body: {
      accountNumber: string;
      name: string;
      type: string;
      parentId?: string;
      isSystem?: boolean;
    },
  ) {
    return this.service.createAccount(companyId, body);
  }

  @Put('accounts/:id')
  @Roles('ADMIN')
  async updateAccount(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      accountNumber?: string;
      name?: string;
      type?: string;
      parentId?: string;
      isActive?: boolean;
    },
  ) {
    return this.service.updateAccount(companyId, id, body);
  }

  @Post('accounts/seed')
  @Roles('ADMIN')
  async seedDefaultAccounts(@CompanyId() companyId: string) {
    return this.service.seedDefaultAccounts(companyId);
  }

  /* ═══════════════════════════════════════════════
     Journal Entries
     ═══════════════════════════════════════════════ */

  @Get('entries')
  @Roles('ADMIN')
  async findAllEntries(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('isPosted') isPosted?: string,
    @Query('referenceType') referenceType?: string,
  ) {
    return this.service.findAllEntries(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      dateFrom,
      dateTo,
      isPosted: isPosted !== undefined ? isPosted === 'true' : undefined,
      referenceType,
    });
  }

  @Get('entries/:id')
  @Roles('ADMIN')
  async findEntryById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findEntryById(companyId, id);
  }

  @Post('entries')
  @Roles('ADMIN')
  async createEntry(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      entryDate: string;
      description: string;
      referenceType?: string;
      referenceId?: string;
      lines: {
        accountId: string;
        debitCents: number;
        creditCents: number;
        description?: string;
      }[];
    },
  ) {
    return this.service.createEntry(companyId, user.id, body);
  }

  @Post('entries/:id/post')
  @Roles('ADMIN')
  async postEntry(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.postEntry(companyId, user.id, id);
  }

  /* ═══════════════════════════════════════════════
     Ledger & Trial Balance
     ═══════════════════════════════════════════════ */

  @Get('ledger/:accountId')
  @Roles('ADMIN')
  async getLedger(
    @CompanyId() companyId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getLedger(companyId, accountId, { dateFrom, dateTo });
  }

  @Get('trial-balance')
  @Roles('ADMIN')
  async getTrialBalance(
    @CompanyId() companyId: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.service.getTrialBalance(companyId, asOfDate);
  }

  /* ═══════════════════════════════════════════════
     Fiduciary Export
     ═══════════════════════════════════════════════ */

  @Get('export/fiduciary')
  @Roles('ADMIN')
  async exportFiduciary(
    @CompanyId() companyId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    return this.service.exportFiduciary(companyId, dateFrom, dateTo);
  }
}
