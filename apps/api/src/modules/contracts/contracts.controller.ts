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
import { ContractsService } from './contracts.service';

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  async listContracts(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('offerId') offerId?: string,
  ) {
    return this.contractsService.findAll(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      clientId,
      offerId,
    });
  }

  @Get(':id')
  async getContract(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contractsService.findById(companyId, id);
  }

  @Post('from-offer')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async createFromOffer(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: { offerId: string },
  ) {
    return this.contractsService.createFromOffer(companyId, body.offerId, user.id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updateContract(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { notes?: string; retentionRate?: number },
  ) {
    return this.contractsService.update(companyId, id, body);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updateStatus(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Body() body: { status: string },
  ) {
    return this.contractsService.updateStatus(companyId, id, user.id, body.status);
  }

  @Post(':id/amendments')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async addAmendment(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      description: string;
      amountDeltaCents?: number;
      status?: string;
    },
  ) {
    return this.contractsService.addAmendment(companyId, id, body);
  }
}
