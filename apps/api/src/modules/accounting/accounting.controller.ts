import {
  BadRequestException,
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
import {
  ADMIN_ONLY,
  OFFICE_ROLES,
  Roles,
} from '../../common/decorators/roles.decorator';
import { AccountingService } from './accounting.service';
import {
  CreateAccountDto,
  CreateJournalEntryDto,
  UpdateAccountDto,
} from './dto/accounting.dto';

const MAX_PAGE_SIZE = 500;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Parses ?page / ?limit; invalid or missing values fall back to the service defaults. */
function parsePaging(page?: string, limit?: string) {
  const p = page ? parseInt(page, 10) : NaN;
  const l = limit ? parseInt(limit, 10) : NaN;
  return {
    page: Number.isInteger(p) && p >= 1 ? p : undefined,
    limit: Number.isInteger(l) && l >= 1 ? Math.min(l, MAX_PAGE_SIZE) : undefined,
  };
}

/** Optional YYYY-MM-DD query filter; malformed values are a 400 instead of a DB error. */
function optionalDate(name: string, value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!ISO_DATE.test(value)) {
    throw new BadRequestException(`${name} must be a date in YYYY-MM-DD format`);
  }
  return value;
}

/**
 * PRD: accounting (chart of accounts, journal, ledger, trial balance) is direction / ADMIN only.
 * Exception: project managers may export fiduciary data.
 */
@Controller('accounting')
export class AccountingController {
  constructor(private readonly service: AccountingService) {}

  /* ═══════════════════════════════════════════════
     Chart of Accounts
     ═══════════════════════════════════════════════ */

  @Get('accounts')
  @Roles(...ADMIN_ONLY)
  async findAllAccounts(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.service.findAllAccounts(companyId, {
      ...parsePaging(page, limit),
      type,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Get('accounts/:id')
  @Roles(...ADMIN_ONLY)
  async findAccountById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findAccountById(companyId, id);
  }

  @Post('accounts')
  @Roles(...ADMIN_ONLY)
  async createAccount(
    @CompanyId() companyId: string,
    @Body() body: CreateAccountDto,
  ) {
    return this.service.createAccount(companyId, body);
  }

  @Put('accounts/:id')
  @Roles(...ADMIN_ONLY)
  async updateAccount(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAccountDto,
  ) {
    return this.service.updateAccount(companyId, id, body);
  }

  @Post('accounts/seed')
  @Roles(...ADMIN_ONLY)
  async seedDefaultAccounts(@CompanyId() companyId: string) {
    return this.service.seedDefaultAccounts(companyId);
  }

  /* ═══════════════════════════════════════════════
     Journal Entries
     ═══════════════════════════════════════════════ */

  @Get('entries')
  @Roles(...ADMIN_ONLY)
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
      ...parsePaging(page, limit),
      dateFrom: optionalDate('dateFrom', dateFrom),
      dateTo: optionalDate('dateTo', dateTo),
      isPosted: isPosted !== undefined ? isPosted === 'true' : undefined,
      referenceType,
    });
  }

  @Get('entries/:id')
  @Roles(...ADMIN_ONLY)
  async findEntryById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findEntryById(companyId, id);
  }

  @Post('entries')
  @Roles(...ADMIN_ONLY)
  async createEntry(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreateJournalEntryDto,
  ) {
    return this.service.createEntry(companyId, user.id, body);
  }

  @Post('entries/:id/post')
  @Roles(...ADMIN_ONLY)
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
  @Roles(...ADMIN_ONLY)
  async getLedger(
    @CompanyId() companyId: string,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.getLedger(companyId, accountId, {
      dateFrom: optionalDate('dateFrom', dateFrom),
      dateTo: optionalDate('dateTo', dateTo),
    });
  }

  @Get('trial-balance')
  @Roles(...ADMIN_ONLY)
  async getTrialBalance(
    @CompanyId() companyId: string,
    @Query('asOfDate') asOfDate?: string,
  ) {
    return this.service.getTrialBalance(companyId, optionalDate('asOfDate', asOfDate));
  }

  /* ═══════════════════════════════════════════════
     Fiduciary Export
     ═══════════════════════════════════════════════ */

  /**
   * Returns { journalCsv, balanceCsv, clientCsv } (semicolon-separated, UTF-8 BOM) in the
   * standard envelope. Date range via ?dateFrom=&dateTo= (aliases ?from=&to=), both required.
   */
  @Get('export/fiduciary')
  @Roles(...OFFICE_ROLES)
  async exportFiduciary(
    @CompanyId() companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const start = optionalDate('dateFrom', dateFrom ?? from);
    const end = optionalDate('dateTo', dateTo ?? to);
    if (!start || !end) {
      throw new BadRequestException('dateFrom and dateTo are required (YYYY-MM-DD)');
    }
    if (start > end) {
      throw new BadRequestException('dateFrom must not be after dateTo');
    }
    return this.service.exportFiduciary(companyId, start, end);
  }
}
