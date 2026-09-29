import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import { AppUser } from '../../auth/entities/app-user.entity';

@Entity('source_document')
@Unique(['companyId', 'hashSha256'])
export class SourceDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'text' })
  hashSha256: string;

  @Column({ type: 'text' })
  filename: string;

  @Column({ type: 'text', nullable: true })
  projectName: string | null;

  @Column({ type: 'integer', nullable: true })
  projectYear: number | null;

  @Column({ type: 'text', nullable: true })
  entrepreneurName: string | null;

  @Column({ type: 'text', default: 'soumission' })
  documentType: string;

  @Column({ type: 'timestamptz', nullable: true })
  importDate: Date | null;

  @Column({ type: 'text', default: 'imported' })
  status: string;

  @Column({ type: 'integer', default: 0 })
  totalOccurrences: number;

  @Column({ type: 'integer', default: 0 })
  matchedOccurrences: number;

  @Column({ type: 'uuid', nullable: true })
  importedBy: string | null;

  @ManyToOne(() => AppUser)
  @JoinColumn({ name: 'imported_by' })
  importedByUser: AppUser;

  @CreateDateColumn()
  createdAt: Date;
}
