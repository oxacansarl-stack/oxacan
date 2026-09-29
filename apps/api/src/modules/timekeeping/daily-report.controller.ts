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
import { ALL_ROLES, Roles } from '../../common/decorators/roles.decorator';
import { DailyReportService } from './daily-report.service';
import { ScopeUser, parsePaging } from './access-scope.service';
import { CreateDailyReportDto, UpdateDailyReportDto } from './dto/daily-report.dto';

const OPTIONAL_UUID = new ParseUUIDPipe({ optional: true });

@Controller('daily-reports')
export class DailyReportController {
  constructor(private readonly service: DailyReportService) {}

  @Get()
  @Roles(...ALL_ROLES)
  async findAll(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId', OPTIONAL_UUID) userId?: string,
    @Query('projectId', OPTIONAL_UUID) projectId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.findAll(
      { ...user, companyId },
      { ...parsePaging(page, limit), userId, projectId, dateFrom, dateTo },
    );
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  async findById(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById({ ...user, companyId }, id);
  }

  /** The author is always the caller (from the token), never the body. */
  @Post()
  @Roles(...ALL_ROLES)
  async create(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Body() body: CreateDailyReportDto,
  ) {
    return this.service.create(companyId, user.id, body);
  }

  @Put(':id')
  @Roles(...ALL_ROLES)
  async update(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDailyReportDto,
  ) {
    return this.service.update({ ...user, companyId }, id, body);
  }

  @Delete(':id')
  @Roles(...ALL_ROLES)
  async delete(
    @CompanyId() companyId: string,
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.delete({ ...user, companyId }, id);
    return { deleted: true };
  }
}
