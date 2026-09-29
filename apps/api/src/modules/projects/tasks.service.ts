import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './entities/task.entity';
import { TaskDependency } from './entities/task-dependency.entity';
import { Project } from './entities/project.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import {
  CreateTaskDto,
  UpdateTaskDto,
  WORKER_TASK_FIELDS,
  WORKER_TASK_STATUSES,
} from './dto/task.dto';

interface TaskFilters {
  page?: number;
  limit?: number;
  lotId?: string;
  status?: string;
  assignedTo?: string;
}

interface Actor {
  id: string;
  role: string;
}

/** DATE columns are exchanged as YYYY-MM-DD strings (the pg driver returns them as strings too). */
const asDate = (v: string | null | undefined): Date | null => (v ? (v as unknown as Date) : null);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(TaskDependency)
    private readonly dependencyRepo: Repository<TaskDependency>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
  ) {}

  /* ───────────── Tasks ───────────── */

  async findByProject(
    companyId: string,
    projectId: string,
    filters: TaskFilters = {},
  ) {
    const { page = 1, limit = 50, lotId, status, assignedTo } = filters;

    const qb = this.taskRepo
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.lot', 'lot')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .where('task.project_id = :projectId', { projectId })
      .andWhere('task.company_id = :companyId', { companyId });

    if (lotId) {
      qb.andWhere('task.lot_id = :lotId', { lotId });
    }

    if (status) {
      qb.andWhere('task.status = :status', { status });
    }

    if (assignedTo) {
      qb.andWhere('task.assigned_to = :assignedTo', { assignedTo });
    }

    qb.orderBy('task.createdAt', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(companyId: string, id: string): Promise<Task> {
    const task = await this.taskRepo.findOne({
      where: { id, companyId },
      relations: ['project', 'lot', 'assignee'],
    });
    if (!task) throw new NotFoundError('Task', id);
    return task;
  }

  async create(
    companyId: string,
    userId: string,
    projectId: string,
    dto: CreateTaskDto,
  ): Promise<Task> {
    // Ensure project exists
    const project = await this.projectRepo.findOne({
      where: { id: projectId, companyId },
    });
    if (!project) throw new NotFoundError('Project', projectId);

    const task = this.taskRepo.create({
      projectId,
      companyId,
      lotId: dto.lotId || null,
      parentTaskId: dto.parentTaskId || null,
      title: dto.title,
      description: dto.description || null,
      status: dto.status ?? 'todo',
      priority: dto.priority ?? 'normal',
      plannedStart: asDate(dto.plannedStart),
      plannedEnd: asDate(dto.plannedEnd),
      estimatedHours: dto.estimatedHours ?? null,
      assignedTo: dto.assignedTo || null,
      createdBy: userId,
    });

    return this.taskRepo.save(task);
  }

  async update(
    companyId: string,
    projectId: string,
    id: string,
    dto: UpdateTaskDto,
    actor?: Actor,
  ): Promise<Task> {
    const task = await this.findById(companyId, id);
    if (task.projectId !== projectId) throw new NotFoundError('Task', id);

    if (actor?.role === 'WORKER') this.assertWorkerMayUpdate(task, dto, actor.id);

    // If status changes to 'done', set actualEnd = today
    if (dto.status === 'done' && task.status !== 'done') {
      dto.actualEnd = todayIso();
    }

    Object.assign(task, dto);
    return this.taskRepo.save(task);
  }

  /** Workers may only report status/progress on tasks assigned to them. */
  private assertWorkerMayUpdate(task: Task, dto: UpdateTaskDto, userId: string): void {
    if (task.assignedTo !== userId) {
      throw new ForbiddenException('Workers can only update tasks assigned to them');
    }
    const fields = Object.keys(dto).filter(
      (k) => (dto as Record<string, unknown>)[k] !== undefined,
    );
    const disallowed = fields.filter((k) => !WORKER_TASK_FIELDS.includes(k));
    if (disallowed.length > 0) {
      throw new ForbiddenException(
        `Workers may only change ${WORKER_TASK_FIELDS.join(', ')} (not ${disallowed.join(', ')})`,
      );
    }
    if (dto.status !== undefined && !WORKER_TASK_STATUSES.includes(dto.status)) {
      throw new ForbiddenException(
        `Workers may only set status to ${WORKER_TASK_STATUSES.join(', ')}`,
      );
    }
  }

  /* ───────────── Dependencies ───────────── */

  async addDependency(
    companyId: string,
    projectId: string,
    predecessorId: string,
    successorId: string,
    type?: string,
    lagDays?: number,
  ): Promise<TaskDependency> {
    // Validate no self-dependency
    if (predecessorId === successorId) {
      throw new BusinessRuleError(
        'CIRCULAR_DEPENDENCY',
        'A task cannot depend on itself.',
      );
    }

    // Ensure both tasks exist and belong to company
    const predecessor = await this.taskRepo.findOne({
      where: { id: predecessorId, companyId, projectId },
    });
    if (!predecessor) throw new NotFoundError('Task', predecessorId);

    const successor = await this.taskRepo.findOne({
      where: { id: successorId, companyId, projectId },
    });
    if (!successor) throw new NotFoundError('Task', successorId);

    return this.dependencyRepo.manager.transaction(async (m) => {
      // Serialise per project so two concurrent additions can't close a loop together.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`task_dependency:${projectId}`]);

      const existing = await m.findOne(TaskDependency, { where: { predecessorId, successorId } });
      if (existing) {
        throw new BusinessRuleError('DUPLICATE_DEPENDENCY', 'This dependency already exists.');
      }

      // Adding predecessor → successor creates a cycle if successor already leads to predecessor.
      const [cycle] = await m.query(
        `WITH RECURSIVE reachable(id) AS (
           SELECT successor_id FROM task_dependency WHERE predecessor_id = $1
           UNION
           SELECT d.successor_id FROM task_dependency d JOIN reachable r ON d.predecessor_id = r.id
         )
         SELECT 1 FROM reachable WHERE id = $2 LIMIT 1`,
        [successorId, predecessorId],
      );
      if (cycle) {
        throw new BusinessRuleError('CIRCULAR_DEPENDENCY', 'This dependency would create a loop between tasks.');
      }

      return m.save(
        m.create(TaskDependency, {
          predecessorId,
          successorId,
          type: type ?? 'finish_to_start',
          lagDays: lagDays ?? 0,
        }),
      );
    });
  }

  async removeDependency(
    companyId: string,
    projectId: string,
    predecessorId: string,
    successorId: string,
  ): Promise<void> {
    // Ensure the predecessor belongs to this company and project
    const predecessor = await this.taskRepo.findOne({
      where: { id: predecessorId, companyId, projectId },
    });
    if (!predecessor) throw new NotFoundError('Task', predecessorId);

    const dependency = await this.dependencyRepo.findOne({
      where: { predecessorId, successorId },
    });
    if (!dependency) throw new NotFoundError('TaskDependency', `${predecessorId}->${successorId}`);

    await this.dependencyRepo.remove(dependency);
  }

  /* ───────────── Gantt ───────────── */

  async getGanttData(companyId: string, projectId: string) {
    // Ensure project exists
    const project = await this.projectRepo.findOne({
      where: { id: projectId, companyId },
    });
    if (!project) throw new NotFoundError('Project', projectId);

    const tasks = await this.taskRepo.find({
      where: { projectId, companyId },
      relations: ['lot', 'assignee'],
      order: { createdAt: 'ASC' },
    });

    const taskIds = tasks.map((t) => t.id);

    let dependencies: TaskDependency[] = [];
    if (taskIds.length > 0) {
      dependencies = await this.dependencyRepo
        .createQueryBuilder('dep')
        .where('dep.predecessor_id IN (:...taskIds)', { taskIds })
        .orWhere('dep.successor_id IN (:...taskIds)', { taskIds })
        .getMany();
    }

    return { tasks, dependencies };
  }
}
