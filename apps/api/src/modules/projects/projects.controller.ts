import {
  Controller,
  Get,
  Post,
  Patch,
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
import {
  ALL_ROLES,
  OFFICE_ROLES,
  Roles,
  SITE_LEAD_ROLES,
} from '../../common/decorators/roles.decorator';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';
import { redactFinancials } from './financials';
import {
  AddLotDto,
  AddMilestoneDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { AddDependencyDto, CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { ExecutedQuantitiesService } from './executed-quantities.service';
import {
  CorrectExecutedQuantityDto,
  RecordExecutedQuantityDto,
  ValidateExecutedQuantitiesDto,
} from './dto/executed-quantity.dto';
import type { ScopeUser } from '../timekeeping/access-scope.service';

interface RequestUser {
  id: string;
  role: string;
}

const MAX_PAGE_SIZE = 200;

/** Positive integer from a query string, else undefined (service default applies). */
function toPositiveInt(value: string | undefined, max?: number): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return max ? Math.min(n, max) : n;
}

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly tasksService: TasksService,
    private readonly executedQuantities: ExecutedQuantitiesService,
  ) {}

  /* ───────────── Projects ───────────── */

  @Get()
  @Roles(...ALL_ROLES)
  async listProjects(
    @CompanyId() companyId: string,
    @CurrentUser() user: RequestUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('managerId') managerId?: string,
  ) {
    const result = await this.projectsService.findAll(companyId, {
      page: toPositiveInt(page),
      limit: toPositiveInt(limit, MAX_PAGE_SIZE),
      status,
      clientId,
      managerId,
    });
    return redactFinancials(result, user.role);
  }

  @Get(':id')
  @Roles(...ALL_ROLES)
  async getProject(
    @CompanyId() companyId: string,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const project = await this.projectsService.findById(companyId, id);
    return redactFinancials(project, user.role);
  }

  @Patch(':id')
  @Roles(...OFFICE_ROLES)
  async updateProject(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProjectDto,
  ) {
    return this.projectsService.update(companyId, id, body);
  }

  @Post(':id/recalculate')
  @Roles(...OFFICE_ROLES)
  async recalculateProgress(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projectsService.updateProgress(companyId, id);
  }

  /* ───────────── Lots ───────────── */

  @Post(':id/lots')
  @Roles(...OFFICE_ROLES)
  async addLot(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddLotDto,
  ) {
    return this.projectsService.addLot(companyId, id, body);
  }

  /* ───────────── Milestones ───────────── */

  @Post(':id/milestones')
  @Roles(...OFFICE_ROLES)
  async addMilestone(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddMilestoneDto,
  ) {
    return this.projectsService.addMilestone(companyId, id, body);
  }

  @Patch(':id/milestones/:milestoneId')
  @Roles(...OFFICE_ROLES)
  async updateMilestone(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() body: UpdateMilestoneDto,
  ) {
    return this.projectsService.updateMilestone(companyId, id, milestoneId, body);
  }

  /* ───────────── Tasks ───────────── */

  @Get(':id/tasks')
  @Roles(...ALL_ROLES)
  async listTasks(
    @CompanyId() companyId: string,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('lotId') lotId?: string,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
  ) {
    const result = await this.tasksService.findByProject(companyId, id, {
      page: toPositiveInt(page),
      limit: toPositiveInt(limit, MAX_PAGE_SIZE),
      lotId,
      status,
      assignedTo,
    });
    return redactFinancials(result, user.role);
  }

  @Get(':id/gantt')
  @Roles(...ALL_ROLES)
  async getGanttData(
    @CompanyId() companyId: string,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const gantt = await this.tasksService.getGanttData(companyId, id);
    return redactFinancials(gantt, user.role);
  }

  @Post(':id/tasks')
  @Roles(...SITE_LEAD_ROLES)
  async createTask(
    @CompanyId() companyId: string,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateTaskDto,
  ) {
    const task = await this.tasksService.create(companyId, user.id, id, body);
    return redactFinancials(task, user.role);
  }

  /**
   * Leads and office roles may edit any field. A WORKER may only change `status`
   * (todo / in_progress / done) and `progressPercent` of a task assigned to them —
   * enforced in TasksService.update.
   */
  @Patch(':id/tasks/:taskId')
  @Roles(...ALL_ROLES)
  async updateTask(
    @CompanyId() companyId: string,
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() body: UpdateTaskDto,
  ) {
    const task = await this.tasksService.update(companyId, id, taskId, body, user);
    return redactFinancials(task, user.role);
  }

  /* ───────────── Task Dependencies ───────────── */

  @Post(':id/tasks/:taskId/dependencies')
  @Roles(...SITE_LEAD_ROLES)
  async addDependency(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() body: AddDependencyDto,
  ) {
    return this.tasksService.addDependency(
      companyId,
      id,
      taskId,
      body.successorId,
      body.type,
      body.lagDays,
    );
  }

  @Delete(':id/tasks/:taskId/dependencies/:successorId')
  @Roles(...SITE_LEAD_ROLES)
  async removeDependency(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('successorId', ParseUUIDPipe) successorId: string,
  ) {
    await this.tasksService.removeDependency(companyId, id, taskId, successorId);
    return { deleted: true };
  }

  /* ───────────── Executed quantities (PRD §10, §15.2) ───────────── */
  // Team leaders only on projects they are assigned to (ExecutedQuantitiesService).

  /** Cumulative executed quantity per offer position: recorded, validated (billable), pending. */
  @Get(':id/executed-quantities/positions')
  @Roles(...SITE_LEAD_ROLES)
  async getExecutedPositions(
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.executedQuantities.getPositions(user, id);
  }

  @Get(':id/executed-quantities')
  @Roles(...SITE_LEAD_ROLES)
  async listExecutedQuantities(
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('offerLineId', new ParseUUIDPipe({ optional: true })) offerLineId?: string,
    @Query('status') status?: string,
  ) {
    return this.executedQuantities.listEntries(user, id, {
      page: toPositiveInt(page),
      limit: toPositiveInt(limit, MAX_PAGE_SIZE),
      offerLineId,
      status,
    });
  }

  @Post(':id/executed-quantities')
  @Roles(...SITE_LEAD_ROLES)
  async recordExecutedQuantity(
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordExecutedQuantityDto,
  ) {
    return this.executedQuantities.record(user, id, body);
  }

  /** Corrections are new entries; the corrected entry is never edited. */
  @Post(':id/executed-quantities/:entryId/corrections')
  @Roles(...SITE_LEAD_ROLES)
  async correctExecutedQuantity(
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() body: CorrectExecutedQuantityDto,
  ) {
    return this.executedQuantities.correct(user, id, entryId, body);
  }

  /** The project manager's sign-off: validated entries become billable by situations. */
  @Post(':id/executed-quantities/validate')
  @Roles(...OFFICE_ROLES)
  async validateExecutedQuantities(
    @CurrentUser() user: ScopeUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ValidateExecutedQuantitiesDto,
  ) {
    return this.executedQuantities.validate(user, id, body);
  }
}
