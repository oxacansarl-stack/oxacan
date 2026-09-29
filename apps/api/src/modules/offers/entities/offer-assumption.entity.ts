import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Offer } from './offer.entity';

@Entity('offer_assumption')
export class OfferAssumption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  offerId: string;

  @ManyToOne(() => Offer, (offer) => offer.assumptions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_id' })
  offer: Offer;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'integer', nullable: true })
  impactAmountCents: number | null;

  @Column({ type: 'text', default: 'open' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}
