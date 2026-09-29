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
import { PlanAnnotation } from './plan-annotation.entity';

@Entity('plan')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ type: 'uuid', nullable: true })
  offerId: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text' })
  fileUrl: string;

  @Column({ type: 'text' })
  fileType: string;

  @Column({ type: 'integer', nullable: true })
  fileSizeBytes: number | null;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ type: 'text', nullable: true })
  scale: string | null;

  @Column({ type: 'text', nullable: true })
  floor: string | null;

  @Column({ type: 'uuid', nullable: true })
  uploadedBy: string | null;

  @OneToMany(() => PlanAnnotation, (annotation) => annotation.plan)
  annotations: PlanAnnotation[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
