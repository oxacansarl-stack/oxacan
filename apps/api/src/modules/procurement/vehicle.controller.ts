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
import { OFFICE_ROLES, Roles, SITE_LEAD_ROLES } from '../../common/decorators/roles.decorator';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';
import { VehicleService } from './vehicle.service';

@Controller('vehicles')
export class VehicleController {
  constructor(private readonly service: VehicleService) {}

  @Get()
  @Roles(...SITE_LEAD_ROLES)
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
  @Roles(...SITE_LEAD_ROLES)
  async findById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(companyId, id);
  }

  @Post()
  @Roles(...OFFICE_ROLES)
  async create(
    @CompanyId() companyId: string,
    @Body() body: CreateVehicleDto,
  ) {
    return this.service.create(companyId, body);
  }

  @Put(':id')
  @Roles(...OFFICE_ROLES)
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateVehicleDto,
  ) {
    return this.service.update(companyId, id, body);
  }

  @Delete(':id')
  @Roles(...OFFICE_ROLES)
  async delete(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.delete(companyId, id);
    return { message: 'Vehicle deleted' };
  }
}
