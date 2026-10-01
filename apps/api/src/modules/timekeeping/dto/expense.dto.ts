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
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsCents, IsHttpsUrl, IsIsoDate } from '../../../common/validation/decorators';

/** DB CHECK constraint on expense.category */
export const EXPENSE_CATEGORIES = [
  'material',
  'travel',
  'per_diem',
  'subcontractor',
  'equipment_rental',
  'other',
] as const;

/** Swiss VAT rates in basis points (DB CHECK on expense.vat_rate_bps): 0 %, 2.6 %, 3.8 %, 8.1 %. */
export const SWISS_VAT_RATES_BPS = [0, 260, 380, 810] as const;

/**
 * VAT contained in a TTC amount at `rateBps`, rounded half-up to the centime:
 * amount × rate / (10000 + rate). Integer arithmetic, exact up to the IsCents bound.
 * null rate → null (VAT unknown).
 */
export function vatIncludedCents(amountTtcCents: number, rateBps: number | null | undefined): number | null {
  if (rateBps === null || rateBps === undefined) return null;
  const divisor = 10_000 + rateBps;
  return Math.floor((2 * amountTtcCents * rateBps + divisor) / (2 * divisor));
}

export class CreateExpenseDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsIsoDate()
  date!: string;

  @IsIn(EXPENSE_CATEGORIES)
  category!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;

  /** TTC total actually paid. */
  @IsCents()
  amountCents!: number;

  /** VAT rate in basis points (810 = 8.1 %); null or absent = unknown. The VAT amount is computed. */
  @IsOptional()
  @IsIn(SWISS_VAT_RATES_BPS)
  vatRateBps?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsHttpsUrl()
  receiptUrl?: string;

  @IsOptional()
  @IsBoolean()
  isBillable?: boolean;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  @IsOptional()
  @IsUUID()
  taskId?: string | null;

  @IsOptional()
  @IsIsoDate()
  date?: string;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsCents()
  amountCents?: number;

  /** null clears the rate (VAT unknown); absent keeps it. */
  @IsOptional()
  @IsIn(SWISS_VAT_RATES_BPS)
  vatRateBps?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @ValidateIf((_o, v) => v !== '')
  @IsHttpsUrl()
  receiptUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  isBillable?: boolean;
}

export class ExpenseIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  expenseIds!: string[];
}

export class RejectExpensesDto extends ExpenseIdsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
