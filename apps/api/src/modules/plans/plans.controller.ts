import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  async findAll(
    @CompanyId() companyId: string,
    @Query('projectId') projectId?: string,
    @Query('offerId') offerId?: string,
    @Query('floor') floor?: string,
  ) {
    return this.plansService.findAll(companyId, {
      projectId,
      offerId,
      floor,
    });
  }

  @Get(':id')
  async findOne(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plansService.findById(companyId, id);
  }

  @Post()
  async create(
    @CompanyId() companyId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.plansService.create(companyId, body as Partial<any>);
  }

  @Patch(':id')
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.plansService.update(companyId, id, body as Partial<any>);
  }

  @Delete(':id')
  async remove(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.plansService.delete(companyId, id);
    return { deleted: true };
  }

  @Post(':id/annotations')
  async addAnnotation(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.plansService.addAnnotation(companyId, id, body as Partial<any>);
  }

  @Delete(':id/annotations/:annotationId')
  async removeAnnotation(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('annotationId', ParseUUIDPipe) annotationId: string,
  ) {
    await this.plansService.removeAnnotation(companyId, id, annotationId);
    return { deleted: true };
  }
}
