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
import { Roles, OFFICE_ROLES } from '../../common/decorators/roles.decorator';
import { ContractsService } from './contracts.service';
import {
  CreateContractFromOfferDto,
  UpdateContractDto,
  UpdateContractStatusDto,
} from './dto/contract.dto';
import { AddContractAmendmentDto } from './dto/contract-amendment.dto';

/** Parses a positive integer query param; falls back on missing/invalid values and clamps to max. */
function positiveInt(value: string | undefined, max?: number): number | undefined {
  const n = value ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return undefined;
  return max ? Math.min(n, max) : n;
}

// PRD: contracts are project-manager / admin work.
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  @Roles(...OFFICE_ROLES)
  async listContracts(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('offerId') offerId?: string,
  ) {
    return this.contractsService.findAll(companyId, {
      page: positiveInt(page),
      limit: positiveInt(limit, 200),
      status,
      clientId,
      offerId,
    });
  }

  @Get(':id')
  @Roles(...OFFICE_ROLES)
  async getContract(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contractsService.findById(companyId, id);
  }

  @Post('from-offer')
  @Roles(...OFFICE_ROLES)
  async createFromOffer(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreateContractFromOfferDto,
  ) {
    return this.contractsService.createFromOffer(companyId, body.offerId, user.id);
  }

  @Patch(':id')
  @Roles(...OFFICE_ROLES)
  async updateContract(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateContractDto,
  ) {
    return this.contractsService.update(companyId, id, body);
  }

  @Patch(':id/status')
  @Roles(...OFFICE_ROLES)
  async updateStatus(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Body() body: UpdateContractStatusDto,
  ) {
    return this.contractsService.updateStatus(companyId, id, user.id, body.status);
  }

  @Post(':id/amendments')
  @Roles(...OFFICE_ROLES)
  async addAmendment(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddContractAmendmentDto,
  ) {
    return this.contractsService.addAmendment(companyId, id, body);
  }
}
