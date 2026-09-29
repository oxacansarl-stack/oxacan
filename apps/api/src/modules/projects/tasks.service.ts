import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './entities/task.entity';
import { TaskDependency } from './entities/task-dependency.entity';
import { Project } from './entities/project.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';

interface TaskFilters {
  page?: number;
  limit?: number;
  lotId?: string;
  status?: string;
  assignedTo?: string;
}

interface CreateTaskDto {
  projectId: string;
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
}

interface UpdateTaskDto {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  lotId?: string;
  plannedStart?: Date | null;
  plannedEnd?: Date | null;
  actualStart?: Date | null;
  actualEnd?: Date | null;
  estimatedHours?: number | null;
  actualHours?: number;
  progressPercent?: number;
  assignedTo?: string | null;
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

  async create(companyId: string, dto: CreateTaskDto): Promise<Task> {
    // Ensure project exists
    const project = await this.projectRepo.findOne({
      where: { id: dto.projectId, companyId },
    });
    if (!project) throw new NotFoundError('Project', dto.projectId);

    const task = this.taskRepo.create({
      projectId: dto.projectId,
      companyId,
      lotId: dto.lotId || null,
      parentTaskId: dto.parentTaskId || null,
      title: dto.title,
      description: dto.description || null,
      status: dto.status ?? 'todo',
      priority: dto.priority ?? 'normal',
      plannedStart: dto.plannedStart || null,
      plannedEnd: dto.plannedEnd || null,
      estimatedHours: dto.estimatedHours ?? null,
      assignedTo: dto.assignedTo || null,
    });

    return this.taskRepo.save(task);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateTaskDto,
  ): Promise<Task> {
    const task = await this.findById(companyId, id);

    // If status changes to 'done', set actualEnd = today
    if (dto.status === 'done' && task.status !== 'done') {
      dto.actualEnd = new Date();
    }

    Object.assign(task, dto);
    return this.taskRepo.save(task);
  }

  /* ───────────── Dependencies ───────────── */

  async addDependency(
    companyId: string,
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
      where: { id: predecessorId, companyId },
    });
    if (!predecessor) throw new NotFoundError('Task', predecessorId);

    const successor = await this.taskRepo.findOne({
      where: { id: successorId, companyId },
    });
    if (!successor) throw new NotFoundError('Task', successorId);

    // Check if dependency already exists
    const existing = await this.dependencyRepo.findOne({
      where: { predecessorId, successorId },
    });
    if (existing) {
      throw new BusinessRuleError(
        'DUPLICATE_DEPENDENCY',
        'This dependency already exists.',
      );
    }

    const dependency = this.dependencyRepo.create({
      predecessorId,
      successorId,
      type: type ?? 'finish_to_start',
      lagDays: lagDays ?? 0,
    });

    return this.dependencyRepo.save(dependency);
  }

  async removeDependency(
    companyId: string,
    predecessorId: string,
    successorId: string,
  ): Promise<void> {
    // Ensure both tasks belong to company
    const predecessor = await this.taskRepo.findOne({
      where: { id: predecessorId, companyId },
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
