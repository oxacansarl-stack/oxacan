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
import { ClientContact } from './client-contact.entity';
import { ClientInteraction } from './client-interaction.entity';

@Entity('client')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'text', nullable: true })
  type: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  contactPerson: string | null;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ type: 'text', nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  addressLine1: string | null;

  @Column({ type: 'text', nullable: true })
  addressLine2: string | null;

  @Column({ type: 'text', nullable: true })
  postalCode: string | null;

  @Column({ type: 'text', nullable: true })
  city: string | null;

  @Column({ type: 'text', nullable: true })
  canton: string | null;

  @Column({ type: 'text', default: 'CH' })
  country: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', default: 'prospect' })
  pipelineStage: string;

  @OneToMany(() => ClientContact, (contact) => contact.client)
  contacts: ClientContact[];

  @OneToMany(() => ClientInteraction, (interaction) => interaction.client)
  interactions: ClientInteraction[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
