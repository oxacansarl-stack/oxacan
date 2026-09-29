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
import { IsIsoDate } from '../../../common/validation/decorators';

/** Optional, but when present must not be null (NOT NULL column). */
const IsOptionalNonNull = () => ValidateIf((_obj: unknown, value: unknown) => value !== undefined);

// Allowed values mirror the DB CHECK constraints.
export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'validated', 'cancelled'];
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const DEPENDENCY_TYPES = [
  'finish_to_start',
  'start_to_start',
  'finish_to_finish',
  'start_to_finish',
];

/** Statuses a WORKER may set on a task assigned to them ('validated' is a lead/office sign-off). */
export const WORKER_TASK_STATUSES = ['todo', 'in_progress', 'done'];
/** Fields a WORKER may change on a task assigned to them. */
export const WORKER_TASK_FIELDS = ['status', 'progressPercent'];

const MAX_HOURS = 100_000;

export class CreateTaskDto {
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @IsOptional()
  @IsUUID()
  parentTaskId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsIsoDate()
  plannedStart?: string;

  @IsOptional()
  @IsIsoDate()
  plannedEnd?: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_HOURS)
  estimatedHours?: number;

  @IsOptional()
  @IsUUID()
  assignedTo?: string;
}

export class UpdateTaskDto {
  @IsOptionalNonNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptionalNonNull()
  @IsIn(TASK_STATUSES)
  status?: string;

  @IsOptionalNonNull()
  @IsIn(TASK_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsUUID()
  lotId?: string | null;

  @IsOptional()
  @IsIsoDate()
  plannedStart?: string | null;

  @IsOptional()
  @IsIsoDate()
  plannedEnd?: string | null;

  @IsOptional()
  @IsIsoDate()
  actualStart?: string | null;

  @IsOptional()
  @IsIsoDate()
  actualEnd?: string | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_HOURS)
  estimatedHours?: number | null;

  @IsOptionalNonNull()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_HOURS)
  actualHours?: number;

  @IsOptionalNonNull()
  @IsInt()
  @Min(0)
  @Max(100)
  progressPercent?: number;

  @IsOptional()
  @IsUUID()
  assignedTo?: string | null;
}

export class AddDependencyDto {
  @IsUUID()
  successorId!: string;

  @IsOptional()
  @IsIn(DEPENDENCY_TYPES)
  type?: string;

  @IsOptional()
  @IsInt()
  @Min(-365)
  @Max(365)
  lagDays?: number;
}
