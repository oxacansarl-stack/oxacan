import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
import { AddContractAmendmentDto, UpdateContractAmendmentStatusDto } from './dto/contract-amendment.dto';
import {
  CreateAcompteScheduleItemDto,
  RecordFinalAcceptanceDto,
  UpdateAcompteScheduleItemDto,
} from './dto/acompte-schedule.dto';

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

  /** Planned acomptes due to be issued, over all contracts (PRD §15.6 "acomptes à émettre"). */
  @Get('acompte-schedule/due')
  @Roles(...OFFICE_ROLES)
  async dueAcomptes(
    @CompanyId() companyId: string,
    @Query('asOf') asOf?: string,
    @Query('withinDays') withinDays?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.contractsService.dueAcomptes(companyId, { asOf, withinDays, projectId });
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

  @Patch(':id/amendments/:amendmentId/status')
  @Roles(...OFFICE_ROLES)
  async updateAmendmentStatus(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('amendmentId', ParseUUIDPipe) amendmentId: string,
    @Body() body: UpdateContractAmendmentStatusDto,
  ) {
    return this.contractsService.updateAmendmentStatus(companyId, id, amendmentId, body.status);
  }

  /* ───────────── Final acceptance (PRD §15.4) ───────────── */

  @Post(':id/final-acceptance')
  @Roles(...OFFICE_ROLES)
  async recordFinalAcceptance(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordFinalAcceptanceDto,
  ) {
    return this.contractsService.recordFinalAcceptance(companyId, id, user.id, body);
  }

  /* ───────────── Acompte schedule (PRD §15.6) ───────────── */

  @Get(':id/acompte-schedule')
  @Roles(...OFFICE_ROLES)
  async listAcompteSchedule(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contractsService.listAcompteSchedule(companyId, id);
  }

  @Post(':id/acompte-schedule')
  @Roles(...OFFICE_ROLES)
  async addAcompteScheduleItem(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAcompteScheduleItemDto,
  ) {
    return this.contractsService.addAcompteScheduleItem(companyId, id, user.id, body);
  }

  @Patch(':id/acompte-schedule/:itemId')
  @Roles(...OFFICE_ROLES)
  async updateAcompteScheduleItem(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: UpdateAcompteScheduleItemDto,
  ) {
    return this.contractsService.updateAcompteScheduleItem(companyId, id, itemId, body);
  }

  @Delete(':id/acompte-schedule/:itemId')
  @Roles(...OFFICE_ROLES)
  async removeAcompteScheduleItem(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.contractsService.removeAcompteScheduleItem(companyId, id, itemId);
  }
}
