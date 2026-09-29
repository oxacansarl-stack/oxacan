import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from './project.entity';
import { ProjectLot } from './project-lot.entity';
import { AppUser } from '../../auth/entities/app-user.entity';

@Entity('task')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (project) => project.tasks)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: true })
  lotId: string | null;

  @ManyToOne(() => ProjectLot, { nullable: true })
  @JoinColumn({ name: 'lot_id' })
  lot: ProjectLot | null;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid', nullable: true })
  parentTaskId: string | null;

  @ManyToOne(() => Task, { nullable: true })
  @JoinColumn({ name: 'parent_task_id' })
  parentTask: Task | null;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', default: 'todo' })
  status: string;

  @Column({ type: 'text', default: 'normal' })
  priority: string;

  @Column({ type: 'date', nullable: true })
  plannedStart: Date | null;

  @Column({ type: 'date', nullable: true })
  plannedEnd: Date | null;

  @Column({ type: 'date', nullable: true })
  actualStart: Date | null;

  @Column({ type: 'date', nullable: true })
  actualEnd: Date | null;

  @Column({ type: 'real', nullable: true })
  estimatedHours: number | null;

  @Column({ type: 'real', default: 0 })
  actualHours: number;

  @Column({ type: 'integer', default: 0 })
  progressPercent: number;

  @Column({ type: 'uuid', nullable: true })
  assignedTo: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'assigned_to' })
  assignee: AppUser | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdByUser: AppUser | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
