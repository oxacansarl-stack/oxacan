import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsCents, IsIsoDate } from '../../../common/validation/decorators';

/** DB CHECK constraints on app_user.role / app_user.licence_tier */
export const USER_ROLES = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER'] as const;
export const LICENCE_TIERS = ['saas', 'application'] as const;

/** Emails are compared and stored trimmed and lower-cased (Supabase Auth is case-insensitive too). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

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

/** PRD §19.1 employee record; the person is invited by email (Supabase) to set up their login. */
export class CreateEmployeeDto {
  @Transform(({ value }) => (typeof value === 'string' ? normalizeEmail(value) : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsIn(USER_ROLES)
  role!: string;

  /** Defaults by role (PRD §4.1): workers and team leaders "saas", office roles "application". */
  @IsOptional()
  @IsIn(LICENCE_TIERS)
  licenceTier?: string;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  /** Hourly rate in CHF centimes. */
  @IsOptional()
  @IsCents()
  hourlyRateCents?: number | null;

  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(50)
  cctCode?: string | null;

  @IsOptional()
  @IsIsoDate()
  hireDate?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  qualifications?: Record<string, unknown>[];

  /** Team the new employee joins straight away. */
  @IsOptional()
  @IsUUID()
  teamId?: string;
}
