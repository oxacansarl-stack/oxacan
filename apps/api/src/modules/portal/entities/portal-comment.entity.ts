import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** A comment the client left on the project from the portal (PRD §21.3 "Laisser un commentaire"). */
@Entity('portal_comment')
export class PortalComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  projectId: string;

  /** The link it was written through. No FK: expired links are purged, the comment stays. */
  @Column({ type: 'uuid' })
  portalTokenId: string;

  @Column({ type: 'text' })
  authorName: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'text', nullable: true })
  ipAddress: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
