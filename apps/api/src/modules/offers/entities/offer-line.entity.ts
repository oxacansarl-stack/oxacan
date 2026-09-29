import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Offer } from './offer.entity';
import { CanonicalArticle } from '../../catalogue/entities/canonical-article.entity';

@Entity('offer_line')
export class OfferLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  offerId: string;

  @ManyToOne(() => Offer, (offer) => offer.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_id' })
  offer: Offer;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid', nullable: true })
  canonicalArticleId: string | null;

  @ManyToOne(() => CanonicalArticle, { nullable: true })
  @JoinColumn({ name: 'canonical_article_id' })
  canonicalArticle: CanonicalArticle | null;

  @Column({ type: 'integer' })
  positionNumber: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text' })
  unit: string;

  @Column({ type: 'real' })
  quantity: number;

  @Column({ type: 'bigint', nullable: true })
  unitPriceCents: number | null;

  @Column({ type: 'bigint', nullable: true })
  totalPriceCents: number | null;

  @Column({ type: 'text', nullable: true })
  pricingStrategy: string | null;

  @Column({ type: 'real', nullable: true })
  confidenceScore: number | null;

  @Column({ type: 'text', nullable: true })
  roomType: string | null;

  @Column({ type: 'text', default: 'BASE' })
  variantType: string;

  @Column({ type: 'integer', default: 0 })
  sortOrder: number;

  get isPriced(): boolean {
    return this.unitPriceCents != null;
  }

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
