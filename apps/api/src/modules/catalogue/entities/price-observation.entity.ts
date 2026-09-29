import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CanonicalArticle } from './canonical-article.entity';
import { SourceOccurrence } from './source-occurrence.entity';

@Entity('price_observation')
export class PriceObservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  canonicalArticleId: string;

  @ManyToOne(() => CanonicalArticle)
  @JoinColumn({ name: 'canonical_article_id' })
  canonicalArticle: CanonicalArticle;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid', nullable: true })
  sourceOccurrenceId: string | null;

  @ManyToOne(() => SourceOccurrence)
  @JoinColumn({ name: 'source_occurrence_id' })
  sourceOccurrence: SourceOccurrence;

  @Column({ type: 'integer' })
  unitPriceCents: number;

  @Column({ type: 'date' })
  observationDate: Date;

  @Column({ type: 'text', nullable: true })
  projectName: string | null;

  @Column({ type: 'text', nullable: true })
  projectType: string | null;

  @Column({ type: 'boolean', default: false })
  isOutlier: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
