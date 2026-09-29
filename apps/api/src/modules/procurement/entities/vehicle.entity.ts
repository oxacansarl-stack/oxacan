import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Team } from '../../hr/entities/team.entity';
import { Project } from '../../projects/entities/project.entity';
import { StockLocation } from './stock-location.entity';

@Entity('vehicle')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  registration: string;

  @Column({ type: 'text', nullable: true })
  make: string | null;

  @Column({ type: 'text', nullable: true })
  model: string | null;

  @Column({ type: 'uuid', nullable: true })
  assignedTeamId: string | null;

  @ManyToOne(() => Team, { nullable: true })
  @JoinColumn({ name: 'assigned_team_id' })
  assignedTeam: Team | null;

  @Column({ type: 'uuid', nullable: true })
  assignedProjectId: string | null;

  @ManyToOne(() => Project, { nullable: true })
  @JoinColumn({ name: 'assigned_project_id' })
  assignedProject: Project | null;

  @Column({ type: 'date', nullable: true })
  insuranceExpiry: Date | null;

  @Column({ type: 'date', nullable: true })
  nextServiceDate: Date | null;

  @Column({ type: 'integer', nullable: true })
  odometerKm: number | null;

  @Column({ type: 'uuid', nullable: true })
  stockLocationId: string | null;

  @ManyToOne(() => StockLocation, { nullable: true })
  @JoinColumn({ name: 'stock_location_id' })
  stockLocation: StockLocation | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
