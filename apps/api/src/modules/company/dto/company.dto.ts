import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/*
 * Rates are integers:
 *   VAT / retention — basis points (810 = 8.10 %, 500 = 5.00 %), 0–10000.
 *   Margin factor   — hundredths (120 = 1.20×), 1–1000.
 */

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  canton?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vatNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logoUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  defaultVatRate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  defaultRetentionRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  defaultMarginFactor?: number;

  @IsOptional()
  @IsBoolean()
  geolocationEnabled?: boolean;
}

export class UpdateSettingsDto {
  /** Logo URL (stored in company.logo_url). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logo?: string;

  @IsOptional()
  @IsBoolean()
  geolocationEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  defaultVatRate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  defaultRetentionRate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  defaultMarginFactor?: number;
}
