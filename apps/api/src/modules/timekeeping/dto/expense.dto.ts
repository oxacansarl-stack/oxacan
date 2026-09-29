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
} from 'class-validator';
import { IsCents, IsIsoDate } from '../../../common/validation/decorators';

/** DB CHECK constraint on expense.category */
export const EXPENSE_CATEGORIES = [
  'material',
  'travel',
  'per_diem',
  'subcontractor',
  'equipment_rental',
  'other',
] as const;

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

  @IsCents()
  amountCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
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

  @IsOptional()
  @IsString()
  @MaxLength(2048)
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
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
