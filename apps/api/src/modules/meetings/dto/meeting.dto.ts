import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsIsoDate } from '../../../common/validation/decorators';

/** Optional, but when present must not be null (NOT NULL column). */
const IsOptionalNonNull = () => ValidateIf((_obj: unknown, value: unknown) => value !== undefined);

// Allowed values mirror the DB CHECK constraints.
export const MEETING_STATUSES = ['scheduled', 'in_progress', 'completed'];
export const ACTION_STATUSES = ['open', 'in_progress', 'done', 'cancelled'];
export const ATTENDANCE_VALUES = ['present', 'absent', 'excused'];

export class CreateMeetingDto {
  @IsUUID()
  projectId!: string;

  /** timestamptz — a date (YYYY-MM-DD) or full ISO 8601 date-time. */
  @IsISO8601({ strict: true })
  meetingDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  agenda?: string;
}

export class UpdateMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  agenda?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  minutes?: string;

  @IsOptionalNonNull()
  @IsIn(MEETING_STATUSES)
  status?: string;
}

export class AddAttendeeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string;

  @IsOptional()
  @IsIn(ATTENDANCE_VALUES)
  attendance?: string;
}

export class AddActionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  responsible!: string;

  @IsOptional()
  @IsIsoDate()
  dueDate?: string;
}

export class UpdateActionDto {
  @IsOptionalNonNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description?: string;

  @IsOptionalNonNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  responsible?: string;

  @IsOptional()
  @IsIsoDate()
  dueDate?: string | null;

  @IsOptionalNonNull()
  @IsIn(ACTION_STATUSES)
  status?: string;
}
