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
import { ALL_ROLES, Roles, SITE_LEAD_ROLES } from '../../common/decorators/roles.decorator';
import { TimekeepingService } from './timekeeping.service';
import { hidesMoneyFor, stripMoney } from '../../common/util/strip-money';

/** Hourly rates and labour cost are pay data; only office roles see them. */
const hidePay = <T>(user: { role: string }, value: T): T => (hidesMoneyFor(user.role) ? stripMoney(value) : value);
import { AccessScopeService, ScopeUser, parsePaging } from './access-scope.service';
import {
  ApproveTimeEntriesDto,
  ClockInDto,
  RejectTimeEntriesDto,
  SubmitTimeEntriesDto,
  UpdateTimeEntryDto,
} from './dto/time-entry.dto';

const OPTIONAL_UUID = new ParseUUIDPipe({ optional: true });

@Controller('timekeeping')
export class TimekeepingController {
  constructor(
    private readonly service: TimekeepingService,
    private readonly scope: AccessScopeService,
  ) {}

  @Get()
  @Roles(...ALL_ROLES)
  async findAll(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId', OPTIONAL_UUID) userId?: string,
    @Query('projectId', OPTIONAL_UUID) projectId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return hidePay(
      user,
      await this.service.findAllTimeEntries(
        { ...user, companyId },
        { ...parsePaging(page, limit), userId, projectId, status, dateFrom, dateTo },
      ),
    );
  }

  @Get('summary/weekly')
  @Roles(...ALL_ROLES)
  async getWeeklySummary(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Query('userId', OPTIONAL_UUID) userId?: string,
    @Query('weekStart') weekStart?: string,
  ) {
    // Another user's week only when inside the caller's scope; otherwise the caller's own.
    const caller = { ...user, companyId };
    const targetUserId =
      userId && userId !== user.id && (await this.scope.canSee(caller, userId)) ? userId : user.id;
    const summary = await this.service.getWeeklySummary(companyId, targetUserId, weekStart);
    if (!hidesMoneyFor(user.role)) return summary;
    const { totalCost: _cost, ...rest } = stripMoney(summary);
    return rest;
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  async findById(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return hidePay(user, await this.service.findTimeEntryById({ ...user, companyId }, id));
  }

  @Post('clock-in')
  @Roles(...ALL_ROLES)
  async clockIn(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Body() body: ClockInDto,
  ) {
    return this.service.clockIn(companyId, user.id, body);
  }

  /** Takes no body: end time and minutes are computed server-side. Owner only. */
  @Post('clock-out/:id')
  @Roles(...ALL_ROLES)
  async clockOut(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.clockOut(companyId, user.id, id);
  }

  @Put(':id')
  @Roles(...ALL_ROLES)
  async update(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTimeEntryDto,
  ) {
    return this.service.updateTimeEntry({ ...user, companyId }, id, body);
  }

  @Post('submit')
  @Roles(...ALL_ROLES)
  async submitForApproval(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Body() body: SubmitTimeEntriesDto,
  ) {
    return this.service.submitForApproval(companyId, user.id, body?.entryIds);
  }

  @Post('approve')
  @Roles(...SITE_LEAD_ROLES)
  async approveEntries(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Body() body: ApproveTimeEntriesDto,
  ) {
    return this.service.approveEntries({ ...user, companyId }, body.entryIds);
  }

  @Post('reject')
  @Roles(...SITE_LEAD_ROLES)
  async rejectEntries(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Body() body: RejectTimeEntriesDto,
  ) {
    return this.service.rejectEntries({ ...user, companyId }, body.entryIds, body.reason);
  }
}
