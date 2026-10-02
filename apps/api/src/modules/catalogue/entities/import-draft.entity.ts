import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * What a document was read as, held for a human to confirm or correct before it is imported
 * (PRD §7.3 step 10). Nothing in the catalogue moves until the draft is confirmed.
 */
@Entity('import_draft')
export class ImportDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  /** 'pending' | 'confirmed' | 'discarded' */
  @Column({ type: 'text', default: 'pending' })
  status: string;

  /** 'pdf' | 'csv' */
  @Column({ type: 'text' })
  source: string;

  @Column({ type: 'text' })
  filename: string;

  @Column({ type: 'text', nullable: true })
  projectName: string | null;

  @Column({ type: 'integer', nullable: true })
  projectYear: number | null;

  @Column({ type: 'text', nullable: true })
  entrepreneurName: string | null;

  @Column({ type: 'date', nullable: true })
  documentDate: string | null;

  /** The soumission number printed on the document. */
  @Column({ type: 'text', nullable: true })
  documentReference: string | null;

  @Column({ type: 'integer', nullable: true })
  pageCount: number | null;

  @Column({ type: 'text' })
  contentSha256: string;

  @Column({ type: 'integer', default: 0 })
  rowCount: number;

  /** How many rows carry at least one flag, i.e. how much actually needs looking at. */
  @Column({ type: 'integer', default: 0 })
  flaggedCount: number;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @Column({ type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  /** The import this draft became, once confirmed. */
  @Column({ type: 'uuid', nullable: true })
  sourceDocumentId: string | null;
}
