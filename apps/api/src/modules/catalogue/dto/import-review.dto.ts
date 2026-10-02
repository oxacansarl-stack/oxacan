import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsIsoDate, IsSignedCents } from '../../../common/validation/decorators';

export const DRAFT_STATUSES = ['pending', 'confirmed', 'discarded'] as const;

/** A reviewer's correction to one read line. Every field is optional: only what changed is sent. */
export class UpdateDraftRowDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  npkNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1_000_000_000)
  quantity?: number | null;

  @IsOptional()
  @IsSignedCents()
  unitPriceCents?: number | null;

  @IsOptional()
  @IsSignedCents()
  totalPriceCents?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sectionCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  roomType?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  floor?: string | null;

  @IsOptional()
  @IsBoolean()
  isVariant?: boolean;

  /** Drops the line from the import without deleting it, so the decision stays visible. */
  @IsOptional()
  @IsBoolean()
  excluded?: boolean;
}

/** Corrections to what the document said about itself. */
export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  projectName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  projectYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  entrepreneurName?: string;

  @IsOptional()
  @IsIsoDate()
  documentDate?: string;
}

export class ConfirmDraftDto {
  /**
   * Confirms despite lines that still carry a warning. Explicit on purpose: not having noticed a
   * flagged line and having decided it is fine must not look the same afterwards.
   */
  @IsOptional()
  @IsBoolean()
  acceptFlagged?: boolean;
}

export class ListDraftsQueryDto {
  @IsOptional()
  @IsIn(DRAFT_STATUSES)
  status?: string;
}
