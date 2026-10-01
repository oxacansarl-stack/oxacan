import {
  ArrayMaxSize,
  IsArray,
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
import { VARIANT_TYPES } from '../offer-pricing';

/** DB CHECK offer_line.pricing_strategy */
export const PRICING_STRATEGIES = ['LATEST', 'MEDIAN_N', 'INDEXED', 'COMPOSED', 'MANUAL'] as const;

/** DB CHECK offer_line.variant_type; their meaning for totals and documents is in offer-pricing.ts. */
export { VARIANT_TYPES };

const SkipIfUndefined = () => ValidateIf((_o, v) => v !== undefined);
const MAX_QUANTITY = 1_000_000_000;
const MAX_EVIDENCE = 100;

/**
 * Traceability of a proposed line (§11.2): the rule that proposed it, how confident the engine is
 * (R008, 0–1) and the source lines it rests on (R007). All optional: a manual line has none.
 */
class LineTraceabilityFields {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  ruleId?: string | null;

  /**
   * Combined score (0–1). Normally computed by the engine as the weakest of the four dimensions
   * below (§7.7); when sent, it is stored as sent for this write (the proposer's own overall
   * confidence, R008).
   */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  confidenceScore?: number | null;

  /**
   * Dimensions a proposer (rule engine, AI) may assess itself, 0–1 (§7.7); computed when absent.
   * The price dimension is always computed from the price actually stored.
   */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  confidenceClassification?: number | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  confidenceMapping?: number | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  confidenceRule?: number | null;

  /** Source occurrence ids or references; null is not allowed (send [] to clear). */
  @SkipIfUndefined()
  @IsArray()
  @ArrayMaxSize(MAX_EVIDENCE)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(200, { each: true })
  evidence?: string[];
}

export class AddOfferLineDto extends LineTraceabilityFields {
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

export class UpdateOfferLineDto extends LineTraceabilityFields {
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
