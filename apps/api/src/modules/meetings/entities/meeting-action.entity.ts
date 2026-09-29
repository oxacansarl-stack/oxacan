import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SiteMeeting } from './site-meeting.entity';

@Entity('meeting_action')
export class MeetingAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  meetingId: string;

  @ManyToOne(() => SiteMeeting, (meeting) => meeting.actions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: SiteMeeting;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text' })
  responsible: string;

  @Column({ type: 'date', nullable: true })
  dueDate: Date | null;

  @Column({ type: 'text', default: 'open' })
  status: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
