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
import { OFFICE_ROLES, Roles } from '../../common/decorators/roles.decorator';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { SupplierService } from './supplier.service';

@Controller('suppliers')
export class SupplierController {
  constructor(private readonly service: SupplierService) {}

  @Get()
  @Roles(...OFFICE_ROLES)
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
  @Roles(...OFFICE_ROLES)
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
    @Body() body: CreateSupplierDto,
  ) {
    return this.service.create(companyId, body);
  }

  @Put(':id')
  @Roles(...OFFICE_ROLES)
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSupplierDto,
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
    return { message: 'Supplier deleted' };
  }
}
