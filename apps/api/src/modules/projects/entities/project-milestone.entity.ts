import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Project } from './project.entity';
import { ProjectLot } from './project-lot.entity';

@Entity('project_milestone')
export class ProjectMilestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, (project) => project.milestones)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid', nullable: true })
  lotId: string | null;

  @ManyToOne(() => ProjectLot, { nullable: true })
  @JoinColumn({ name: 'lot_id' })
  lot: ProjectLot | null;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'date', nullable: true })
  targetDate: Date | null;

  @Column({ type: 'date', nullable: true })
  completedDate: Date | null;

  @Column({ type: 'text', default: 'pending' })
  status: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
