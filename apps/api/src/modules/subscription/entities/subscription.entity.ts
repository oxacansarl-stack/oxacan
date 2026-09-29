import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('subscription')
@Unique(['companyId'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  stripeCustomerId: string;

  @Column({ type: 'text', nullable: true })
  stripeSubscriptionId: string | null;

  @Column({ type: 'text' })
  tier: string;

  @Column({ type: 'text', default: 'trialing' })
  status: string;

  @Column({ type: 'integer', default: 1 })
  saasSeatCount: number;

  @Column({ type: 'integer', default: 0 })
  applicationSeatCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  trialEndsAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodStart: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
