import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, ValueTransformer } from 'typeorm';
import { AppUser } from '../../auth/entities/app-user.entity';

/** NUMERIC columns come back from pg as strings. */
const numeric: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v == null ? null : Number(v)),
};

export type ExecutedQuantityEntryType = 'delta' | 'cumulative' | 'correction';

/**
 * One entry of the append-only executed-quantity ledger of a project's offer position
 * (migration 1727500000030). Never edited: corrections are new entries; only the validation
 * fields are set once, by a project manager.
 */
@Entity('executed_quantity')
export class ExecutedQuantity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @Column({ type: 'uuid' })
  offerLineId: string;

  @Column({ type: 'text' })
  entryType: ExecutedQuantityEntryType;

  /** What this entry adds to the position (negative only for a correction). */
  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numeric })
  quantityDelta: number;

  /** Recorded total of the position right after this entry (validated or not). */
  @Column({ type: 'numeric', precision: 18, scale: 6, transformer: numeric })
  cumulativeQuantity: number;

  @Column({ type: 'uuid', nullable: true })
  correctsEntryId: string | null;

  @Column({ type: 'uuid', nullable: true })
  dailyReportId: string | null;

  @Column({ type: 'uuid', nullable: true })
  taskId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'uuid', name: 'recorded_by' })
  recordedById: string;

  @ManyToOne(() => AppUser)
  @JoinColumn({ name: 'recorded_by' })
  recordedBy: AppUser;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  recordedAt: Date;

  @Column({ type: 'uuid', name: 'validated_by', nullable: true })
  validatedById: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'validated_by' })
  validatedBy: AppUser | null;

  @Column({ type: 'timestamptz', nullable: true })
  validatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
