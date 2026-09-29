import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SiteMeeting } from './site-meeting.entity';

@Entity('meeting_attendee')
export class MeetingAttendee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  meetingId: string;

  @ManyToOne(() => SiteMeeting, (meeting) => meeting.attendees, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'meeting_id' })
  meeting: SiteMeeting;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  role: string | null;

  @Column({ type: 'text', nullable: true })
  organization: string | null;

  @Column({ type: 'text', default: 'present' })
  attendance: string;

  @Column({ type: 'text', nullable: true })
  signatureUrl: string | null;
}
