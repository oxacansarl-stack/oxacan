import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  CompanyId,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { MeetingsService } from './meetings.service';

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  @Get()
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async findAll(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      projectId,
      status,
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async findById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(companyId, id);
  }

  @Post()
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async create(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      projectId: string;
      meetingDate: string;
      location?: string;
      agenda?: string;
    },
  ) {
    return this.service.create(companyId, user.id, body);
  }

  @Put(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      location?: string;
      agenda?: string;
      minutes?: string;
      status?: string;
    },
  ) {
    return this.service.update(companyId, id, body);
  }

  /* ───────────── Attendees ───────────── */

  @Post(':id/attendees')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async addAttendee(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name: string;
      role?: string;
      organization?: string;
      attendance?: string;
    },
  ) {
    return this.service.addAttendee(companyId, id, body);
  }

  @Delete(':id/attendees/:attendeeId')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async removeAttendee(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attendeeId', ParseUUIDPipe) attendeeId: string,
  ) {
    await this.service.removeAttendee(companyId, id, attendeeId);
    return { message: 'Attendee removed' };
  }

  /* ───────────── Actions ───────────── */

  @Post(':id/actions')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async addAction(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      description: string;
      responsible: string;
      dueDate?: string;
    },
  ) {
    return this.service.addAction(companyId, id, body);
  }

  @Put(':id/actions/:actionId')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async updateAction(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body()
    body: {
      description?: string;
      responsible?: string;
      dueDate?: string;
      status?: string;
    },
  ) {
    return this.service.updateAction(companyId, id, actionId, body);
  }

  /* ───────────── Complete ───────────── */

  @Post(':id/complete')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async completeMeeting(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.completeMeeting(companyId, id);
  }
}
