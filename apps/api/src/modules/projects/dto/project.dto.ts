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
import { IsCents, IsIsoDate } from '../../../common/validation/decorators';

/** Optional, but when present must not be null (NOT NULL column). */
const IsOptionalNonNull = () => ValidateIf((_obj: unknown, value: unknown) => value !== undefined);

// Allowed values mirror the DB CHECK constraints.
export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
export const MILESTONE_STATUSES = ['pending', 'completed', 'overdue'];

export class UpdateProjectDto {
  @IsOptionalNonNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIsoDate()
  startDate?: string | null;

  @IsOptional()
  @IsIsoDate()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsUUID()
  managerId?: string | null;

  @IsOptionalNonNull()
  @IsIn(PROJECT_STATUSES)
  status?: string;
}

export class AddLotDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsCents()
  budgetCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}

export class AddMilestoneDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsIsoDate()
  targetDate?: string;

  @IsOptional()
  @IsUUID()
  lotId?: string;

  @IsOptional()
  @IsIn(MILESTONE_STATUSES)
  status?: string;
}

export class UpdateMilestoneDto {
  @IsOptionalNonNull()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIsoDate()
  targetDate?: string | null;

  @IsOptional()
  @IsIsoDate()
  completedDate?: string | null;

  @IsOptionalNonNull()
  @IsIn(MILESTONE_STATUSES)
  status?: string;
}
