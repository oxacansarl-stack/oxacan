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
import { Supplier } from './supplier.entity';
import { Project } from '../../projects/entities/project.entity';
import { AppUser } from '../../auth/entities/app-user.entity';
import { PurchaseOrderLine } from './purchase-order-line.entity';

@Entity('purchase_order')
export class PurchaseOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  supplierId: string;

  @ManyToOne(() => Supplier)
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @ManyToOne(() => Project, { nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  @Column({ type: 'text' })
  reference: string;

  @Column({ type: 'text', default: 'draft' })
  status: string;

  @Column({ type: 'integer', default: 0 })
  totalHtCents: number;

  @Column({ type: 'timestamptz', nullable: true })
  orderedAt: Date | null;

  @Column({ type: 'date', nullable: true })
  expectedDelivery: Date | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdByUser: AppUser | null;

  @OneToMany(() => PurchaseOrderLine, (line) => line.purchaseOrder)
  lines: PurchaseOrderLine[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
