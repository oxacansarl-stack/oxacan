import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
} from '@nestjs/common';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { ADMIN_ONLY, Roles } from '../../common/decorators/roles.decorator';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto, UpdateSubscriptionDto } from './dto/subscription.dto';

function toPositiveInt(value: string | undefined, max?: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return max ? Math.min(n, max) : n;
}

@Controller('subscription')
@Roles(...ADMIN_ONLY)
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  @Get()
  async findByCompany(@CompanyId() companyId: string) {
    return this.service.findCurrent(companyId);
  }

  @Post()
  async create(
    @CompanyId() companyId: string,
    @Body() body: CreateSubscriptionDto,
  ) {
    return this.service.create(companyId, body);
  }

  @Put()
  async update(
    @CompanyId() companyId: string,
    @Body() body: UpdateSubscriptionDto,
  ) {
    return this.service.update(companyId, body);
  }

  @Post('cancel')
  async cancel(@CompanyId() companyId: string) {
    return this.service.cancel(companyId);
  }

  @Get('billing')
  async getBillingHistory(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getBillingHistory(companyId, {
      page: toPositiveInt(page),
      limit: toPositiveInt(limit, 200),
    });
  }

  @Get('seats')
  async checkSeatAvailability(@CompanyId() companyId: string) {
    return this.service.checkSeatAvailability(companyId);
  }
}
