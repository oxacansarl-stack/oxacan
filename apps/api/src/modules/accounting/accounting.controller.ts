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
  StreamableFile,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  ADMIN_ONLY,
  OFFICE_ROLES,
  Roles,
} from '../../common/decorators/roles.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { AccountingService, FiduciaryFilters } from './accounting.service';
import { FinancialStatementsService, swissToday } from './financial-statements.service';
import {
  FIDUCIARY_CATEGORIES,
  FIDUCIARY_FILES,
  FiduciaryCategory,
  FiduciaryFile,
} from './fiduciary-csv';
import {
  CreateAccountDto,
  CreateJournalEntryDto,
  UpdateAccountDto,
} from './dto/accounting.dto';

const MAX_PAGE_SIZE = 500;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Parses ?page / ?limit; invalid or missing values fall back to the service defaults. */
export function parsePaging(page?: string, limit?: string) {
  const p = page ? parseInt(page, 10) : NaN;
  const l = limit ? parseInt(limit, 10) : NaN;
  return {
    page: Number.isInteger(p) && p >= 1 ? p : undefined,
    limit: Number.isInteger(l) && l >= 1 ? Math.min(l, MAX_PAGE_SIZE) : undefined,
  };
}

/** Optional YYYY-MM-DD query filter; malformed values are a 400 instead of a DB error. */
export function optionalDate(name: string, value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  // The regex alone accepts impossible days such as 2026-02-30; round-trip through UTC to reject them.
  if (!ISO_DATE.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${name} must be a date in YYYY-MM-DD format`);
  }
  return value;
}

/**
 * PRD: accounting (chart of accounts, journal, ledger, trial balance) is direction / ADMIN only.
 * Exception: project managers may export fiduciary data, limited to their own projects (§17.6).
 */
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly service: AccountingService,
    private readonly statements: FinancialStatementsService,
  ) {}

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
     Financial statements (PRD §16.2 Bilan / Compte de résultat)
     ═══════════════════════════════════════════════ */

  /**
   * Balance sheet at ?dateTo= (alias ?asOfDate=, default today in Switzerland), from posted entries.
   * Optional ?dateFrom= splits the unclosed result into "before dateFrom" and "of the period".
   */
  @Get('reports/balance-sheet')
  @Roles(...ADMIN_ONLY)
  async getBalanceSheet(
    @CompanyId() companyId: string,
    @Query('dateTo') dateTo?: string,
    @Query('asOfDate') asOfDate?: string,
    @Query('dateFrom') dateFrom?: string,
  ) {
    const end = optionalDate('dateTo', dateTo ?? asOfDate) ?? swissToday();
    const start = optionalDate('dateFrom', dateFrom) ?? null;
    if (start && start > end) throw new BadRequestException('dateFrom must not be after dateTo');
    return this.statements.balanceSheet(companyId, end, start);
  }

  /** Income statement of [?dateFrom, ?dateTo] (both required), from posted entries. */
  @Get('reports/income-statement')
  @Roles(...ADMIN_ONLY)
  async getIncomeStatement(
    @CompanyId() companyId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const start = optionalDate('dateFrom', dateFrom);
    const end = optionalDate('dateTo', dateTo);
    if (!start || !end) throw new BadRequestException('dateFrom and dateTo are required (YYYY-MM-DD)');
    if (start > end) throw new BadRequestException('dateFrom must not be after dateTo');
    return this.statements.incomeStatement(companyId, start, end);
  }

  /* ═══════════════════════════════════════════════
     Fiduciary Export (PRD §17)
     ═══════════════════════════════════════════════ */

  /**
   * Returns the three §17 files { heures_employes, frais_debours, resume_projets }, each
   * { filename, content, rowCount } (UTF-8 BOM, ';', CRLF, ISO dates), in the standard envelope.
   * Period via ?dateFrom=&dateTo= (aliases ?from=&to=), both required. Optional filters
   * (§17.7): ?projectId=, ?employeeId=, ?category= (materiel|deplacement|equipement|sous-traitance|divers).
   * ADMIN sees everything; a PROJECT_MANAGER only the projects they manage (§17.6).
   */
  @Get('export/fiduciary')
  @Roles(...OFFICE_ROLES)
  async exportFiduciary(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string; role: string },
    @Query() query: Record<string, string | undefined>,
  ) {
    return this.service.exportFiduciary(companyId, user, parseFiduciaryQuery(query));
  }

  /** One §17 file as a raw text/csv download (the exact bytes the fiduciary receives). */
  @Get('export/fiduciary/:file')
  @Roles(...OFFICE_ROLES)
  @SkipEnvelope()
  async downloadFiduciaryFile(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string; role: string },
    @Param('file') file: string,
    @Query() query: Record<string, string | undefined>,
  ) {
    const key = file.replace(/\.csv$/, '') as FiduciaryFile;
    if (!FIDUCIARY_FILES.includes(key)) {
      throw new BadRequestException(`file must be one of: ${FIDUCIARY_FILES.join(', ')}`);
    }
    const result = await this.service.exportFiduciary(companyId, user, parseFiduciaryQuery(query));
    const { filename, content } = result.files[key];
    const bytes = Buffer.from(content, 'utf8');
    return new StreamableFile(bytes, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
      length: bytes.length,
    });
  }
}

/** Validates the fiduciary export query; malformed values are a 400 instead of a DB error. */
function parseFiduciaryQuery(q: Record<string, string | undefined>): FiduciaryFilters {
  const start = optionalDate('dateFrom', q.dateFrom ?? q.from);
  const end = optionalDate('dateTo', q.dateTo ?? q.to);
  if (!start || !end) {
    throw new BadRequestException('dateFrom and dateTo are required (YYYY-MM-DD)');
  }
  if (start > end) {
    throw new BadRequestException('dateFrom must not be after dateTo');
  }
  const uuid = (name: string, value?: string) => {
    if (value === undefined || value === '') return undefined;
    if (!isUUID(value)) throw new BadRequestException(`${name} must be a UUID`);
    return value;
  };
  let category: FiduciaryCategory | undefined;
  if (q.category !== undefined && q.category !== '') {
    if (!(FIDUCIARY_CATEGORIES as readonly string[]).includes(q.category)) {
      throw new BadRequestException(`category must be one of: ${FIDUCIARY_CATEGORIES.join(', ')}`);
    }
    category = q.category as FiduciaryCategory;
  }
  return {
    dateFrom: start,
    dateTo: end,
    projectId: uuid('projectId', q.projectId),
    employeeId: uuid('employeeId', q.employeeId ?? q.userId),
    category,
  };
}
