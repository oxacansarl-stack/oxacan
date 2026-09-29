import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Unique,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';
import { Client } from '../../crm/entities/client.entity';
import { AppUser } from '../../auth/entities/app-user.entity';
import { InvoiceLine } from './invoice-line.entity';

@Entity('invoice')
@Unique(['companyId', 'invoiceNumber'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid' })
  clientId: string;

  @ManyToOne(() => Client)
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'text' })
  invoiceNumber: string;

  @Column({ type: 'uuid', nullable: true })
  referenceInvoiceId: string | null;

  @ManyToOne(() => Invoice, { nullable: true })
  @JoinColumn({ name: 'reference_invoice_id' })
  referenceInvoice: Invoice | null;

  @Column({ type: 'text', default: 'draft' })
  status: string;

  @Column({ type: 'date', default: () => 'CURRENT_DATE' })
  issueDate: Date;

  @Column({ type: 'date', nullable: true })
  dueDate: Date | null;

  @Column({ type: 'integer' })
  vatRate: number;

  @Column({ type: 'integer', default: 0 })
  subtotalHtCents: number;

  @Column({ type: 'integer', default: 0 })
  vatAmountCents: number;

  @Column({ type: 'integer', default: 0, nullable: true })
  retentionAmountCents: number | null;

  @Column({ type: 'integer', default: 0, nullable: true })
  priorAcomptesCents: number | null;

  @Column({ type: 'integer', default: 0 })
  totalTtcCents: number;

  @Column({ type: 'integer', default: 0, nullable: true })
  amountPaidCents: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', nullable: true })
  paymentTerms: string | null;

  @Column({ type: 'text', nullable: true })
  pdfUrl: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdByUser: AppUser | null;

  @OneToMany(() => InvoiceLine, (line) => line.invoice)
  lines: InvoiceLine[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
