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

  @Column({ type: 'integer' })
  unitPriceCents: number;

  @Column({ type: 'integer' })
  totalPriceCents: number;

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
