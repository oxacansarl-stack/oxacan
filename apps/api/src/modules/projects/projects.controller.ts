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
import { Roles } from '../../common/decorators/roles.decorator';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly tasksService: TasksService,
  ) {}

  /* ───────────── Projects ───────────── */

  @Get()
  async listProjects(
    @CompanyId() companyId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('managerId') managerId?: string,
  ) {
    return this.projectsService.findAll(companyId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      clientId,
      managerId,
    });
  }

  @Get(':id')
  async getProject(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projectsService.findById(companyId, id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updateProject(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name?: string;
      startDate?: Date;
      endDate?: Date;
      address?: string;
      postalCode?: string;
      city?: string;
      managerId?: string;
      status?: string;
    },
  ) {
    return this.projectsService.update(companyId, id, body);
  }

  @Post(':id/recalculate')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async recalculateProgress(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.projectsService.updateProgress(companyId, id);
  }

  /* ───────────── Lots ───────────── */

  @Post(':id/lots')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async addLot(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name: string;
      description?: string;
      budgetCents?: number;
      sortOrder?: number;
    },
  ) {
    return this.projectsService.addLot(companyId, id, body);
  }

  /* ───────────── Milestones ───────────── */

  @Post(':id/milestones')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async addMilestone(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      name: string;
      targetDate?: Date;
      lotId?: string;
      status?: string;
    },
  ) {
    return this.projectsService.addMilestone(companyId, id, body);
  }

  @Patch(':id/milestones/:milestoneId')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updateMilestone(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body()
    body: {
      name?: string;
      targetDate?: Date;
      completedDate?: Date;
      status?: string;
    },
  ) {
    return this.projectsService.updateMilestone(companyId, id, milestoneId, body);
  }

  /* ───────────── Tasks ───────────── */

  @Get(':id/tasks')
  async listTasks(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('lotId') lotId?: string,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
  ) {
    return this.tasksService.findByProject(companyId, id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      lotId,
      status,
      assignedTo,
    });
  }

  @Get(':id/gantt')
  async getGanttData(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.getGanttData(companyId, id);
  }

  @Post(':id/tasks')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async createTask(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      lotId?: string;
      parentTaskId?: string;
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      plannedStart?: Date;
      plannedEnd?: Date;
      estimatedHours?: number;
      assignedTo?: string;
    },
  ) {
    return this.tasksService.create(companyId, {
      projectId: id,
      ...body,
    });
  }

  @Patch(':id/tasks/:taskId')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async updateTask(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body()
    body: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      lotId?: string;
      plannedStart?: Date;
      plannedEnd?: Date;
      actualStart?: Date;
      actualEnd?: Date;
      estimatedHours?: number;
      actualHours?: number;
      progressPercent?: number;
      assignedTo?: string;
    },
  ) {
    return this.tasksService.update(companyId, taskId, body);
  }

  /* ───────────── Task Dependencies ───────────── */

  @Post(':id/tasks/:taskId/dependencies')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async addDependency(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body()
    body: {
      successorId: string;
      type?: string;
      lagDays?: number;
    },
  ) {
    return this.tasksService.addDependency(
      companyId,
      taskId,
      body.successorId,
      body.type,
      body.lagDays,
    );
  }

  @Delete(':id/tasks/:taskId/dependencies/:successorId')
  @Roles('ADMIN', 'PROJECT_MANAGER')
  async removeDependency(
    @CompanyId() companyId: string,
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('successorId', ParseUUIDPipe) successorId: string,
  ) {
    await this.tasksService.removeDependency(companyId, taskId, successorId);
    return { deleted: true };
  }
}
