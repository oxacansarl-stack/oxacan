import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { ProjectLot } from './entities/project-lot.entity';
import { ProjectMilestone } from './entities/project-milestone.entity';
import { Task } from './entities/task.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { Offer } from '../offers/entities/offer.entity';
import { OfferLine } from '../offers/entities/offer-line.entity';
import { NotFoundError } from '@oxacan/shared-types';
import { projectActualCostSql } from './project-cost';
import {
  AddLotDto,
  AddMilestoneDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
} from './dto/project.dto';

interface ProjectFilters {
  page?: number;
  limit?: number;
  status?: string;
  clientId?: string;
  managerId?: string;
}

/** DATE columns are exchanged as YYYY-MM-DD strings (the pg driver returns them as strings too). */
const asDate = (v: string | null | undefined): Date | null => (v ? (v as unknown as Date) : null);

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectLot)
    private readonly lotRepo: Repository<ProjectLot>,
    @InjectRepository(ProjectMilestone)
    private readonly milestoneRepo: Repository<ProjectMilestone>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(OfferLine)
    private readonly offerLineRepo: Repository<OfferLine>,
  ) {}

  /* ───────────── Project CRUD ───────────── */

  async findAll(companyId: string, filters: ProjectFilters = {}) {
    const { page = 1, limit = 25, status, clientId, managerId } = filters;

    const qb = this.projectRepo
      .createQueryBuilder('project')
      .leftJoinAndSelect('project.client', 'client')
      .leftJoinAndSelect('project.contract', 'contract')
      .leftJoinAndSelect('project.manager', 'manager')
      .where('project.company_id = :companyId', { companyId });

    if (status) {
      qb.andWhere('project.status = :status', { status });
    }

    if (clientId) {
      qb.andWhere('project.client_id = :clientId', { clientId });
    }

    if (managerId) {
      qb.andWhere('project.manager_id = :managerId', { managerId });
    }

    qb.orderBy('project.createdAt', 'DESC')
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

  async findById(companyId: string, id: string): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { id, companyId },
      relations: [
        'lots',
        'milestones',
        'tasks',
        'tasks.lot',
        'contract',
        'client',
        'manager',
      ],
    });
    if (!project) throw new NotFoundError('Project', id);
    return project;
  }

  async createFromContract(
    companyId: string,
    contractId: string,
    userId: string,
  ): Promise<Project> {
    // 1. Load contract with offer and offer lines
    const contract = await this.contractRepo.findOne({
      where: { id: contractId, companyId },
      relations: ['offer'],
    });
    if (!contract) throw new NotFoundError('Contract', contractId);

    const offer = await this.offerRepo.findOne({
      where: { id: contract.offerId, companyId },
    });
    if (!offer) throw new NotFoundError('Offer', contract.offerId);

    const offerLines = await this.offerLineRepo.find({
      where: { offerId: offer.id, companyId },
    });

    // 2–3. Create project with reference PRJ-{YEAR}-{sequence}, serialised per company
    const savedProject = await this.projectRepo.manager.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`project:${companyId}`]);
      const prefix = `PRJ-${new Date().getFullYear()}-`;
      const [{ max }] = await m.query(
        `SELECT MAX(substring(reference from '[0-9]+$')::int) AS max
         FROM project WHERE company_id = $1 AND reference LIKE $2`,
        [companyId, `${prefix}%`],
      );
      return m.save(
        m.create(Project, {
          companyId,
          contractId: contract.id,
          clientId: contract.clientId,
          reference: `${prefix}${String((max ?? 0) + 1).padStart(4, '0')}`,
          name: offer.projectName,
          status: 'planning',
          startDate: new Date(),
          budgetHtCents: offer.totalHtCents,
          managerId: userId,
        }),
      );
    });

    // 4. Group offer lines by roomType -> create ProjectLot for each group
    const baseLines = offerLines.filter((line) => line.variantType === 'BASE');
    const roomGroups = new Map<string, OfferLine[]>();
    for (const line of baseLines) {
      const key = line.roomType || 'General';
      if (!roomGroups.has(key)) {
        roomGroups.set(key, []);
      }
      roomGroups.get(key)!.push(line);
    }

    let sortOrder = 0;
    const lotMap = new Map<string, ProjectLot>();
    for (const [roomType, _lines] of roomGroups) {
      const lot = this.lotRepo.create({
        projectId: savedProject.id,
        companyId,
        name: roomType,
        sortOrder: sortOrder++,
      });
      const savedLot = await this.lotRepo.save(lot);
      lotMap.set(roomType, savedLot);
    }

    // 5. Create a default milestone "Projet termine" with targetDate = startDate + 90 days
    const targetDate = new Date(savedProject.startDate ?? new Date());
    targetDate.setDate(targetDate.getDate() + 90);
    const milestone = this.milestoneRepo.create({
      projectId: savedProject.id,
      companyId,
      name: 'Projet terminé',
      targetDate,
      status: 'pending',
    });
    await this.milestoneRepo.save(milestone);

    // 6. For each offer line (BASE variant only), create a Task under the corresponding lot
    for (const line of baseLines) {
      const key = line.roomType || 'General';
      const lot = lotMap.get(key)!;
      const task = this.taskRepo.create({
        projectId: savedProject.id,
        lotId: lot.id,
        companyId,
        title: line.description,
        description: `${line.quantity} ${line.unit}`,
        status: 'todo',
        priority: 'normal',
        createdBy: userId,
      });
      await this.taskRepo.save(task);
    }

    // 7. Return full project
    return this.findById(companyId, savedProject.id);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const project = await this.findById(companyId, id);
    Object.assign(project, dto);
    // findById loads the manager relation, which save() would prefer over a new managerId.
    if (dto.managerId !== undefined) project.manager = undefined as unknown as Project['manager'];
    return this.projectRepo.save(project);
  }

  /** Recomputes progress (share of tasks done) and actual cost from approved hours and expenses. */
  async updateProgress(companyId: string, id: string): Promise<Project> {
    const project = await this.findById(companyId, id);

    const tasks = await this.taskRepo.find({
      where: { projectId: id, companyId },
    });

    if (tasks.length === 0) {
      project.progressPercent = 0;
    } else {
      const completedCount = tasks.filter((t) => t.status === 'done').length;
      project.progressPercent = Math.round(
        (completedCount / tasks.length) * 100,
      );
    }

    // Actual cost HT = approved hours + approved expenses (HT) + delivered purchase-order goods.
    const [{ cost }] = await this.projectRepo.query(
      `SELECT ${projectActualCostSql('$1', '$2')} AS cost`,
      [id, companyId],
    );
    project.actualCostCents = Number(cost);

    return this.projectRepo.save(project);
  }

  /* ───────────── Lots ───────────── */

  async addLot(
    companyId: string,
    projectId: string,
    dto: AddLotDto,
  ): Promise<ProjectLot> {
    await this.findById(companyId, projectId);

    const lot = this.lotRepo.create({
      projectId,
      companyId,
      name: dto.name,
      description: dto.description || null,
      budgetCents: dto.budgetCents ?? null,
      sortOrder: dto.sortOrder ?? 0,
    });

    return this.lotRepo.save(lot);
  }

  /* ───────────── Milestones ───────────── */

  async addMilestone(
    companyId: string,
    projectId: string,
    dto: AddMilestoneDto,
  ): Promise<ProjectMilestone> {
    await this.findById(companyId, projectId);

    const milestone = this.milestoneRepo.create({
      projectId,
      companyId,
      name: dto.name,
      targetDate: asDate(dto.targetDate),
      lotId: dto.lotId || null,
      status: dto.status ?? 'pending',
    });

    return this.milestoneRepo.save(milestone);
  }

  async updateMilestone(
    companyId: string,
    projectId: string,
    milestoneId: string,
    dto: UpdateMilestoneDto,
  ): Promise<ProjectMilestone> {
    await this.findById(companyId, projectId);

    const milestone = await this.milestoneRepo.findOne({
      where: { id: milestoneId, projectId, companyId },
    });
    if (!milestone) throw new NotFoundError('ProjectMilestone', milestoneId);

    Object.assign(milestone, dto);
    return this.milestoneRepo.save(milestone);
  }
}
