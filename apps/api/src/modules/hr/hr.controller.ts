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
import {
  ADMIN_ONLY,
  OFFICE_ROLES,
  Roles,
  SITE_LEAD_ROLES,
} from '../../common/decorators/roles.decorator';
import { HrService } from './hr.service';
import { parsePaging } from '../timekeeping/access-scope.service';
import {
  AddTeamMemberDto,
  CreateTeamDto,
  UpdateEmployeeDto,
  UpdateTeamDto,
} from './dto/hr.dto';

@Controller('hr')
export class HrController {
  constructor(private readonly service: HrService) {}

  /* ───────────── Teams ───────────── */

  /** Team leaders may read teams; leader/member users are reduced to non-sensitive columns. */
  @Get('teams')
  @Roles(...SITE_LEAD_ROLES)
  async findAllTeams(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAllTeams(companyId, { ...parsePaging(page, limit), search });
  }

  @Get('teams/:id')
  @Roles(...SITE_LEAD_ROLES)
  async findTeamById(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findTeamById(companyId, id);
  }

  @Post('teams')
  @Roles(...OFFICE_ROLES)
  async createTeam(
    @CompanyId() companyId: string,
    @Body() body: CreateTeamDto,
  ) {
    return this.service.createTeam(companyId, body);
  }

  @Put('teams/:id')
  @Roles(...OFFICE_ROLES)
  async updateTeam(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTeamDto,
  ) {
    return this.service.updateTeam(companyId, id, body);
  }

  @Delete('teams/:id')
  @Roles(...OFFICE_ROLES)
  async deleteTeam(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deleteTeam(companyId, id);
    return { message: 'Team deleted' };
  }

  /* ───────────── Team Members ───────────── */

  @Post('teams/:id/members')
  @Roles(...OFFICE_ROLES)
  async addMember(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddTeamMemberDto,
  ) {
    return this.service.addMember(companyId, id, body.userId);
  }

  @Delete('teams/:id/members/:userId')
  @Roles(...OFFICE_ROLES)
  async removeMember(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.service.removeMember(companyId, id, userId);
    return { message: 'Member removed' };
  }

  /* ───────────── Employees ───────────── */

  /** Office only: rows include hourly rates. */
  @Get('employees')
  @Roles(...OFFICE_ROLES)
  async findAllEmployees(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.service.findAllEmployees(companyId, {
      ...parsePaging(page, limit),
      search,
      role,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
  }

  /** PRD: the administrator sets pay rates and roles. */
  @Put('employees/:userId')
  @Roles(...ADMIN_ONLY)
  async updateEmployee(
    @CompanyId() companyId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateEmployeeDto,
  ) {
    return this.service.updateEmployee(companyId, userId, body);
  }
}
