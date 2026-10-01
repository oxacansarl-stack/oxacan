import { Controller, Get, Query } from '@nestjs/common';
import { CompanyId, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ALL_ROLES, Roles } from '../../common/decorators/roles.decorator';
import { TasksService } from './tasks.service';

/** Parses a positive integer query param; falls back on missing/invalid values and clamps to max. */
function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const n = value ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

// "Mes tâches" (PRD §3.2): the signed-in user's assigned tasks across every project.
@Controller('tasks')
export class MyTasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('mine')
  @Roles(...ALL_ROLES)
  async findMine(
    @CompanyId() companyId: string,
    @CurrentUser() user: { id: string },
    @Query('view') view?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tasksService.findMine(companyId, user.id, {
      view,
      page: positiveInt(page, 1, 100_000),
      limit: positiveInt(limit, 50, 200),
    });
  }
}
