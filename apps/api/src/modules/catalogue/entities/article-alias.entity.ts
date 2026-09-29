import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { CanonicalArticle } from './canonical-article.entity';

@Entity('article_alias')
export class ArticleAlias {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  canonicalArticleId: string;

  @ManyToOne(() => CanonicalArticle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'canonical_article_id' })
  canonicalArticle: CanonicalArticle;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  aliasText: string;

  @Column({ type: 'text', nullable: true })
  source: string | null;

  @Column({ type: 'real', nullable: true })
  matchConfidence: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
