import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsCents, IsIsoDate } from '../../../common/validation/decorators';

/**
 * Invoice types that may be created through POST /invoices.
 * DB CHECK invoice.type also allows 'credit_note', but credit notes are only created through
 * POST /invoices/:id/credit-note (which negates the original's amounts and links it).
 */
export const CREATABLE_INVOICE_TYPES = ['invoice', 'situation', 'acompte', 'final_invoice'] as const;

/**
 * Statuses a user may set through PATCH /invoices/:id/status (subset of DB CHECK invoice.status).
 * 'paid' / 'partially_paid' are derived from recorded payments (POST /invoices/:id/payments);
 * 'draft' is excluded so a sent invoice cannot be reverted to draft and then cancelled
 * (sent invoices must be neutralised with a credit note).
 */
export const SETTABLE_INVOICE_STATUSES = ['sent', 'overdue', 'cancelled'] as const;

/** DB CHECK payment.payment_method */
export const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'other'] as const;

/** DB CHECK plus_value.status */
export const PLUS_VALUE_STATUSES = ['detected', 'submitted', 'approved', 'rejected', 'invoiced'] as const;

/*
 * vatRate / retentionRate are integer basis points: 810 = 8.10 %, 500 = 5.00 %
 * (InvoicingService divides by 10 000; invoice.vat_rate is an INTEGER column).
 */
const RATE_MAX_BPS = 10_000;
const MAX_QUANTITY = 1_000_000_000;

export class InvoiceLineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  /**
   * May be decimal (m2, m3, h …). Not needed on a line tied to an offer position: the server
   * stores the position's offer quantity there (the budget the situation is compared with).
   */
  @ValidateIf((l: InvoiceLineDto) => !l.offerLineId || l.quantity !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QUANTITY)
  quantity?: number;

  @IsCents()
  unitPriceCents!: number;

  /**
   * Situations only: the position of the project's contracted offer this line bills. The server
   * computes the quantity earlier situations already billed for it (previousQuantity is no
   * longer accepted from the client) and bills cumulativeQuantity minus that.
   */
  @IsOptional()
  @IsUUID()
  offerLineId?: string;

  /**
   * Situations only, with offerLineId: cumulative quantity executed to date. Must not be below
   * what earlier situations billed. Required for now: no executed quantity is recorded per
   * offer position anywhere else to fall back on (see InvoicingService.situationPositions).
   */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QUANTITY)
  cumulativeQuantity?: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  clientId!: string;

  @IsIn(CREATABLE_INVOICE_TYPES)
  type!: string;

  /** Basis points (810 = 8.10 %). Omitted → company default. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(RATE_MAX_BPS)
  vatRate?: number;

  /** Basis points (500 = 5.00 %). Omitted → company default. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(RATE_MAX_BPS)
  retentionRate?: number;

  /** May be empty when the invoice only bills plus-values; the service requires at least one of the two. */
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];

  /** Approved plus-values of this project to bill on this invoice (each one exactly once). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  plusValueIds?: string[];

  /**
   * Acomptes only: the planned acompte of the project's contract schedule this invoice bills
   * (GET /contracts/:id/acompte-schedule). With no lines and no plus-values, the server bills its
   * planned HT amount on one line.
   */
  @IsOptional()
  @IsUUID()
  acompteScheduleItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  paymentTerms?: string;
}

/** e.g. 'F-{YYYY}-{NNNN}'; rules in parseInvoiceNumberFormat (invoice-number.ts). */
export class UpdateInvoiceNumberFormatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  format!: string;
}

export class UpdateInvoiceStatusDto {
  @IsIn(SETTABLE_INVOICE_STATUSES)
  status!: string;
}

export class RecordPaymentDto {
  @IsCents()
  @Min(1)
  amountCents!: number;

  @IsIsoDate()
  paymentDate!: string;

  @IsIn(PAYMENT_METHODS)
  paymentMethod!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}

export class CreatePlusValueDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @IsCents()
  @Min(1)
  amountCents!: number;
}

export class UpdatePlusValueStatusDto {
  /** 'invoiced' comes only from billing the plus-value on an invoice. */
  @IsIn(PLUS_VALUE_STATUSES.filter((st) => st !== 'invoiced'))
  status!: string;

  @IsOptional()
  @IsBoolean()
  approvedByClient?: boolean;
}
