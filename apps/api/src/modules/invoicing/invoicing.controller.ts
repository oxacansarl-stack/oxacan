import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { OFFICE_ROLES, Roles } from '../../common/decorators/roles.decorator';
import { InvoicingService } from './invoicing.service';
import {
  CreateInvoiceDto,
  CreatePlusValueDto,
  RecordPaymentDto,
  UpdateInvoiceStatusDto,
  UpdatePlusValueStatusDto,
} from './dto/invoice.dto';

const MAX_PAGE_SIZE = 500;

/** Parses ?page / ?limit; invalid or missing values fall back to the service defaults. */
function parsePaging(page?: string, limit?: string) {
  const p = page ? parseInt(page, 10) : NaN;
  const l = limit ? parseInt(limit, 10) : NaN;
  return {
    page: Number.isInteger(p) && p >= 1 ? p : undefined,
    limit: Number.isInteger(l) && l >= 1 ? Math.min(l, MAX_PAGE_SIZE) : undefined,
  };
}

/** PRD: project managers issue invoices / situations — all invoicing routes are office roles. */
@Controller('invoices')
export class InvoicingController {
  constructor(private readonly service: InvoicingService) {}

  /* ───────────── Project summary (before :id) ───────────── */

  @Get('project/:projectId/summary')
  @Roles(...OFFICE_ROLES)
  async getProjectInvoiceSummary(
    @CompanyId() companyId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.getProjectInvoiceSummary(companyId, projectId);
  }

  /* ───────────── Plus-values (before :id) ───────────── */

  @Get('plus-values')
  @Roles(...OFFICE_ROLES)
  async findAllPlusValues(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAllPlusValues(companyId, {
      ...parsePaging(page, limit),
      projectId,
      status,
    });
  }

  @Post('plus-values')
  @Roles(...OFFICE_ROLES)
  async createPlusValue(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreatePlusValueDto,
  ) {
    return this.service.createPlusValue(companyId, user.id, body);
  }

  @Patch('plus-values/:id/status')
  @Roles(...OFFICE_ROLES)
  async updatePlusValueStatus(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlusValueStatusDto,
  ) {
    return this.service.updatePlusValueStatus(
      companyId,
      id,
      body.status,
      body.approvedByClient,
    );
  }

  /* ───────────── Invoices — CRUD ───────────── */

  @Get()
  @Roles(...OFFICE_ROLES)
  async findAll(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('projectId') projectId?: string,
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.service.findAll(companyId, {
      ...parsePaging(page, limit),
      projectId,
      clientId,
      status,
      type,
    });
  }

  @Get(':id')
  @Roles(...OFFICE_ROLES)
  async findById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(companyId, id);
  }

  @Post()
  @Roles(...OFFICE_ROLES)
  async createInvoice(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreateInvoiceDto,
  ) {
    return this.service.createInvoice(companyId, user.id, body);
  }

  @Patch(':id/status')
  @Roles(...OFFICE_ROLES)
  async updateStatus(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateInvoiceStatusDto,
  ) {
    return this.service.updateStatus(companyId, user.id, id, body.status);
  }

  @Post(':id/credit-note')
  @Roles(...OFFICE_ROLES)
  async createCreditNote(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.createCreditNote(companyId, user.id, id);
  }

  @Post(':id/payments')
  @Roles(...OFFICE_ROLES)
  async recordPayment(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordPaymentDto,
  ) {
    return this.service.recordPayment(companyId, user.id, id, body);
  }
}
