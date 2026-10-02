import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * One line as the document was read, before anyone has confirmed it. Every field may be corrected
 * by the reviewer; `flags` says why the line deserves a look.
 */
@Entity('import_draft_row')
export class ImportDraftRow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  draftId: string;

  @Column({ type: 'integer' })
  lineNumber: number;

  @Column({ type: 'integer', nullable: true })
  page: number | null;

  @Column({ type: 'text', default: '' })
  rawText: string;

  @Column({ type: 'text', nullable: true })
  npkNumber: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  unit: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 3, nullable: true })
  quantity: string | number | null;

  @Column({ type: 'bigint', nullable: true })
  unitPriceCents: string | number | null;

  @Column({ type: 'bigint', nullable: true })
  totalPriceCents: string | number | null;

  @Column({ type: 'text', nullable: true })
  sectionCode: string | null;

  @Column({ type: 'text', nullable: true })
  roomType: string | null;

  @Column({ type: 'text', nullable: true })
  floor: string | null;

  @Column({ type: 'boolean', default: false })
  isVariant: boolean;

  /** 'pending' | 'edited' | 'excluded' */
  @Column({ type: 'text', default: 'pending' })
  reviewStatus: string;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  flags: string[];

  @Column({ type: 'timestamptz', nullable: true })
  editedAt: Date | null;
}
