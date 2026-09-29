import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PurchaseOrder } from './purchase-order.entity';
import { CanonicalArticle } from '../../catalogue/entities/canonical-article.entity';

@Entity('purchase_order_line')
export class PurchaseOrderLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  purchaseOrderId: string;

  @ManyToOne(() => PurchaseOrder, (po) => po.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'purchase_order_id' })
  purchaseOrder: PurchaseOrder;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid', nullable: true })
  canonicalArticleId: string | null;

  @ManyToOne(() => CanonicalArticle, { nullable: true })
  @JoinColumn({ name: 'canonical_article_id' })
  canonicalArticle: CanonicalArticle | null;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'real' })
  quantity: number;

  @Column({ type: 'text' })
  unit: string;

  @Column({ type: 'bigint' })
  unitPriceCents: number;

  @Column({ type: 'bigint' })
  totalPriceCents: number;

  @Column({ type: 'real', default: 0 })
  deliveredQuantity: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
