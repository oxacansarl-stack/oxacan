import { Entity, PrimaryColumn, Column } from 'typeorm';

/** The uploaded plan file itself, one per plan. The bytes are only loaded when downloading. */
@Entity('plan_file')
export class PlanFile {
  @PrimaryColumn({ type: 'uuid' })
  planId: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  contentType: string;

  @Column({ type: 'integer' })
  sizeBytes: number;

  /** Hex SHA-256 of the bytes, so clients can detect an unchanged re-upload. */
  @Column({ type: 'text' })
  sha256: string;

  @Column({ type: 'bytea', select: false })
  data: Buffer;

  @Column({ type: 'uuid', nullable: true })
  uploadedBy: string | null;

  @Column({ type: 'timestamptz' })
  uploadedAt: Date;
}
