import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SiteMeeting } from './entities/site-meeting.entity';
import { MeetingAttendee } from './entities/meeting-attendee.entity';
import { MeetingAction } from './entities/meeting-action.entity';
import { MeetingsService } from './meetings.service';
import { MeetingsController } from './meetings.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SiteMeeting, MeetingAttendee, MeetingAction]),
  ],
  providers: [MeetingsService],
  controllers: [MeetingsController],
  exports: [MeetingsService],
})
export class MeetingsModule {}
