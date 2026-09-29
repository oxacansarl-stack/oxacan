import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { BillingEvent } from './entities/billing-event.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import { CreateSubscriptionDto, UpdateSubscriptionDto } from './dto/subscription.dto';


interface AddBillingEventDto {
  subscriptionId: string;
  type: string;
  stripeEventId?: string;
  amountCents?: number;
  metadata?: Record<string, unknown>;
}

interface BillingFilters {
  page?: number;
  limit?: number;
}

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    @InjectRepository(BillingEvent)
    private readonly billingEventRepo: Repository<BillingEvent>,
    @InjectRepository(AppUser)
    private readonly appUserRepo: Repository<AppUser>,
  ) {}

  /* ───────────── Find by Company ───────────── */

  /** A company without a subscription yet is a normal state, not an error. */
  async findCurrent(companyId: string): Promise<Subscription | null> {
    return this.subscriptionRepo.findOne({ where: { companyId } });
  }

  async findByCompany(companyId: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { companyId },
    });
    if (!subscription) throw new NotFoundError('Subscription', companyId);
    return subscription;
  }

  /* ───────────── Create ───────────── */

  async create(
    companyId: string,
    dto: CreateSubscriptionDto,
  ): Promise<Subscription> {
    const existing = await this.subscriptionRepo.findOne({
      where: { companyId },
    });
    if (existing) {
      throw new BusinessRuleError(
        'SUBSCRIPTION_EXISTS',
        'A subscription already exists for this company.',
      );
    }

    const subscription = this.subscriptionRepo.create({
      companyId,
      stripeCustomerId: dto.stripeCustomerId,
      tier: dto.tier,
      saasSeatCount: dto.saasSeatCount ?? 1,
      status: 'trialing',
    });

    return this.subscriptionRepo.save(subscription);
  }

  /* ───────────── Update ───────────── */

  async update(
    companyId: string,
    dto: UpdateSubscriptionDto,
  ): Promise<Subscription> {
    const subscription = await this.findByCompany(companyId);

    if (dto.tier !== undefined) subscription.tier = dto.tier;
    if (dto.status !== undefined) subscription.status = dto.status;
    if (dto.saasSeatCount !== undefined)
      subscription.saasSeatCount = dto.saasSeatCount;
    if (dto.applicationSeatCount !== undefined)
      subscription.applicationSeatCount = dto.applicationSeatCount;
    if (dto.stripeSubscriptionId !== undefined)
      subscription.stripeSubscriptionId = dto.stripeSubscriptionId;
    if (dto.currentPeriodStart !== undefined)
      subscription.currentPeriodStart = dto.currentPeriodStart ? new Date(dto.currentPeriodStart) : null;
    if (dto.currentPeriodEnd !== undefined)
      subscription.currentPeriodEnd = dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : null;
    if (dto.trialEndsAt !== undefined)
      subscription.trialEndsAt = dto.trialEndsAt ? new Date(dto.trialEndsAt) : null;

    return this.subscriptionRepo.save(subscription);
  }

  /* ───────────── Cancel ───────────── */

  async cancel(companyId: string): Promise<Subscription> {
    const subscription = await this.findByCompany(companyId);

    subscription.status = 'cancelled';
    subscription.cancelledAt = new Date();

    return this.subscriptionRepo.save(subscription);
  }

  /* ───────────── Billing Events ───────────── */

  async addBillingEvent(
    companyId: string,
    dto: AddBillingEventDto,
  ): Promise<BillingEvent> {
    const event = this.billingEventRepo.create({
      companyId,
      subscriptionId: dto.subscriptionId,
      type: dto.type,
      stripeEventId: dto.stripeEventId || null,
      amountCents: dto.amountCents ?? null,
      metadata: dto.metadata ?? {},
    });

    return this.billingEventRepo.save(event);
  }

  async getBillingHistory(companyId: string, filters: BillingFilters = {}) {
    const { page = 1, limit = 25 } = filters;

    const [data, total] = await this.billingEventRepo.findAndCount({
      where: { companyId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ───────────── Seat Availability ───────────── */

  async checkSeatAvailability(companyId: string) {
    const subscription = await this.findCurrent(companyId);

    const used = await this.appUserRepo.count({
      where: { companyId, isActive: true },
    });

    const total = subscription?.saasSeatCount ?? 0;

    return {
      used,
      total,
      available: total - used,
    };
  }
}
