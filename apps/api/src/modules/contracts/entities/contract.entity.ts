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
import { Offer } from '../../offers/entities/offer.entity';
import { Client } from '../../crm/entities/client.entity';
import { ContractAmendment } from './contract-amendment.entity';

@Entity('contract')
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'uuid' })
  offerId: string;

  @ManyToOne(() => Offer)
  @JoinColumn({ name: 'offer_id' })
  offer: Offer;

  @Column({ type: 'uuid' })
  clientId: string;

  @ManyToOne(() => Client)
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @Column({ type: 'text' })
  reference: string;

  @Column({ type: 'text', default: 'draft' })
  status: string;

  @Column({ type: 'timestamptz', nullable: true })
  signedAt: Date | null;

  @Column({ type: 'bigint' })
  totalTtcCents: number;

  /** Basis points held back on situations (PRD §15.4, "configurable par contrat"); default for its invoices. */
  @Column({ type: 'integer', default: 500 })
  retentionRate: number;

  /** Réception finale (PRD §15.4): from then on the final invoice can release the retention. */
  @Column({ type: 'date', nullable: true })
  finalAcceptanceDate: string | null;

  @Column({ type: 'text', nullable: true })
  finalAcceptanceNotes: string | null;

  @Column({ type: 'uuid', nullable: true })
  finalAcceptanceRecordedBy: string | null;

  @Column({ type: 'text', default: 'swisscom' })
  esignatureProvider: string;

  @Column({ type: 'text', nullable: true })
  esignatureRequestId: string | null;

  @Column({ type: 'text', default: 'none' })
  esignatureStatus: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @OneToMany(() => ContractAmendment, (amendment) => amendment.contract)
  amendments: ContractAmendment[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
