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
import { Roles, SITE_LEAD_ROLES } from '../../common/decorators/roles.decorator';
import { MeetingsService } from './meetings.service';
import {
  AddActionDto,
  AddAttendeeDto,
  CreateMeetingDto,
  UpdateActionDto,
  UpdateMeetingDto,
} from './dto/meeting.dto';

function toPositiveInt(value: string | undefined, max?: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return max ? Math.min(n, max) : n;
}

// PRD §3.2: team leaders run site meetings and write their minutes.
@Controller('meetings')
@Roles(...SITE_LEAD_ROLES)
export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  @Get()
  async findAll(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(companyId, {
      page: toPositiveInt(page),
      limit: toPositiveInt(limit, 200),
      projectId,
      status,
    });
  }

  @Get(':id')
  async findById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(companyId, id);
  }

  @Post()
  async create(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: CreateMeetingDto,
  ) {
    return this.service.create(companyId, user.id, body);
  }

  @Put(':id')
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMeetingDto,
  ) {
    return this.service.update(companyId, id, body);
  }

  /* ───────────── Attendees ───────────── */

  @Post(':id/attendees')
  async addAttendee(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddAttendeeDto,
  ) {
    return this.service.addAttendee(companyId, id, body);
  }

  @Delete(':id/attendees/:attendeeId')
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
  async addAction(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddActionDto,
  ) {
    return this.service.addAction(companyId, id, body);
  }

  @Put(':id/actions/:actionId')
  async updateAction(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() body: UpdateActionDto,
  ) {
    return this.service.updateAction(companyId, id, actionId, body);
  }

  /* ───────────── Complete ───────────── */

  @Post(':id/complete')
  async completeMeeting(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.completeMeeting(companyId, id);
  }
}
