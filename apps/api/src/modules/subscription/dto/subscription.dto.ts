import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Optional, but when present must not be null (NOT NULL column). */
const IsOptionalNonNull = () => ValidateIf((_obj: unknown, value: unknown) => value !== undefined);

// Allowed values mirror the DB CHECK constraints.
export const SUBSCRIPTION_TIERS = ['solo', 'equipe', 'entreprise'];
export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled', 'paused'];

const MAX_SEATS = 10_000;

export class CreateSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  stripeCustomerId!: string;

  @IsIn(SUBSCRIPTION_TIERS)
  tier!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS)
  saasSeatCount?: number;
}

export class UpdateSubscriptionDto {
  @IsOptionalNonNull()
  @IsIn(SUBSCRIPTION_TIERS)
  tier?: string;

  @IsOptionalNonNull()
  @IsIn(SUBSCRIPTION_STATUSES)
  status?: string;

  @IsOptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS)
  saasSeatCount?: number;

  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  @Max(MAX_SEATS)
  applicationSeatCount?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  stripeSubscriptionId?: string;

  /** timestamptz fields — ISO 8601 date-time. */
  @IsOptional()
  @IsISO8601({ strict: true })
  currentPeriodStart?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  currentPeriodEnd?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  trialEndsAt?: string;
}
