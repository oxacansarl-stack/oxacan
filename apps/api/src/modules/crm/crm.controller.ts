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
import { CrmService } from './crm.service';

@Controller('clients')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  @Get()
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
  async findOne(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.crmService.findClientById(companyId, id);
  }

  @Post()
  async create(
    @CompanyId() companyId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.createClient(companyId, body as Partial<any>);
  }

  @Patch(':id')
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.updateClient(companyId, id, body as Partial<any>);
  }

  @Post(':id/contacts')
  async addContact(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.addContact(companyId, id, body as Partial<any>);
  }

  @Post(':id/interactions')
  async addInteraction(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Body() body: Record<string, unknown>,
  ) {
    return this.crmService.addInteraction(companyId, id, user.id, body as Partial<any>);
  }

  @Patch(':id/stage')
  async updateStage(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('stage') stage: string,
  ) {
    return this.crmService.updatePipelineStage(companyId, id, stage);
  }
}
