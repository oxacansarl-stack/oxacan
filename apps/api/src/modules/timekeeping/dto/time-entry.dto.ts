import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** DB CHECK constraint on time_entry.category */
export const TIME_ENTRY_CATEGORIES = ['normal', 'overtime', 'travel', 'absence'] as const;

const MAX_DAY_MINUTES = 24 * 60;

export class ClockInDto {
  @IsUUID()
  projectId!: string;

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsIn(TIME_ENTRY_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** When the worker actually tapped clock-in (set by clients that queue offline). */
  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;
}

export class ClockOutDto {
  /** When the worker actually tapped clock-out (set by clients that queue offline). */
  @IsOptional()
  @IsISO8601({ strict: true })
  occurredAt?: string;
}

export class UpdateTimeEntryDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DAY_MINUTES)
  breakMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsIn(TIME_ENTRY_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DAY_MINUTES)
  travelMinutes?: number;

  @IsOptional()
  @IsUUID()
  taskId?: string | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}

export class SubmitTimeEntriesDto {
  /** Omit to submit all of the caller's draft entries. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  entryIds?: string[];
}

export class ApproveTimeEntriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  entryIds!: string[];
}

export class RejectTimeEntriesDto extends ApproveTimeEntriesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
