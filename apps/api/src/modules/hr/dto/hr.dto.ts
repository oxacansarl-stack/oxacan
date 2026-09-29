import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsCents } from '../../../common/validation/decorators';

/** DB CHECK constraints on app_user.role / app_user.licence_tier */
export const USER_ROLES = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER'] as const;
export const LICENCE_TIERS = ['saas', 'application'] as const;

export class CreateTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsUUID()
  leaderId?: string;
}

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  /** null removes the leader. */
  @IsOptional()
  @IsUUID()
  leaderId?: string | null;
}

export class AddTeamMemberDto {
  @IsUUID()
  userId!: string;
}

export class UpdateEmployeeDto {
  /** Hourly rate in CHF centimes; null clears it. */
  @IsOptional()
  @IsCents()
  hourlyRateCents?: number | null;

  @IsOptional()
  @IsIn(USER_ROLES)
  role?: string;

  @IsOptional()
  @IsIn(LICENCE_TIERS)
  licenceTier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  cctCode?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  qualifications?: Record<string, unknown>[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
