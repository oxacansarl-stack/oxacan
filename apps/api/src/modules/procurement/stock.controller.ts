import {
  Controller,
  Get,
  Post,
  Put,
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
  CreateStockItemDto,
  CreateStockLocationDto,
  CreateStockMovementDto,
  UpdateStockItemDto,
} from './dto/stock.dto';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly service: StockService) {}

  /* ───────────── Locations ───────────── */

  @Get('locations')
  @Roles(...SITE_LEAD_ROLES)
  async findAllLocations(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAllLocations(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Post('locations')
  @Roles(...OFFICE_ROLES)
  async createLocation(
    @CompanyId() companyId: string,
    @Body() body: CreateStockLocationDto,
  ) {
    return this.service.createLocation(companyId, body);
  }

  /* ───────────── Items ───────────── */

  @Get('items')
  @Roles(...SITE_LEAD_ROLES)
  async findAllItems(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('locationId') locationId?: string,
    @Query('articleId') articleId?: string,
    @Query('belowThreshold') belowThreshold?: string,
  ) {
    return this.service.findAllItems(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      locationId,
      articleId,
      belowThreshold: belowThreshold === 'true',
    });
  }

  @Post('items')
  @Roles(...OFFICE_ROLES)
  async createItem(
    @CompanyId() companyId: string,
    @Body() body: CreateStockItemDto,
  ) {
    return this.service.createItem(companyId, body);
  }

  @Put('items/:id')
  @Roles(...OFFICE_ROLES)
  async updateItemQuantity(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStockItemDto,
  ) {
    return this.service.updateItemQuantity(companyId, id, body);
  }

  /* ───────────── Movements ───────────── */

  @Get('movements')
  @Roles(...SITE_LEAD_ROLES)
  async findAllMovements(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('stockItemId') stockItemId?: string,
    @Query('type') type?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.service.findAllMovements(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      stockItemId,
      type,
      projectId,
    });
  }

  @Post('movements')
  @Roles(...SITE_LEAD_ROLES)
  async createMovement(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreateStockMovementDto,
  ) {
    return this.service.createMovement(companyId, user.id, body);
  }
}
