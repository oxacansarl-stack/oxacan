import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';
import { AppUser } from '../../auth/entities/app-user.entity';
import { Invoice } from './invoice.entity';

@Entity('plus_value')
export class PlusValue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'integer' })
  amountCents: number;

  @Column({ type: 'text', default: 'detected' })
  status: string;

  @Column({ type: 'boolean', default: false })
  approvedByClient: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  invoiceId: string | null;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdByUser: AppUser | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
