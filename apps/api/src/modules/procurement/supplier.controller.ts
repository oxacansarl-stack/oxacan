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
import { SupplierService } from './supplier.service';

@Controller('suppliers')
export class SupplierController {
  constructor(private readonly service: SupplierService) {}

  @Get()
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async findAll(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
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
      name: string;
      contactPerson?: string;
      email?: string;
      phone?: string;
      address?: string;
      paymentTermsDays?: number;
      notes?: string;
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
      name?: string;
      contactPerson?: string;
      email?: string;
      phone?: string;
      address?: string;
      paymentTermsDays?: number;
      notes?: string;
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
    return { message: 'Supplier deleted' };
  }
}
