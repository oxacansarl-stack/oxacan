import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { VehicleService } from './vehicle.service';

@Controller('vehicles')
export class VehicleController {
  constructor(private readonly service: VehicleService) {}

  @Get()
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async findAll(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
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
  async create(
    @CompanyId() companyId: string,
    @Body()
    body: {
      registration: string;
      make?: string;
      model?: string;
      assignedTeamId?: string;
      assignedProjectId?: string;
      insuranceExpiry?: string;
      nextServiceDate?: string;
      odometerKm?: number;
    },
  ) {
    return this.service.create(companyId, body);
  }

  @Put(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      registration?: string;
      make?: string;
      model?: string;
      assignedTeamId?: string;
      assignedProjectId?: string;
      insuranceExpiry?: string;
      nextServiceDate?: string;
      odometerKm?: number;
    },
  ) {
    return this.service.update(companyId, id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async delete(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.delete(companyId, id);
    return { message: 'Vehicle deleted' };
  }
}
