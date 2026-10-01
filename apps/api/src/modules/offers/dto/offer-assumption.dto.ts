import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsSignedCents } from '../../../common/validation/decorators';

/** DB CHECK offer_assumption.type */
export const ASSUMPTION_TYPES = [
  'VARIANTE',
  'OPTION',
  'HYPOTHESE_A_VALIDER',
  'INFORMATION_MANQUANTE',
  'EXCLU',
] as const;

/** DB CHECK offer_assumption.status */
export const ASSUMPTION_STATUSES = ['open', 'confirmed', 'rejected'] as const;

export class AddOfferAssumptionDto {
  @IsIn(ASSUMPTION_TYPES)
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  /** Signed: an assumption/variant may reduce the price (e.g. an excluded item). */
  @IsOptional()
  @IsSignedCents()
  impactAmountCents?: number | null;

  @IsOptional()
  @IsIn(ASSUMPTION_STATUSES)
  status?: string;
}

/** Decision on an open point: confirm or reject it, optionally with its price impact. */
export class UpdateOfferAssumptionDto {
  @IsIn(ASSUMPTION_STATUSES)
  status!: string;

  @IsOptional()
  @IsSignedCents()
  impactAmountCents?: number | null;
}
