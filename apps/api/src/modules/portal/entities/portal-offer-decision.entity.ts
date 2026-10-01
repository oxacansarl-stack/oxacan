import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * The client's answer to a sent offer, given from the portal with a simple electronic signature
 * (typed name + consent box): who, when, from where, to which exact version and amount. One
 * answer per offer. Kept as evidence, so it does not reference the (purgeable) portal link.
 */
@Entity('portal_offer_decision')
export class PortalOfferDecision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @Column({ type: 'uuid' })
  offerId: string;

  @Column({ type: 'uuid' })
  portalTokenId: string;

  /** 'accepted' | 'rejected' */
  @Column({ type: 'text' })
  decision: string;

  @Column({ type: 'text' })
  signerName: string;

  /** The exact declaration the signer agreed to. */
  @Column({ type: 'text' })
  consentText: string;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @Column({ type: 'text', nullable: true })
  offerReference: string | null;

  @Column({ type: 'integer' })
  offerVersion: number;

  @Column({ type: 'bigint' })
  offerTotalTtcCents: number;

  /** SHA-256 of the client view of the offer (lines, selling prices, totals) the answer is about. */
  @Column({ type: 'text' })
  offerDigest: string;

  @Column({ type: 'text', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  decidedAt: Date;
}
