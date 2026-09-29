import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('company')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  legalName: string | null;

  @Column({ type: 'text', nullable: true })
  addressLine1: string | null;

  @Column({ type: 'text', nullable: true })
  addressLine2: string | null;

  @Column({ type: 'text', nullable: true })
  postalCode: string | null;

  @Column({ type: 'text', nullable: true })
  city: string | null;

  @Column({ type: 'text', nullable: true })
  canton: string | null;

  @Column({ type: 'text', default: 'CH' })
  country: string;

  @Column({ type: 'text', nullable: true })
  vatNumber: string | null;

  @Column({ type: 'text', nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  website: string | null;

  @Column({ type: 'text', nullable: true })
  logoUrl: string | null;

  @Column({ type: 'integer', default: 810 })
  defaultVatRate: number;

  @Column({ type: 'integer', default: 120 })
  defaultMarginFactor: number;

  @Column({ type: 'integer', default: 500 })
  defaultRetentionRate: number;

  @Column({ type: 'boolean', default: false })
  geolocationEnabled: boolean;

  @Column({ type: 'text', nullable: true })
  subscriptionTier: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
