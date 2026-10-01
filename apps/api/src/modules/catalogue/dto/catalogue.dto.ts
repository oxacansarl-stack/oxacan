import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsCents, IsIsoDate, IsSignedCents } from '../../../common/validation/decorators';

export class ComposedComponentDto {
  @IsUUID()
  articleId!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsCents()
  unitPriceCents!: number;
}

export class CreateArticleDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  npkNumber?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;

  @IsOptional()
  @IsBoolean()
  isComposed?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComposedComponentDto)
  composedComponents?: ComposedComponentDto[];
}

export class UpdateArticleDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  npkNumber?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  category?: string;

  @IsOptional()
  @IsBoolean()
  isComposed?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComposedComponentDto)
  composedComponents?: ComposedComponentDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CsvRowDto {
  @IsInt()
  @Min(0)
  lineNumber!: number;

  @IsString()
  @MaxLength(5000)
  rawText!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sectionCode?: string;

  /** Variant / non-added line (not part of the base total, not a price observation). */
  @IsOptional()
  @IsBoolean()
  isVariant?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  npkNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  /** Quantities in source documents may be negative (deduction lines). */
  @IsOptional()
  @IsNumber()
  quantity?: number;

  /** Source documents may carry negative (rabais/deduction) lines. */
  @IsOptional()
  @IsSignedCents()
  unitPriceCents?: number;

  @IsOptional()
  @IsSignedCents()
  totalPriceCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  roomType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  floor?: string;
}

/**
 * Text fields sent with a soumission PDF (multipart/form-data, field "file"). Each overrides what
 * is read from the document itself; multipart values arrive as strings.
 */
export class ImportPdfDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  projectYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  entrepreneurName?: string;

  /** Date the soumission was issued (YYYY-MM-DD); defaults to the date printed on page 1. */
  @IsOptional()
  @IsIsoDate()
  documentDate?: string;
}

export class ImportCsvDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectName?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  projectYear?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  entrepreneurName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  documentType?: string;

  /** Date the soumission was issued (YYYY-MM-DD); its prices are dated by it. */
  @IsOptional()
  @IsIsoDate()
  documentDate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => CsvRowDto)
  rows!: CsvRowDto[];
}
