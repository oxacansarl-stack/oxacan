import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';
import { AppUser } from '../../auth/entities/app-user.entity';
import { MeetingAttendee } from './meeting-attendee.entity';
import { MeetingAction } from './meeting-action.entity';

@Entity('site_meeting')
export class SiteMeeting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'integer' })
  meetingNumber: number;

  @Column({ type: 'timestamptz' })
  meetingDate: Date;

  @Column({ type: 'text', nullable: true })
  location: string | null;

  @Column({ type: 'text', nullable: true })
  agenda: string | null;

  @Column({ type: 'text', nullable: true })
  minutes: string | null;

  @Column({ type: 'text', default: 'scheduled' })
  status: string;

  @Column({ type: 'text', nullable: true })
  pdfUrl: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdByUser: AppUser | null;

  @OneToMany(() => MeetingAttendee, (attendee) => attendee.meeting)
  attendees: MeetingAttendee[];

  @OneToMany(() => MeetingAction, (action) => action.meeting)
  actions: MeetingAction[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
