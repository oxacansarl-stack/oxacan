import {
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { ADMIN_ONLY, Roles } from '../../common/decorators/roles.decorator';
import { SubscriptionService } from './subscription.service';

function toPositiveInt(value: string | undefined, max?: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return max ? Math.min(n, max) : n;
}

// Tier, seats, status and billing dates come from billing (Stripe webhook, not built yet) or the
// operators, never from the tenant: there is deliberately no create/update route here.
@Controller('subscription')
@Roles(...ADMIN_ONLY)
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  @Get()
  async findByCompany(@CompanyId() companyId: string) {
    return this.service.findCurrent(companyId);
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
