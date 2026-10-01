import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SiteMeeting } from './entities/site-meeting.entity';
import { MeetingAttendee } from './entities/meeting-attendee.entity';
import { MeetingAction } from './entities/meeting-action.entity';
import { Project } from '../projects/entities/project.entity';
import { MeetingsService } from './meetings.service';
import { MeetingsController } from './meetings.controller';

@Module({
  imports: [
    NotificationsModule,
    TypeOrmModule.forFeature([SiteMeeting, MeetingAttendee, MeetingAction, Project]),
  ],
  providers: [MeetingsService],
  controllers: [MeetingsController],
  exports: [MeetingsService],
})
export class MeetingsModule {}
