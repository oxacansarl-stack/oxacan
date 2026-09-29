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
import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  OFFICE_ROLES,
  Roles,
  SITE_LEAD_ROLES,
} from '../../common/decorators/roles.decorator';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderLineDto,
  RecordDeliveryDto,
  UpdatePurchaseOrderStatusDto,
} from './dto/purchase-order.dto';
import { PurchaseOrderService } from './purchase-order.service';

@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  @Get()
  @Roles(...OFFICE_ROLES)
  async findAll(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('supplierId') supplierId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      supplierId,
      projectId,
      status,
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
    @CurrentUser() user: { id: string },
    @Body() body: CreatePurchaseOrderDto,
  ) {
    return this.service.create(companyId, user.id, body);
  }

  @Put(':id/status')
  @Roles(...OFFICE_ROLES)
  async updateStatus(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePurchaseOrderStatusDto,
  ) {
    return this.service.updateStatus(companyId, id, body.status);
  }

  @Post(':id/lines')
  @Roles(...OFFICE_ROLES)
  async addLine(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PurchaseOrderLineDto,
  ) {
    return this.service.addLine(companyId, id, body);
  }

  @Delete(':id/lines/:lineId')
  @Roles(...OFFICE_ROLES)
  async removeLine(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.service.removeLine(companyId, id, lineId);
  }

  @Post(':id/lines/:lineId/delivery')
  @Roles(...SITE_LEAD_ROLES)
  async recordDelivery(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() body: RecordDeliveryDto,
  ) {
    return this.service.recordDelivery(companyId, id, lineId, body.deliveredQuantity, body.locationId);
  }
}
