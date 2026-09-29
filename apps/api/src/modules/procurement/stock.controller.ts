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
import { Roles } from '../../common/decorators/roles.decorator';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly service: StockService) {}

  /* ───────────── Locations ───────────── */

  @Get('locations')
  @Roles('ADMIN', 'PROJECT_MANAGER')
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
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async createLocation(
    @CompanyId() companyId: string,
    @Body() body: { name: string; type: string; address?: string },
  ) {
    return this.service.createLocation(companyId, body);
  }

  /* ───────────── Items ───────────── */

  @Get('items')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
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
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async createItem(
    @CompanyId() companyId: string,
    @Body()
    body: {
      canonicalArticleId: string;
      locationId: string;
      quantity?: number;
      minThreshold?: number;
    },
  ) {
    return this.service.createItem(companyId, body);
  }

  @Put('items/:id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async updateItemQuantity(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { quantity?: number; minThreshold?: number },
  ) {
    return this.service.updateItemQuantity(companyId, id, body);
  }

  /* ───────────── Movements ───────────── */

  @Get('movements')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
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
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async createMovement(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      stockItemId: string;
      type: 'in' | 'out' | 'transfer' | 'adjustment';
      quantity: number;
      fromLocationId?: string;
      toLocationId?: string;
      projectId?: string;
      reference?: string;
    },
  ) {
    return this.service.createMovement(companyId, user.id, body);
  }
}
