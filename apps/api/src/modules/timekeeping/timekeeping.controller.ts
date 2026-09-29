import {
  Controller,
  Get,
  Post,
  Put,
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
import { TimekeepingService } from './timekeeping.service';

@Controller('timekeeping')
export class TimekeepingController {
  constructor(private readonly service: TimekeepingService) {}

  @Get()
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async findAll(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.findAllTimeEntries(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      userId,
      projectId,
      status,
      dateFrom,
      dateTo,
    });
  }

  @Get('summary/weekly')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async getWeeklySummary(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string; role: string },
    @Query('userId') userId?: string,
    @Query('weekStart') weekStart?: string,
  ) {
    const canViewOthers = ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER'].includes(user.role);
    const targetUserId = userId && canViewOthers ? userId : user.id;
    return this.service.getWeeklySummary(companyId, targetUserId, weekStart);
  }

  @Get(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async findById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findTimeEntryById(companyId, id);
  }

  @Post('clock-in')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async clockIn(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      projectId: string;
      taskId?: string;
      category?: string;
      latitude?: number;
      longitude?: number;
      notes?: string;
    },
  ) {
    return this.service.clockIn(companyId, user.id, body);
  }

  @Post('clock-out/:id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async clockOut(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.clockOut(companyId, user.id, id);
  }

  @Put(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      breakMinutes?: number;
      notes?: string;
      category?: string;
      travelMinutes?: number;
      taskId?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    return this.service.updateTimeEntry(companyId, id, body);
  }

  @Post('submit')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async submitForApproval(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.submitForApproval(companyId, user.id);
  }

  @Post('approve')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async approveEntries(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: { entryIds: string[] },
  ) {
    return this.service.approveEntries(companyId, user.id, body.entryIds);
  }

  @Post('reject')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async rejectEntries(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body() body: { entryIds: string[]; reason: string },
  ) {
    return this.service.rejectEntries(companyId, user.id, body.entryIds, body.reason);
  }
}
