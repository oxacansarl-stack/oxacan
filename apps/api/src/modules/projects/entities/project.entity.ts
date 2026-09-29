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
import { Contract } from '../../contracts/entities/contract.entity';
import { Client } from '../../crm/entities/client.entity';
import { AppUser } from '../../auth/entities/app-user.entity';
import { ProjectLot } from './project-lot.entity';
import { ProjectMilestone } from './project-milestone.entity';
import { Task } from './task.entity';

@Entity('project')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'uuid', nullable: true })
  contractId: string | null;

  @ManyToOne(() => Contract, { nullable: true })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract | null;

  @Column({ type: 'uuid' })
  clientId: string;

  @ManyToOne(() => Client)
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @Column({ type: 'text' })
  reference: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', default: 'planning' })
  status: string;

  @Column({ type: 'date', nullable: true })
  startDate: Date | null;

  @Column({ type: 'date', nullable: true })
  endDate: Date | null;

  @Column({ type: 'bigint', nullable: true })
  budgetHtCents: number | null;

  @Column({ type: 'bigint', default: 0 })
  actualCostCents: number;

  @Column({ type: 'integer', default: 0 })
  progressPercent: number;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'text', nullable: true })
  postalCode: string | null;

  @Column({ type: 'text', nullable: true })
  city: string | null;

  @Column({ type: 'real', nullable: true })
  latitude: number | null;

  @Column({ type: 'real', nullable: true })
  longitude: number | null;

  @Column({ type: 'uuid', nullable: true })
  managerId: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'manager_id' })
  manager: AppUser | null;

  @OneToMany(() => ProjectLot, (lot) => lot.project)
  lots: ProjectLot[];

  @OneToMany(() => ProjectMilestone, (milestone) => milestone.project)
  milestones: ProjectMilestone[];

  @OneToMany(() => Task, (task) => task.project)
  tasks: Task[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
