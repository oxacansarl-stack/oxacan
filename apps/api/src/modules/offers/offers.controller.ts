import {
  Controller,
  Get,
  Post,
  Patch,
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
import { OffersService } from './offers.service';
import { PricingService } from './pricing.service';

@Controller('offers')
export class OffersController {
  constructor(
    private readonly offersService: OffersService,
    private readonly pricingService: PricingService,
  ) {}

  @Get()
  async listOffers(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
  ) {
    return this.offersService.findAll(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      clientId,
      search,
    });
  }

  @Get('suggest-articles')
  async suggestArticles(
    @CompanyId() companyId: string,
    @Query('roomType') roomType: string,
  ) {
    return this.pricingService.suggestArticlesForRoom(companyId, roomType);
  }

  @Get(':id')
  async getOffer(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.offersService.findById(companyId, id);
  }

  @Post()
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async createOffer(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      projectName: string;
      clientId: string;
      projectTypeId?: string;
      reference?: string;
      marginFactor?: number;
      vatRate?: number;
      validityDays?: number;
      notes?: string;
    },
  ) {
    return this.offersService.create(companyId, user.id, body);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updateOffer(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      projectName?: string;
      clientId?: string;
      projectTypeId?: string;
      reference?: string;
      marginFactor?: number;
      vatRate?: number;
      validityDays?: number;
      notes?: string;
    },
  ) {
    return this.offersService.update(companyId, id, user.id, body);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updateStatus(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Body() body: { status: string },
  ) {
    return this.offersService.updateStatus(companyId, id, user.id, body.status);
  }

  @Post(':id/lines')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async addLine(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      canonicalArticleId?: string;
      description: string;
      unit: string;
      quantity: number;
      unitPriceCents?: number | null;
      pricingStrategy?: string;
      roomType?: string;
      variantType?: string;
      sortOrder?: number;
    },
  ) {
    return this.offersService.addLine(companyId, id, body);
  }

  @Patch(':id/lines/:lineId')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updateLine(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body()
    body: {
      description?: string;
      unit?: string;
      quantity?: number;
      unitPriceCents?: number | null;
      pricingStrategy?: string;
      roomType?: string;
      variantType?: string;
      sortOrder?: number;
      positionNumber?: number;
    },
  ) {
    return this.offersService.updateLine(companyId, id, lineId, body);
  }

  @Delete(':id/lines/:lineId')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async removeLine(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    await this.offersService.removeLine(companyId, id, lineId);
    return { deleted: true };
  }

  @Post(':id/assumptions')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async addAssumption(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      type: string;
      description: string;
      impactAmountCents?: number;
      status?: string;
    },
  ) {
    return this.offersService.addAssumption(companyId, id, body);
  }

  @Post(':id/recalculate')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async recalculateTotals(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.offersService.recalculateTotals(companyId, id);
  }

  @Post(':id/duplicate')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async duplicateOffer(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.offersService.duplicateOffer(companyId, id, user.id);
  }
}
