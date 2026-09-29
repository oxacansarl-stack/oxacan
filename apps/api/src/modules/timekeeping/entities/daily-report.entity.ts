import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { AppUser } from '../../auth/entities/app-user.entity';
import { Project } from '../../projects/entities/project.entity';

@Entity('daily_report')
@Unique(['companyId', 'userId', 'projectId', 'date'])
export class DailyReport {
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

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'text', nullable: true })
  workDescription: string | null;

  @Column({ type: 'jsonb', default: '[]' })
  materialsUsed: Record<string, unknown>[];

  @Column({ type: 'text', nullable: true })
  weather: string | null;

  @Column({ type: 'real', nullable: true })
  temperatureCelsius: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'jsonb', default: '[]' })
  photos: Record<string, unknown>[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
