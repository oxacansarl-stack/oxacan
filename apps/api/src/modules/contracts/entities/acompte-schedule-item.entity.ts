import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Contract } from './contract.entity';

/** An acompte planned by a contract (PRD §15.6); see ../acompte-schedule.ts for its status and amount. */
@Entity('acompte_schedule_item')
export class AcompteScheduleItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  contractId: string;

  @ManyToOne(() => Contract)
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'date' })
  dueDate: string;

  @Column({ type: 'text', nullable: true })
  label: string | null;

  /** Fixed HT amount; exactly one of amountHtCents / percentBps is set. */
  @Column({ type: 'bigint', nullable: true })
  amountHtCents: number | null;

  /** Basis points of the contract's HT value (1000 = 10 %). */
  @Column({ type: 'integer', nullable: true })
  percentBps: number | null;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
