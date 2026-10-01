import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { IsIsoDate } from '../../../common/validation/decorators';

const MAX_CENTS = 100_000_000_000;

/** A planned acompte: a due date and either a fixed HT amount or a percentage of the contract's HT value. */
export class CreateAcompteScheduleItemDto {
  @IsIsoDate()
  dueDate!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  label?: string;

  /** Fixed HT amount in centimes. Give this or percentBps, not both. */
  @ValidateIf((o: CreateAcompteScheduleItemDto) => o.amountHtCents !== undefined || o.percentBps === undefined)
  @IsInt()
  @Min(1)
  @Max(MAX_CENTS)
  amountHtCents?: number;

  /** Basis points of the contract's HT value (1000 = 10 %). Give this or amountHtCents, not both. */
  @ValidateIf((o: CreateAcompteScheduleItemDto) => o.percentBps !== undefined || o.amountHtCents === undefined)
  @IsInt()
  @Min(1)
  @Max(10_000)
  percentBps?: number;
}

/** Changes a planned acompte that nothing bills yet. Setting amountHtCents clears percentBps and vice versa. */
export class UpdateAcompteScheduleItemDto {
  @IsOptional()
  @IsIsoDate()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  label?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_CENTS)
  amountHtCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  percentBps?: number;
}

/** Réception finale of the works (PRD §15.4): releases the retention on the final invoice. */
export class RecordFinalAcceptanceDto {
  @IsIsoDate()
  acceptedOn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
