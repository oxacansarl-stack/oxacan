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
import { Client } from '../../crm/entities/client.entity';
import { ProjectType } from './project-type.entity';
import { OfferLine } from './offer-line.entity';
import { OfferAssumption } from './offer-assumption.entity';

@Entity('offer')
export class Offer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'uuid' })
  clientId: string;

  @ManyToOne(() => Client)
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @Column({ type: 'text' })
  projectName: string;

  @Column({ type: 'uuid', nullable: true })
  projectTypeId: string | null;

  @ManyToOne(() => ProjectType, { nullable: true })
  @JoinColumn({ name: 'project_type_id' })
  projectType: ProjectType | null;

  @Column({ type: 'text', nullable: true })
  reference: string | null;

  @Column({ type: 'text', default: 'draft' })
  status: string;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ type: 'integer', default: 120 })
  marginFactor: number;

  @Column({ type: 'integer', default: 0 })
  totalHtCents: number;

  @Column({ type: 'integer', default: 0 })
  totalVatCents: number;

  @Column({ type: 'integer', default: 0 })
  totalTtcCents: number;

  @Column({ type: 'integer', default: 810 })
  vatRate: number;

  @Column({ type: 'integer', default: 30 })
  validityDays: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy: string | null;

  @OneToMany(() => OfferLine, (line) => line.offer)
  lines: OfferLine[];

  @OneToMany(() => OfferAssumption, (assumption) => assumption.offer)
  assumptions: OfferAssumption[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
