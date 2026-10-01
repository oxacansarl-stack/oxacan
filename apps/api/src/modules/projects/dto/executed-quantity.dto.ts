import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Quantities are NUMERIC(18,6). */
const MAX_QUANTITY = 1_000_000_000;
const quantity = { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 6 };

/**
 * Executed quantity of one offer position. Give exactly one of:
 *  - `quantity`: executed since the last entry (> 0)
 *  - `cumulativeQuantity`: the total executed to date as measured on site; must be above the
 *    position's recorded total (lowering it is a correction).
 */
export class RecordExecutedQuantityDto {
  @IsUUID()
  offerLineId!: string;

  @IsOptional()
  @IsNumber(quantity)
  @Min(0)
  @Max(MAX_QUANTITY)
  quantity?: number;

  @IsOptional()
  @IsNumber(quantity)
  @Min(0)
  @Max(MAX_QUANTITY)
  cumulativeQuantity?: number;

  /** Daily report of this project the measurement comes from. */
  @IsOptional()
  @IsUUID()
  dailyReportId?: string;

  /** Task of this project the work belongs to. */
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/**
 * Correction of an entry: `correctedQuantity` is what that entry should have added to the
 * position (e.g. 8 for an entry of 10 that was really 8). Stored as a new entry with the
 * difference; the corrected entry itself is never changed.
 */
export class CorrectExecutedQuantityDto {
  @IsNumber(quantity)
  @Min(0)
  @Max(MAX_QUANTITY)
  correctedQuantity!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note!: string;
}

export class ValidateExecutedQuantitiesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  entryIds!: string[];
}
