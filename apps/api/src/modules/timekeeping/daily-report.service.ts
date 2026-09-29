import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyReport } from './entities/daily-report.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import { AccessScopeService, ScopeUser } from './access-scope.service';
import { CreateDailyReportDto, UpdateDailyReportDto } from './dto/daily-report.dto';

interface DailyReportFilters {
  page?: number;
  limit?: number;
  userId?: string;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class DailyReportService {
  constructor(
    @InjectRepository(DailyReport)
    private readonly reportRepo: Repository<DailyReport>,
    private readonly scope: AccessScopeService,
  ) {}

  /** Reports with user/project reduced to non-sensitive columns. */
  private listQuery(companyId: string) {
    return this.reportRepo
      .createQueryBuilder('dr')
      .leftJoin('dr.user', 'user')
      .addSelect(['user.id', 'user.firstName', 'user.lastName'])
      .leftJoin('dr.project', 'project')
      .addSelect(['project.id', 'project.name', 'project.reference'])
      .where('dr.company_id = :companyId', { companyId });
  }

  /** Relation-free load for mutations; 404 outside the caller's scope. */
  private async loadScoped(caller: ScopeUser, id: string): Promise<DailyReport> {
    const report = await this.reportRepo.findOne({ where: { id, companyId: caller.companyId } });
    if (!report || !(await this.scope.canSee(caller, report.userId))) {
      throw new NotFoundError('DailyReport', id);
    }
    return report;
  }

  /* ───────────── List ───────────── */

  async findAll(caller: ScopeUser, filters: DailyReportFilters = {}) {
    const { page = 1, limit = 25, userId, projectId, dateFrom, dateTo } = filters;

    const qb = this.listQuery(caller.companyId);

    // Visibility scope first; a ?userId outside it can only narrow to nothing.
    const visible = await this.scope.visibleUserIds(caller);
    if (visible) {
      qb.andWhere('dr.user_id IN (:...visible)', { visible });
    }
    if (userId) {
      qb.andWhere('dr.user_id = :userId', { userId });
    }
    if (projectId) {
      qb.andWhere('dr.project_id = :projectId', { projectId });
    }
    if (dateFrom) {
      qb.andWhere('dr.date >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      qb.andWhere('dr.date <= :dateTo', { dateTo });
    }

    qb.orderBy('dr.date', 'DESC')
      .addOrderBy('dr.createdAt', 'DESC')
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

  /* ───────────── Find by ID ───────────── */

  async findById(caller: ScopeUser, id: string): Promise<DailyReport> {
    const report = await this.listQuery(caller.companyId)
      .andWhere('dr.id = :id', { id })
      .getOne();
    if (!report || !(await this.scope.canSee(caller, report.userId))) {
      throw new NotFoundError('DailyReport', id);
    }
    return report;
  }

  /* ───────────── Create ───────────── */

  async create(companyId: string, userId: string, dto: CreateDailyReportDto): Promise<DailyReport> {
    await this.scope.assertProjectInCompany(companyId, dto.projectId);

    // Enforce UNIQUE(company_id, user_id, project_id, date)
    const existing = await this.reportRepo.findOne({
      where: {
        companyId,
        userId,
        projectId: dto.projectId,
        date: dto.date as any,
      },
    });

    if (existing) {
      throw new BusinessRuleError(
        'DUPLICATE_REPORT',
        'A daily report already exists for this user, project, and date.',
      );
    }

    const report = this.reportRepo.create({
      companyId,
      userId,
      projectId: dto.projectId,
      date: dto.date as any,
      workDescription: dto.workDescription || null,
      materialsUsed: dto.materialsUsed || [],
      weather: dto.weather || null,
      temperatureCelsius: dto.temperatureCelsius ?? null,
      notes: dto.notes || null,
      photos: dto.photos || [],
    });

    return this.reportRepo.save(report);
  }

  /* ───────────── Update ───────────── */

  async update(caller: ScopeUser, id: string, dto: UpdateDailyReportDto): Promise<DailyReport> {
    const report = await this.loadScoped(caller, id);

    if (dto.workDescription !== undefined) report.workDescription = dto.workDescription;
    if (dto.materialsUsed !== undefined) report.materialsUsed = dto.materialsUsed;
    if (dto.weather !== undefined) report.weather = dto.weather;
    if (dto.temperatureCelsius !== undefined) report.temperatureCelsius = dto.temperatureCelsius;
    if (dto.notes !== undefined) report.notes = dto.notes;
    if (dto.photos !== undefined) report.photos = dto.photos;

    return this.reportRepo.save(report);
  }

  /* ───────────── Delete ───────────── */

  async delete(caller: ScopeUser, id: string): Promise<void> {
    const report = await this.loadScoped(caller, id);
    await this.reportRepo.remove(report);
  }
}
