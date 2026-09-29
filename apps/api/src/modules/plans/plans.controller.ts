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
import { Roles, ALL_ROLES, OFFICE_ROLES } from '../../common/decorators/roles.decorator';
import { PlansService } from './plans.service';
import { CreatePlanDto, UpdatePlanDto, CreateAnnotationDto } from './dto/plan.dto';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  /** Site staff read building plans, so reads are open to all roles. */
  @Get()
  @Roles(...ALL_ROLES)
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
  @Roles(...ALL_ROLES)
  async findOne(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plansService.findById(companyId, id);
  }

  @Post()
  @Roles(...OFFICE_ROLES)
  async create(
    @CompanyId() companyId: string,
    @Body() body: CreatePlanDto,
  ) {
    return this.plansService.create(companyId, body);
  }

  @Patch(':id')
  @Roles(...OFFICE_ROLES)
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlanDto,
  ) {
    return this.plansService.update(companyId, id, body);
  }

  @Delete(':id')
  @Roles(...OFFICE_ROLES)
  async remove(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.plansService.delete(companyId, id);
    return { deleted: true };
  }

  @Post(':id/annotations')
  @Roles(...OFFICE_ROLES)
  async addAnnotation(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateAnnotationDto,
  ) {
    return this.plansService.addAnnotation(companyId, id, body);
  }

  @Delete(':id/annotations/:annotationId')
  @Roles(...OFFICE_ROLES)
  async removeAnnotation(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('annotationId', ParseUUIDPipe) annotationId: string,
  ) {
    await this.plansService.removeAnnotation(companyId, id, annotationId);
    return { deleted: true };
  }
}
