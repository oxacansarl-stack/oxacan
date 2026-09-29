import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CompanyId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles, OFFICE_ROLES } from '../../common/decorators/roles.decorator';
import { CrmService } from './crm.service';
import {
  CreateClientDto,
  UpdateClientDto,
  CreateContactDto,
  CreateInteractionDto,
  UpdateStageDto,
} from './dto/client.dto';

@Controller('clients')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Get()
  @Roles(...OFFICE_ROLES)
  async findAll(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('stage') stage?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
  ) {
    return this.crmService.findAllClients(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      pipelineStage: stage,
      type,
      search,
    });
  }

  @Get(':id')
  @Roles(...OFFICE_ROLES)
  async findOne(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crmService.findClientById(companyId, id);
  }

  @Post()
  @Roles(...OFFICE_ROLES)
  async create(
    @CompanyId() companyId: string,
    @Body() body: CreateClientDto,
  ) {
    return this.crmService.createClient(companyId, body);
  }

  @Patch(':id')
  @Roles(...OFFICE_ROLES)
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateClientDto,
  ) {
    return this.crmService.updateClient(companyId, id, body);
  }

  @Post(':id/contacts')
  @Roles(...OFFICE_ROLES)
  async addContact(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateContactDto,
  ) {
    return this.crmService.addContact(companyId, id, body);
  }

  @Post(':id/interactions')
  @Roles(...OFFICE_ROLES)
  async addInteraction(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreateInteractionDto,
  ) {
    return this.crmService.addInteraction(companyId, id, user.id, body);
  }

  @Patch(':id/stage')
  @Roles(...OFFICE_ROLES)
  async updateStage(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStageDto,
  ) {
    return this.crmService.updatePipelineStage(companyId, id, body.stage);
  }
}
