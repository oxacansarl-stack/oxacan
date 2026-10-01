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
  debitCents!: number;

  @IsCents()
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

/* ─── Bank reconciliation ─── */

export const BANK_STATEMENT_FORMATS = ['csv', 'camt053'] as const;

/** 2 MB of statement text; the API's JSON body limit is the tighter bound in practice. */
export const MAX_STATEMENT_CHARS = 2_000_000;

export class ImportBankStatementDto {
  /** The file's text: camt.053 XML or a CSV export. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_STATEMENT_CHARS)
  content!: string;

  /** Detected from the content when omitted (XML → camt053, otherwise csv). */
  @IsOptional()
  @IsIn(BANK_STATEMENT_FORMATS)
  format?: (typeof BANK_STATEMENT_FORMATS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;
}

/** Exactly one of paymentId / invoiceId (checked by BankReconciliationService). */
export class MatchBankLineDto {
  /** Link the line to a payment already recorded on an invoice. */
  @IsOptional()
  @IsUUID()
  paymentId?: string;

  /** Record the line as a payment of this open invoice (InvoicingService.recordPayment). */
  @IsOptional()
  @IsUUID()
  invoiceId?: string;
}
