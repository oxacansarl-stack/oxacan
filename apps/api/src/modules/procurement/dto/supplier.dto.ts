import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class UpdateSupplierDto {
  // Optional, but never null: the column is NOT NULL.
  @ValidateIf((o) => o.name !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}
