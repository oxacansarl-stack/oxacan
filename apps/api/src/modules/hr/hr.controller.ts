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
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { HrService } from './hr.service';

@Controller('hr')
export class HrController {
  constructor(private readonly service: HrService) {}

  /* ───────────── Teams ───────────── */

  @Get('teams')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async findAllTeams(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAllTeams(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
    });
  }

  @Get('teams/:id')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
  async findTeamById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findTeamById(companyId, id);
  }

  @Post('teams')
  @Roles('ADMIN')
  async createTeam(
    @CompanyId() companyId: string,
    @Body() body: { name: string; leaderId?: string },
  ) {
    return this.service.createTeam(companyId, body);
  }

  @Put('teams/:id')
  @Roles('ADMIN')
  async updateTeam(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name?: string; leaderId?: string },
  ) {
    return this.service.updateTeam(companyId, id, body);
  }

  @Delete('teams/:id')
  @Roles('ADMIN')
  async deleteTeam(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deleteTeam(companyId, id);
    return { message: 'Team deleted' };
  }

  /* ───────────── Team Members ───────────── */

  @Post('teams/:id/members')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async addMember(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { userId: string },
  ) {
    return this.service.addMember(companyId, id, body.userId);
  }

  @Delete('teams/:id/members/:userId')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async removeMember(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.service.removeMember(companyId, id, userId);
    return { message: 'Member removed' };
  }

  /* ───────────── Employees ───────────── */

  @Get('employees')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async findAllEmployees(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.service.findAllEmployees(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      role,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  @Put('employees/:userId')
  @Roles('ADMIN')
  async updateEmployee(
    @CompanyId() companyId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body()
    body: {
      hourlyRateCents?: number;
      role?: string;
      cctCode?: string;
      isActive?: boolean;
    },
  ) {
    return this.service.updateEmployee(companyId, userId, body);
  }
}
