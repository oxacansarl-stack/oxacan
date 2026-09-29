import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { CanonicalArticle } from '../../catalogue/entities/canonical-article.entity';
import { StockLocation } from './stock-location.entity';

@Entity('stock_item')
@Unique(['companyId', 'canonicalArticleId', 'locationId'])
export class StockItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  canonicalArticleId: string;

  @ManyToOne(() => CanonicalArticle)
  @JoinColumn({ name: 'canonical_article_id' })
  canonicalArticle: CanonicalArticle;

  @Column({ type: 'uuid' })
  locationId: string;

  @ManyToOne(() => StockLocation)
  @JoinColumn({ name: 'location_id' })
  location: StockLocation;

  @Column({ type: 'real', default: 0 })
  quantity: number;

  @Column({ type: 'real', nullable: true })
  minThreshold: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
