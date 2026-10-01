import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { IsHttpsUrl } from '../../../common/validation/decorators';

/** DB CHECK constraint on plan.file_type */
export const PLAN_FILE_TYPES = ['pdf', 'dwg', 'dxf', 'png', 'jpg'] as const;

/** DB CHECK constraint on plan_annotation.type ('symbol' = a detection from the symbol kit) */
export const ANNOTATION_TYPES = ['pin', 'rectangle', 'polygon', 'text', 'measurement', 'symbol'] as const;

/** Content types accepted for an uploaded plan file (DB CHECK on plan_file.content_type) and the plan.file_type each one sets. */
export const PLAN_UPLOAD_TYPES = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
} as const;
export type PlanUploadType = keyof typeof PLAN_UPLOAD_TYPES;
export const isPlanUploadType = (t: string): t is PlanUploadType =>
  Object.prototype.hasOwnProperty.call(PLAN_UPLOAD_TYPES, t);

/** 25 MiB, DB CHECK on plan_file.size_bytes. The largest real GEE plan is ~11 MB. */
export const PLAN_FILE_MAX_BYTES = 25 * 1024 * 1024;

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @IsHttpsUrl()
  fileUrl!: string;

  @IsIn(PLAN_FILE_TYPES)
  fileType!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fileSizeBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  scale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  floor?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  @IsHttpsUrl()
  fileUrl?: string;

  @IsOptional()
  @IsIn(PLAN_FILE_TYPES)
  fileType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fileSizeBytes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  scale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  floor?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;
}

export class CreateAnnotationDto {
  @IsIn(ANNOTATION_TYPES)
  type!: string;

  /** Shape coordinates (pin point, rectangle bounds, polygon vertices, …). */
  @IsObject()
  geometry!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  label?: string;

  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color must be a hex colour like #FF0000' })
  color?: string;

  @IsOptional()
  @IsUUID()
  linkedOfferLineId?: string;
}
