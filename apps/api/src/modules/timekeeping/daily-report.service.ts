import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyReport } from './entities/daily-report.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';

interface DailyReportFilters {
  page?: number;
  limit?: number;
  userId?: string;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface CreateDailyReportDto {
  projectId: string;
  date: string;
  workDescription?: string;
  materialsUsed?: Record<string, unknown>[];
  weather?: string;
  temperatureCelsius?: number;
  notes?: string;
  photos?: Record<string, unknown>[];
}

interface UpdateDailyReportDto {
  workDescription?: string;
  materialsUsed?: Record<string, unknown>[];
  weather?: string;
  temperatureCelsius?: number;
  notes?: string;
  photos?: Record<string, unknown>[];
}

@Injectable()
export class DailyReportService {
  constructor(
    @InjectRepository(DailyReport)
    private readonly reportRepo: Repository<DailyReport>,
  ) {}

  /* ───────────── List ───────────── */

  async findAll(companyId: string, filters: DailyReportFilters = {}) {
    const { page = 1, limit = 25, userId, projectId, dateFrom, dateTo } = filters;

    const qb = this.reportRepo
      .createQueryBuilder('dr')
      .leftJoinAndSelect('dr.user', 'user')
      .leftJoinAndSelect('dr.project', 'project')
      .where('dr.company_id = :companyId', { companyId });

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

  async findById(companyId: string, id: string): Promise<DailyReport> {
    const report = await this.reportRepo.findOne({
      where: { id, companyId },
      relations: ['user', 'project'],
    });
    if (!report) throw new NotFoundError('DailyReport', id);
    return report;
  }

  /* ───────────── Create ───────────── */

  async create(companyId: string, userId: string, dto: CreateDailyReportDto): Promise<DailyReport> {
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

  async update(companyId: string, id: string, dto: UpdateDailyReportDto): Promise<DailyReport> {
    const report = await this.findById(companyId, id);

    if (dto.workDescription !== undefined) report.workDescription = dto.workDescription;
    if (dto.materialsUsed !== undefined) report.materialsUsed = dto.materialsUsed;
    if (dto.weather !== undefined) report.weather = dto.weather;
    if (dto.temperatureCelsius !== undefined) report.temperatureCelsius = dto.temperatureCelsius;
    if (dto.notes !== undefined) report.notes = dto.notes;
    if (dto.photos !== undefined) report.photos = dto.photos;

    return this.reportRepo.save(report);
  }

  /* ───────────── Delete ───────────── */

  async delete(companyId: string, id: string): Promise<void> {
    const report = await this.findById(companyId, id);
    await this.reportRepo.remove(report);
  }
}
