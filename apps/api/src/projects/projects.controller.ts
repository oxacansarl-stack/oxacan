import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ProjectsService } from './projects.service';
import { CurrentUser, Roles } from '../auth/jwt-auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import type { JwtPayload } from '../auth/auth.types';

const TaskPatch = z.object({ status: z.enum(['A_FAIRE', 'EN_COURS', 'TERMINE']).optional(), hoursDone: z.number().nonnegative().optional() });
const Executed = z.object({ executed: z.array(z.object({ lineId: z.string(), executedQuantity: z.number().nonnegative() })).min(1) });
const Situation = z.object({ retentionPercent: z.number().min(0).max(100).default(5) });

@Controller('projects')
export class ProjectsController {
  constructor(private readonly svc: ProjectsService) {}
  @Get() list(@CurrentUser() u: JwtPayload) { return this.svc.list(u.tenantId); }
  @Get(':id') get(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.get(u.tenantId, id); }
  @Get(':id/dashboard') dashboard(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.dashboard(u.tenantId, id); }
  @Roles('DIRIGEANT', 'CHEF_PROJET', 'TECHNICIEN') @Patch('tasks/:taskId') task(@CurrentUser() u: JwtPayload, @Param('taskId') taskId: string, @Body(new ZodPipe(TaskPatch)) b: z.infer<typeof TaskPatch>) { return this.svc.updateTask(u.tenantId, taskId, b); }
  @Roles('DIRIGEANT', 'CHEF_PROJET') @Post(':id/executed') executed(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body(new ZodPipe(Executed)) b: z.infer<typeof Executed>) { return this.svc.setExecuted(u.tenantId, id, b.executed); }
  @Roles('DIRIGEANT', 'CHEF_PROJET') @Post(':id/situations') situation(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body(new ZodPipe(Situation)) b: z.infer<typeof Situation>) { return this.svc.createSituation(u.tenantId, id, b); }
}
