import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PortalToken } from './entities/portal-token.entity';
import { Project } from '../projects/entities/project.entity';
import { ProjectLot } from '../projects/entities/project-lot.entity';
import { ProjectMilestone } from '../projects/entities/project-milestone.entity';
import { Task } from '../projects/entities/task.entity';
import { DailyReport } from '../timekeeping/entities/daily-report.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import { CreatePortalTokenDto } from './dto/portal-token.dto';
import type { PortalContext } from './portal-access.guard';

const DAY_MS = 24 * 60 * 60 * 1000;
export const PORTAL_DEFAULT_DAYS = 90;
export const PORTAL_MAX_DAYS = 365;

interface TokenFilters {
  page?: number;
  limit?: number;
  projectId?: string;
}

@Injectable()
export class PortalService {
  constructor(
    @InjectRepository(PortalToken)
    private readonly tokenRepo: Repository<PortalToken>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(ProjectLot)
    private readonly lotRepo: Repository<ProjectLot>,
    @InjectRepository(ProjectMilestone)
    private readonly milestoneRepo: Repository<ProjectMilestone>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(DailyReport)
    private readonly dailyReportRepo: Repository<DailyReport>,
  ) {}

  /* ───────────── List Tokens ───────────── */

  async findAllTokens(companyId: string, filters: TokenFilters = {}) {
    const { page = 1, limit = 25, projectId } = filters;

    const qb = this.tokenRepo
      .createQueryBuilder('token')
      .leftJoin('token.project', 'project')
      .addSelect(['project.id', 'project.reference', 'project.name', 'project.status'])
      .leftJoin('token.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.firstName', 'createdBy.lastName'])
      .where('token.company_id = :companyId', { companyId });

    if (projectId) {
      qb.andWhere('token.project_id = :projectId', { projectId });
    }

    qb.orderBy('token.createdAt', 'DESC')
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

  /* ───────────── Create Token ───────────── */

  async createToken(
    companyId: string,
    userId: string,
    dto: CreatePortalTokenDto,
  ): Promise<PortalToken> {
    const project = await this.projectRepo.findOne({
      where: { id: dto.projectId, companyId },
    });
    if (!project) throw new NotFoundError('Project', dto.projectId);

    // A shared link must not stay open forever: 90 days unless chosen, never beyond a year, never in the past.
    const now = Date.now();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : new Date(now + PORTAL_DEFAULT_DAYS * DAY_MS);
    if (expiresAt.getTime() <= now || expiresAt.getTime() > now + PORTAL_MAX_DAYS * DAY_MS) {
      throw new BusinessRuleError(
        'INVALID_EXPIRY',
        `A portal link must expire in the future and within ${PORTAL_MAX_DAYS} days.`,
      );
    }

    const portalToken = this.tokenRepo.create({
      companyId,
      projectId: dto.projectId,
      token: randomUUID(),
      expiresAt,
      isActive: true,
      createdById: userId,
    });

    return this.tokenRepo.save(portalToken);
  }

  /* ───────────── Revoke Token ───────────── */

  async revokeToken(companyId: string, tokenId: string): Promise<PortalToken> {
    const portalToken = await this.tokenRepo.findOne({
      where: { id: tokenId, companyId },
    });
    if (!portalToken) throw new NotFoundError('PortalToken', tokenId);

    portalToken.isActive = false;
    return this.tokenRepo.save(portalToken);
  }

  /* ───────────── Get Portal Data (Public) ───────────── */

  /** The link was resolved by PortalAccessGuard, which also scoped the session to its company. */
  async getPortalData(ctx: PortalContext) {
    const project = await this.projectRepo.findOne({
      where: { id: ctx.projectId, companyId: ctx.companyId },
      select: [
        'id',
        'reference',
        'name',
        'status',
        'startDate',
        'endDate',
        'progressPercent',
        'address',
        'city',
      ],
    });

    if (!project) {
      throw new NotFoundError('Project', ctx.projectId);
    }

    // Lots (no financial data)
    const lots = await this.lotRepo.find({
      where: { projectId: project.id },
      select: ['id', 'name', 'description', 'sortOrder'],
      order: { sortOrder: 'ASC' },
    });

    // Milestones (no financial data)
    const milestones = await this.milestoneRepo.find({
      where: { projectId: project.id },
      select: ['id', 'name', 'targetDate', 'completedDate', 'status'],
      order: { targetDate: 'ASC' },
    });

    // Tasks (status only, no costs)
    const tasks = await this.taskRepo.find({
      where: { projectId: project.id },
      select: [
        'id',
        'lotId',
        'title',
        'status',
        'priority',
        'plannedStart',
        'plannedEnd',
        'progressPercent',
      ],
      order: { createdAt: 'ASC' },
    });

    // Recent daily reports (last 5). Notes are internal site remarks and stay private.
    const dailyReports = await this.dailyReportRepo.find({
      where: { projectId: project.id },
      select: [
        'id',
        'date',
        'workDescription',
        'weather',
        'temperatureCelsius',
      ],
      order: { date: 'DESC' },
      take: 5,
    });

    return {
      project,
      lots,
      milestones,
      tasks,
      dailyReports,
    };
  }
}
