import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsCents } from '../../../common/validation/decorators';

/** DB CHECK offer_line.pricing_strategy */
export const PRICING_STRATEGIES = ['LATEST', 'MEDIAN_N', 'INDEXED', 'COMPOSED', 'MANUAL'] as const;

/** DB CHECK offer_line.variant_type */
export const VARIANT_TYPES = [
  'BASE',
  'VARIANTE',
  'OPTION',
  'HYPOTHESE_A_VALIDER',
  'INFORMATION_MANQUANTE',
  'EXCLU',
] as const;

const SkipIfUndefined = () => ValidateIf((_o, v) => v !== undefined);
const MAX_QUANTITY = 1_000_000_000;

export class AddOfferLineDto {
  @IsOptional()
  @IsUUID()
  canonicalArticleId?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit!: string;

  /** May be decimal (m2, m3, h …). */
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QUANTITY)
  quantity!: number;

  /** null = "prix à compléter" (blocks submission for BASE lines). */
  @IsOptional()
  @IsCents()
  unitPriceCents?: number | null;

  @IsOptional()
  @IsIn(PRICING_STRATEGIES)
  pricingStrategy?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  roomType?: string | null;

  @IsOptional()
  @IsIn(VARIANT_TYPES)
  variantType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateOfferLineDto {
  @SkipIfUndefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description?: string;

  @SkipIfUndefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit?: string;

  @SkipIfUndefined()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QUANTITY)
  quantity?: number;

  @IsOptional()
  @IsCents()
  unitPriceCents?: number | null;

  @IsOptional()
  @IsIn(PRICING_STRATEGIES)
  pricingStrategy?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  roomType?: string | null;

  @SkipIfUndefined()
  @IsIn(VARIANT_TYPES)
  variantType?: string;

  @SkipIfUndefined()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @SkipIfUndefined()
  @IsInt()
  @Min(1)
  positionNumber?: number;
}
