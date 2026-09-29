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
import { Roles } from '../../common/decorators/roles.decorator';
import { PurchaseOrderService } from './purchase-order.service';

@Controller('purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  @Get()
  @Roles('ADMIN', 'PROJECT_MANAGER')
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
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      supplierId: string;
      projectId?: string;
      lines: {
        description: string;
        quantity: number;
        unit: string;
        unitPriceCents: number;
        canonicalArticleId?: string;
      }[];
    },
  ) {
    return this.service.create(companyId, user.id, body);
  }

  @Put(':id/status')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updateStatus(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string },
  ) {
    return this.service.updateStatus(companyId, id, body.status);
  }

  @Post(':id/lines')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async addLine(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      description: string;
      quantity: number;
      unit: string;
      unitPriceCents: number;
      canonicalArticleId?: string;
    },
  ) {
    return this.service.addLine(companyId, id, body);
  }

  @Delete(':id/lines/:lineId')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async removeLine(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    return this.service.removeLine(companyId, id, lineId);
  }

  @Post(':id/lines/:lineId/delivery')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async recordDelivery(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() body: { deliveredQuantity: number },
  ) {
    return this.service.recordDelivery(companyId, id, lineId, body.deliveredQuantity);
  }
}
