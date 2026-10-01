import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsISO8601,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsHttpsUrl, IsIsoDate } from '../../../common/validation/decorators';

/** One site photo: a link to the stored image plus optional caption and capture time. */
export class DailyReportPhotoDto {
  @IsString()
  @MaxLength(2048)
  @IsHttpsUrl()
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @IsOptional()
  @IsISO8601()
  takenAt?: string;
}

class DailyReportFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  workDescription?: string | null;

  /** JSONB array of material lines, e.g. [{ name: 'Béton C25/30', quantity: 5, unit: 'm3' }] */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsObject({ each: true })
  materialsUsed?: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  weather?: string | null;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-60)
  @Max(60)
  temperatureCelsius?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string | null;

  /** JSONB array of photo descriptors, e.g. [{ url, caption }] */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DailyReportPhotoDto)
  photos?: DailyReportPhotoDto[];
}

export class CreateDailyReportDto extends DailyReportFieldsDto {
  @IsUUID()
  projectId!: string;

  @IsIsoDate()
  date!: string;
}

export class UpdateDailyReportDto extends DailyReportFieldsDto {}
