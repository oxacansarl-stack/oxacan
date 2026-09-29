import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';

@Entity('canonical_article')
export class CanonicalArticle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'text', nullable: true })
  npkNumber: string | null;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text' })
  unit: string;

  @Column({ type: 'text', nullable: true })
  category: string | null;

  @Column({ type: 'boolean', default: false })
  isComposed: boolean;

  @Column({ type: 'jsonb', nullable: true })
  composedComponents: Array<{
    articleId: string;
    quantity: number;
    unitPriceCents: number;
  }> | null;

  @Column({ type: 'bigint', nullable: true })
  medianPriceCents: number | null;

  @Column({ type: 'bigint', nullable: true })
  minPriceCents: number | null;

  @Column({ type: 'bigint', nullable: true })
  maxPriceCents: number | null;

  @Column({ type: 'integer', default: 0 })
  observationCount: number;

  @Column({ type: 'date', nullable: true })
  lastPriceDate: Date | null;

  @Column({ type: 'real', default: 0 })
  confidenceClassification: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
