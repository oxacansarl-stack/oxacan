import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** DB CHECK contract.status */
export const CONTRACT_STATUSES = [
  'draft',
  'sent',
  'signed',
  'active',
  'completed',
  'terminated',
] as const;

export class CreateContractFromOfferDto {
  @IsUUID()
  offerId!: string;
}

export class UpdateContractDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  /** Basis points of the invoice total withheld — 500 = 5 %. NOT NULL column. */
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(10_000)
  retentionRate?: number;
}

export class UpdateContractStatusDto {
  @IsIn(CONTRACT_STATUSES)
  status!: (typeof CONTRACT_STATUSES)[number];
}
