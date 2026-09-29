import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';

@Entity('contract_amendment')
export class ContractAmendment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contractId: string;

  @ManyToOne(() => Contract, (contract) => contract.amendments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'integer' })
  amendmentNumber: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'integer', default: 0 })
  amountDeltaCents: number;

  @Column({ type: 'text', default: 'draft' })
  status: string;

  @Column({ type: 'timestamptz', nullable: true })
  signedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
