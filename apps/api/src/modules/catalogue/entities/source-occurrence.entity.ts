import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SourceDocument } from './source-document.entity';
import { CanonicalArticle } from './canonical-article.entity';

/** Immutable after creation — no updated_at column. */
@Entity('source_occurrence')
export class SourceOccurrence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sourceDocumentId: string;

  @ManyToOne(() => SourceDocument, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_document_id' })
  sourceDocument: SourceDocument;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'integer', nullable: true })
  lineNumber: number | null;

  @Column({ type: 'text' })
  rawText: string;

  @Column({ type: 'text', nullable: true })
  npkNumber: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  unit: string | null;

  @Column({ type: 'real', nullable: true })
  quantity: number | null;

  @Column({ type: 'bigint', nullable: true })
  unitPriceCents: number | null;

  @Column({ type: 'bigint', nullable: true })
  totalPriceCents: number | null;

  @Column({ type: 'text', nullable: true })
  roomType: string | null;

  @Column({ type: 'text', nullable: true })
  floor: string | null;

  @Column({ type: 'text', default: 'unmatched' })
  status: string;

  @Column({ type: 'uuid', nullable: true })
  canonicalArticleId: string | null;

  @ManyToOne(() => CanonicalArticle)
  @JoinColumn({ name: 'canonical_article_id' })
  canonicalArticle: CanonicalArticle;

  @Column({ type: 'real', nullable: true })
  matchConfidence: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
