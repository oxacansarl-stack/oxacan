import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
} from '@nestjs/common';
import { CompanyId } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  @Get()
  @Roles('ADMIN')
  async findByCompany(@CompanyId() companyId: string) {
    return this.service.findByCompany(companyId);
  }

  @Post()
  @Roles('ADMIN')
  async create(
    @CompanyId() companyId: string,
    @Body()
    body: {
      stripeCustomerId: string;
      tier: string;
      saasSeatCount?: number;
    },
  ) {
    return this.service.create(companyId, body);
  }

  @Put()
  @Roles('ADMIN')
  async update(
    @CompanyId() companyId: string,
    @Body()
    body: {
      tier?: string;
      status?: string;
      saasSeatCount?: number;
      applicationSeatCount?: number;
      stripeSubscriptionId?: string;
      currentPeriodStart?: Date;
      currentPeriodEnd?: Date;
      trialEndsAt?: Date;
    },
  ) {
    return this.service.update(companyId, body);
  }

  @Post('cancel')
  @Roles('ADMIN')
  async cancel(@CompanyId() companyId: string) {
    return this.service.cancel(companyId);
  }

  @Get('billing')
  @Roles('ADMIN')
  async getBillingHistory(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getBillingHistory(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('seats')
  @Roles('ADMIN')
  async checkSeatAvailability(@CompanyId() companyId: string) {
    return this.service.checkSeatAvailability(companyId);
  }
}
