import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Invoice } from './invoice.entity';

@Entity('invoice_line')
export class InvoiceLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  invoiceId: string;

  @ManyToOne(() => Invoice, (invoice) => invoice.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', nullable: true })
  unit: string | null;

  @Column({ type: 'real' })
  quantity: number;

  @Column({ type: 'bigint' })
  unitPriceCents: number;

  @Column({ type: 'bigint' })
  totalPriceCents: number;

  /**
   * Situations: the contracted offer position this line bills. Its previous quantity is what
   * earlier situations of the project billed for the same position, computed by the server.
   */
  @Column({ type: 'uuid', nullable: true })
  offerLineId: string | null;

  @Column({ type: 'real', nullable: true })
  cumulativeQuantity: number | null;

  @Column({ type: 'real', nullable: true })
  previousQuantity: number | null;

  @Column({ type: 'real', nullable: true })
  periodQuantity: number | null;

  @Column({ type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
