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
import { Roles, OFFICE_ROLES } from '../../common/decorators/roles.decorator';
import { OffersService, withLifecycle } from './offers.service';
import { PricingService } from './pricing.service';
import { CreateOfferDto, UpdateOfferDto, UpdateOfferStatusDto } from './dto/offer.dto';
import { AddOfferLineDto, UpdateOfferLineDto } from './dto/offer-line.dto';
import { AddOfferAssumptionDto, UpdateOfferAssumptionDto } from './dto/offer-assumption.dto';

/** Parses a positive integer query param; falls back on missing/invalid values and clamps to max. */
function positiveInt(value: string | undefined, max?: number): number | undefined {
  const n = value ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return undefined;
  return max ? Math.min(n, max) : n;
}

// PRD: offers are project-manager / admin work.
@Controller('offers')
export class OffersController {
  constructor(
    private readonly offersService: OffersService,
    private readonly pricingService: PricingService,
  ) {}

  @Get()
  @Roles(...OFFICE_ROLES)
  async listOffers(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
  ) {
    return this.offersService.findAll(companyId, {
      page: positiveInt(page),
      limit: positiveInt(limit, 200),
      status,
      clientId,
      search,
    });
  }

  @Get('suggest-articles')
  @Roles(...OFFICE_ROLES)
  async suggestArticles(
    @CompanyId() companyId: string,
    @Query('roomType') roomType?: string,
  ) {
    return this.pricingService.suggestArticlesForRoom(companyId, roomType);
  }

  /** Counts and TTC totals per status (open = draft + in_progress + submitted), for the dashboard. */
  @Get('stats')
  @Roles(...OFFICE_ROLES)
  async getStats(@CompanyId() companyId: string) {
    return this.offersService.getStats(companyId);
  }

  @Get(':id')
  @Roles(...OFFICE_ROLES)
  async getOffer(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return withLifecycle(await this.offersService.findById(companyId, id));
  }

  @Post()
  @Roles(...OFFICE_ROLES)
  async createOffer(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreateOfferDto,
  ) {
    return this.offersService.create(companyId, user.id, body);
  }

  @Patch(':id')
  @Roles(...OFFICE_ROLES)
  async updateOffer(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Body() body: UpdateOfferDto,
  ) {
    return this.offersService.update(companyId, id, user.id, body);
  }

  @Patch(':id/status')
  @Roles(...OFFICE_ROLES)
  async updateStatus(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Body() body: UpdateOfferStatusDto,
  ) {
    return this.offersService.updateStatus(companyId, id, user.id, body.status);
  }

  @Post(':id/lines')
  @Roles(...OFFICE_ROLES)
  async addLine(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddOfferLineDto,
  ) {
    return this.offersService.addLine(companyId, id, body);
  }

  @Patch(':id/lines/:lineId')
  @Roles(...OFFICE_ROLES)
  async updateLine(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() body: UpdateOfferLineDto,
  ) {
    return this.offersService.updateLine(companyId, id, lineId, body);
  }

  @Delete(':id/lines/:lineId')
  @Roles(...OFFICE_ROLES)
  async removeLine(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineId', ParseUUIDPipe) lineId: string,
  ) {
    await this.offersService.removeLine(companyId, id, lineId);
    return { deleted: true };
  }

  @Post(':id/assumptions')
  @Roles(...OFFICE_ROLES)
  async addAssumption(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddOfferAssumptionDto,
  ) {
    return this.offersService.addAssumption(companyId, id, body);
  }

  @Patch(':id/assumptions/:assumptionId')
  @Roles(...OFFICE_ROLES)
  async updateAssumption(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assumptionId', ParseUUIDPipe) assumptionId: string,
    @Body() body: UpdateOfferAssumptionDto,
  ) {
    return this.offersService.updateAssumption(companyId, id, assumptionId, body);
  }

  @Post(':id/recalculate')
  @Roles(...OFFICE_ROLES)
  async recalculateTotals(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.offersService.recalculateTotals(companyId, id);
  }

  @Post(':id/duplicate')
  @Roles(...OFFICE_ROLES)
  async duplicateOffer(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.offersService.duplicateOffer(companyId, id, user.id);
  }
}
