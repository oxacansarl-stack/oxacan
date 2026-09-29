import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

/** DB CHECK constraint on client.type */
export const CLIENT_TYPES = [
  'entreprise_generale',
  'maitre_ouvrage',
  'architecte',
  'sous_traitant',
  'fournisseur',
  'autre',
] as const;

/** Commercial pipeline (PRD §CRM: prospects → active clients → archived). No DB CHECK. */
export const PIPELINE_STAGES = ['prospect', 'qualified', 'active', 'inactive', 'archived'] as const;

/** DB CHECK constraint on client_interaction.type */
export const INTERACTION_TYPES = ['call', 'email', 'meeting', 'note', 'site_visit'] as const;

export class CreateClientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsIn(CLIENT_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

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
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsIn(PIPELINE_STAGES)
  pipelineStage?: string;
}

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(CLIENT_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

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
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsIn(PIPELINE_STAGES)
  pipelineStage?: string;
}

export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  role?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreateInteractionDto {
  @IsIn(INTERACTION_TYPES)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  /** Timestamp (timestamptz); defaults to NOW() when omitted. */
  @IsOptional()
  @IsISO8601()
  interactionDate?: string;
}

export class UpdateStageDto {
  @IsIn(PIPELINE_STAGES)
  stage!: string;
}
