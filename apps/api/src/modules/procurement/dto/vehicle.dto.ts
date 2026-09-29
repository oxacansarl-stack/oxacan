import {
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
import { IsIsoDate } from '../../../common/validation/decorators';

export class CreateVehicleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  registration!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsUUID()
  assignedTeamId?: string;

  @IsOptional()
  @IsUUID()
  assignedProjectId?: string;

  @IsOptional()
  @IsIsoDate()
  insuranceExpiry?: string;

  @IsOptional()
  @IsIsoDate()
  nextServiceDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  odometerKm?: number;
}

export class UpdateVehicleDto {
  // Optional, but never null: the column is NOT NULL.
  @ValidateIf((o) => o.registration !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  registration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsUUID()
  assignedTeamId?: string;

  @IsOptional()
  @IsUUID()
  assignedProjectId?: string;

  @IsOptional()
  @IsIsoDate()
  insuranceExpiry?: string;

  @IsOptional()
  @IsIsoDate()
  nextServiceDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  odometerKm?: number;
}
