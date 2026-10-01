import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AppUser } from '../../auth/entities/app-user.entity';
import { Project } from '../../projects/entities/project.entity';
import { Task } from '../../projects/entities/task.entity';

@Entity('expense')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => AppUser)
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @ManyToOne(() => Project, { nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  @Column({ type: 'uuid', nullable: true })
  taskId: string | null;

  @ManyToOne(() => Task, { nullable: true })
  @JoinColumn({ name: 'task_id' })
  task: Task | null;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'text' })
  category: string;

  @Column({ type: 'text' })
  description: string;

  /** TTC total actually paid. */
  @Column({ type: 'bigint' })
  amountCents: number;

  /** Swiss VAT rate in basis points (0 / 260 / 380 / 810); null = unknown. */
  @Column({ type: 'integer', nullable: true })
  vatRateBps: number | null;

  /** VAT contained in amountCents, computed from vatRateBps; null = unknown. */
  @Column({ type: 'bigint', nullable: true })
  vatAmountCents: number | null;

  @Column({ type: 'text', nullable: true })
  receiptUrl: string | null;

  @Column({ type: 'boolean', default: false })
  isBillable: boolean;

  @Column({ type: 'text', default: 'draft' })
  status: string;

  @Column({ type: 'uuid', nullable: true })
  approvedBy: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approver: AppUser | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  rejectedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
