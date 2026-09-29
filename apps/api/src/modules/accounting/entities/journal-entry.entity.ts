import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Unique,
} from 'typeorm';
import { AppUser } from '../../auth/entities/app-user.entity';
import { JournalEntryLine } from './journal-entry-line.entity';

@Entity('journal_entry')
@Unique(['companyId', 'entryNumber'])
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'integer' })
  entryNumber: number;

  @Column({ type: 'date' })
  entryDate: Date;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', nullable: true })
  referenceType: string | null;

  @Column({ type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ type: 'boolean', default: false })
  isPosted: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  @Column({ type: 'uuid', name: 'posted_by', nullable: true })
  postedById: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'posted_by' })
  postedByUser: AppUser | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdById: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdByUser: AppUser | null;

  @OneToMany(() => JournalEntryLine, (line) => line.journalEntry)
  lines: JournalEntryLine[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
