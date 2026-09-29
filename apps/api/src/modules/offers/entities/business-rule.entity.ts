import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import { CanonicalArticle } from '../../catalogue/entities/canonical-article.entity';
import { RoomType } from './room-type.entity';
import { ProjectType } from './project-type.entity';

@Entity('business_rule')
export class BusinessRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'uuid' })
  canonicalArticleId: string;

  @ManyToOne(() => CanonicalArticle)
  @JoinColumn({ name: 'canonical_article_id' })
  canonicalArticle: CanonicalArticle;

  @Column({ type: 'uuid', nullable: true })
  roomTypeId: string | null;

  @ManyToOne(() => RoomType, { nullable: true })
  @JoinColumn({ name: 'room_type_id' })
  roomType: RoomType | null;

  @Column({ type: 'uuid', nullable: true })
  projectTypeId: string | null;

  @ManyToOne(() => ProjectType, { nullable: true })
  @JoinColumn({ name: 'project_type_id' })
  projectType: ProjectType | null;

  @Column({ type: 'real', nullable: true })
  suggestedQuantity: number | null;

  @Column({ type: 'real', default: 0 })
  confidence: number;

  @Column({ type: 'text', nullable: true })
  source: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
