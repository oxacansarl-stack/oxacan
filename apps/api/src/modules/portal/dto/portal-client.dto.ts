import { Equals, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const OFFER_DECISIONS = ['accepted', 'rejected'] as const;
export type OfferDecision = (typeof OFFER_DECISIONS)[number];

/** Accepting or refusing a sent offer with a simple electronic signature (typed name + consent box). */
export class PortalOfferDecisionDto {
  @IsIn(OFFER_DECISIONS)
  decision!: OfferDecision;

  /** The signer's full name, typed by them. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  signerName!: string;

  /** The consent box: it must be ticked. */
  @Equals(true, { message: 'consent must be true: the consent box must be ticked.' })
  consent!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class PortalCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  authorName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}
