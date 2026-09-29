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
} from 'class-validator';
import { IsIsoDate } from '../../../common/validation/decorators';

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
  @IsObject({ each: true })
  photos?: Record<string, unknown>[];
}

export class CreateDailyReportDto extends DailyReportFieldsDto {
  @IsUUID()
  projectId!: string;

  @IsIsoDate()
  date!: string;
}

export class UpdateDailyReportDto extends DailyReportFieldsDto {}
