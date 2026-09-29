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

interface ProjectFilters {
  page?: number;
  limit?: number;
  status?: string;
  clientId?: string;
  managerId?: string;
}

interface UpdateProjectDto {
  name?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  managerId?: string | null;
  status?: string;
}

interface AddLotDto {
  name: string;
  description?: string;
  budgetCents?: number;
  sortOrder?: number;
}

interface AddMilestoneDto {
  name: string;
  targetDate?: Date;
  lotId?: string;
  status?: string;
}

interface UpdateMilestoneDto {
  name?: string;
  targetDate?: Date | null;
  completedDate?: Date | null;
  status?: string;
}

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

    qb.orderBy('project.created_at', 'DESC')
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

    // 2. Generate reference: PRJ-{YEAR}-{sequence}
    const year = new Date().getFullYear();
    const existingCount = await this.projectRepo.count({
      where: { companyId },
    });
    const sequence = String(existingCount + 1).padStart(4, '0');
    const reference = `PRJ-${year}-${sequence}`;

    // 3. Create project
    const startDate = new Date();
    const project = this.projectRepo.create({
      companyId,
      contractId: contract.id,
      clientId: contract.clientId,
      reference,
      name: offer.projectName,
      status: 'planning',
      startDate,
      budgetHtCents: offer.totalHtCents,
      managerId: userId,
    });
    const savedProject = await this.projectRepo.save(project);

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
    const targetDate = new Date(startDate);
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
    return this.projectRepo.save(project);
  }

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
      targetDate: dto.targetDate || null,
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
