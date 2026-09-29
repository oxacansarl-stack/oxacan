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
import { Roles } from '../../common/decorators/roles.decorator';
import { InvoicingService } from './invoicing.service';

@Controller('invoices')
export class InvoicingController {
  constructor(private readonly service: InvoicingService) {}

  /* ───────────── Project summary (before :id) ───────────── */

  @Get('project/:projectId/summary')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async getProjectInvoiceSummary(
    @CompanyId() companyId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.getProjectInvoiceSummary(companyId, projectId);
  }

  /* ───────────── Plus-values (before :id) ───────────── */

  @Get('plus-values')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async findAllPlusValues(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAllPlusValues(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      projectId,
      status,
    });
  }

  @Post('plus-values')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async createPlusValue(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      projectId: string;
      description: string;
      amountCents: number;
    },
  ) {
    return this.service.createPlusValue(companyId, user.id, body);
  }

  @Patch('plus-values/:id/status')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updatePlusValueStatus(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string; approvedByClient?: boolean },
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
  @Roles('ADMIN', 'PROJECT_MANAGER')
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
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      projectId,
      clientId,
      status,
      type,
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async findById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(companyId, id);
  }

  @Post()
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async createInvoice(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      projectId: string;
      clientId: string;
      type: string;
      vatRate?: number;
      retentionRate?: number;
      lines: {
        description: string;
        unit?: string;
        quantity: number;
        unitPriceCents: number;
        cumulativeQuantity?: number;
        previousQuantity?: number;
      }[];
      notes?: string;
      paymentTerms?: string;
    },
  ) {
    return this.service.createInvoice(companyId, user.id, body);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updateStatus(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string },
  ) {
    return this.service.updateStatus(companyId, id, body.status);
  }

  @Post(':id/credit-note')
  @Roles('ADMIN')
  async createCreditNote(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.createCreditNote(companyId, user.id, id);
  }

  @Post(':id/payments')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async recordPayment(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      amountCents: number;
      paymentDate: string;
      paymentMethod: string;
      reference?: string;
    },
  ) {
    return this.service.recordPayment(companyId, user.id, id, body);
  }
}
