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
import { DailyReportService } from './daily-report.service';

@Controller('daily-reports')
export class DailyReportController {
  constructor(private readonly service: DailyReportService) {}

  @Get()
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async findAll(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('projectId') projectId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.findAll(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      userId,
      projectId,
      dateFrom,
      dateTo,
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async findById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(companyId, id);
  }

  @Post()
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async create(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      projectId: string;
      date: string;
      workDescription?: string;
      materialsUsed?: Record<string, unknown>[];
      weather?: string;
      temperatureCelsius?: number;
      notes?: string;
      photos?: Record<string, unknown>[];
    },
  ) {
    return this.service.create(companyId, user.id, body);
  }

  @Put(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async update(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      workDescription?: string;
      materialsUsed?: Record<string, unknown>[];
      weather?: string;
      temperatureCelsius?: number;
      notes?: string;
      photos?: Record<string, unknown>[];
    },
  ) {
    return this.service.update(companyId, id, body);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')
  async delete(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.delete(companyId, id);
    return { deleted: true };
  }
}
