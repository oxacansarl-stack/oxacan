import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsSignedCents } from '../../../common/validation/decorators';

/** DB CHECK contract_amendment.status */
export const AMENDMENT_STATUSES = ['draft', 'sent', 'signed'] as const;

export class AddContractAmendmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  /** HT, signed: an amendment can add or remove work. Applied to the contract once signed. */
  @IsOptional()
  @IsSignedCents()
  amountDeltaCents?: number;

  @IsOptional()
  @IsIn(AMENDMENT_STATUSES)
  status?: string;
}

export class UpdateContractAmendmentStatusDto {
  @IsIn(AMENDMENT_STATUSES)
  status!: (typeof AMENDMENT_STATUSES)[number];
}
