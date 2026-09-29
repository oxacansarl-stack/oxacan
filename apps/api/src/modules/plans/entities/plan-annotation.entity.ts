import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Plan } from './plan.entity';

@Entity('plan_annotation')
export class PlanAnnotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  planId: string;

  @ManyToOne(() => Plan, (plan) => plan.annotations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan: Plan;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'jsonb' })
  geometry: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  label: string | null;

  @Column({ type: 'text', default: '#FF0000' })
  color: string;

  @Column({ type: 'uuid', nullable: true })
  linkedOfferLineId: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
