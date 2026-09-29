import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** DB CHECK offer.status */
export const OFFER_STATUSES = [
  'draft',
  'in_progress',
  'submitted',
  'accepted',
  'rejected',
  'archived',
] as const;

/**
 * On PATCH, a field may be omitted but must not be null when the column is NOT NULL.
 * (@IsOptional would let null through and it would reach the database.)
 */
const SkipIfUndefined = () => ValidateIf((_o, v) => v !== undefined);

/*
 * marginFactor: integer percent of cost — 120 = ×1.20 (OffersService.recalculateTotals divides by 100).
 * vatRate: integer basis points — 810 = 8.10 % (divided by 10 000).
 */
const MARGIN_MIN = 1;
const MARGIN_MAX = 1000;
const VAT_MAX_BPS = 10_000;

export class CreateOfferDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  projectName!: string;

  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsUUID()
  projectTypeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string | null;

  @IsOptional()
  @IsInt()
  @Min(MARGIN_MIN)
  @Max(MARGIN_MAX)
  marginFactor?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(VAT_MAX_BPS)
  vatRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  validityDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class UpdateOfferDto {
  @SkipIfUndefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  projectName?: string;

  @SkipIfUndefined()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  projectTypeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string | null;

  @SkipIfUndefined()
  @IsInt()
  @Min(MARGIN_MIN)
  @Max(MARGIN_MAX)
  marginFactor?: number;

  @SkipIfUndefined()
  @IsInt()
  @Min(0)
  @Max(VAT_MAX_BPS)
  vatRate?: number;

  @SkipIfUndefined()
  @IsInt()
  @Min(1)
  @Max(365)
  validityDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class UpdateOfferStatusDto {
  @IsIn(OFFER_STATUSES)
  status!: (typeof OFFER_STATUSES)[number];
}
