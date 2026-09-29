import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsCents, IsIsoDate } from '../../../common/validation/decorators';

/** DB CHECK chart_of_accounts.type */
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;

/** journal_entry_line.debit_cents / credit_cents are INT4 columns. */
const INT4_MAX = 2_147_483_647;

/**
 * On PUT, a field may be omitted but must not be null when the column is NOT NULL.
 * (@IsOptional would let null through and it would reach the database.)
 */
const SkipIfUndefined = () => ValidateIf((_o, v) => v !== undefined);

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  accountNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsIn(ACCOUNT_TYPES)
  type!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  /** System accounts cannot be modified afterwards. */
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;
}

export class UpdateAccountDto {
  @SkipIfUndefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  accountNumber?: string;

  @SkipIfUndefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @SkipIfUndefined()
  @IsIn(ACCOUNT_TYPES)
  type?: string;

  /** null clears the parent. */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @SkipIfUndefined()
  @IsBoolean()
  isActive?: boolean;
}

export class JournalEntryLineDto {
  @IsUUID()
  accountId!: string;

  @IsCents()
  @Max(INT4_MAX)
  debitCents!: number;

  @IsCents()
  @Max(INT4_MAX)
  creditCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class CreateJournalEntryDto {
  @IsIsoDate()
  entryDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceType?: string;

  @IsOptional()
  @IsUUID()
  referenceId?: string;

  /** Balance (Σ debit = Σ credit) is checked by AccountingService (UNBALANCED_ENTRY). */
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  lines!: JournalEntryLineDto[];
}
