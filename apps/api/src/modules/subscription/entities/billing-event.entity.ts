import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Subscription } from './subscription.entity';

@Entity('billing_event')
export class BillingEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  subscriptionId: string;

  @ManyToOne(() => Subscription)
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'text', unique: true, nullable: true })
  stripeEventId: string | null;

  @Column({ type: 'integer', nullable: true })
  amountCents: number | null;

  @Column({ type: 'text', default: 'CHF' })
  currency: string;

  @Column({ type: 'jsonb', default: '{}' })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}
