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

@Entity('time_entry')
export class TimeEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => AppUser)
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: true })
  taskId: string | null;

  @ManyToOne(() => Task, { nullable: true })
  @JoinColumn({ name: 'task_id' })
  task: Task | null;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time', nullable: true })
  endTime: string | null;

  @Column({ type: 'integer', default: 0 })
  breakMinutes: number;

  @Column({ type: 'integer', nullable: true })
  normalMinutes: number | null;

  @Column({ type: 'integer', default: 0 })
  overtimeMinutes: number;

  @Column({ type: 'integer', default: 0 })
  travelMinutes: number;

  @Column({ type: 'integer', nullable: true })
  totalMinutes: number | null;

  @Column({ type: 'integer', nullable: true })
  hourlyRateCents: number | null;

  @Column({ type: 'integer', nullable: true })
  costCents: number | null;

  @Column({ type: 'text', default: 'normal' })
  category: string;

  @Column({ type: 'text', default: 'draft' })
  status: string;

  @Column({ type: 'uuid', nullable: true })
  approvedBy: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approver: AppUser | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'real', nullable: true })
  latitude: number | null;

  @Column({ type: 'real', nullable: true })
  longitude: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'boolean', default: false })
  isOfflineEntry: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  syncedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
