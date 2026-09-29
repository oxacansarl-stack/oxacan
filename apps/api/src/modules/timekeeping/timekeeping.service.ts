import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { TimeEntry } from './entities/time-entry.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';

interface TimeEntryFilters {
  page?: number;
  limit?: number;
  userId?: string;
  projectId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface ClockInDto {
  projectId: string;
  taskId?: string;
  category?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
}

interface UpdateTimeEntryDto {
  breakMinutes?: number;
  notes?: string;
  category?: string;
  travelMinutes?: number;
  taskId?: string;
  latitude?: number;
  longitude?: number;
}

const NORMAL_DAY_MINUTES = 480; // 8h (CCT)

@Injectable()
export class TimekeepingService {
  constructor(
    @InjectRepository(TimeEntry)
    private readonly timeEntryRepo: Repository<TimeEntry>,
    @InjectRepository(AppUser)
    private readonly userRepo: Repository<AppUser>,
  ) {}

  /* ───────────── List ───────────── */

  async findAllTimeEntries(companyId: string, filters: TimeEntryFilters = {}) {
    const { page = 1, limit = 25, userId, projectId, status, dateFrom, dateTo } = filters;

    const qb = this.timeEntryRepo
      .createQueryBuilder('te')
      .leftJoinAndSelect('te.user', 'user')
      .leftJoinAndSelect('te.project', 'project')
      .where('te.company_id = :companyId', { companyId });

    if (userId) {
      qb.andWhere('te.user_id = :userId', { userId });
    }
    if (projectId) {
      qb.andWhere('te.project_id = :projectId', { projectId });
    }
    if (status) {
      qb.andWhere('te.status = :status', { status });
    }
    if (dateFrom) {
      qb.andWhere('te.date >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      qb.andWhere('te.date <= :dateTo', { dateTo });
    }

    qb.orderBy('te.date', 'DESC')
      .addOrderBy('te.start_time', 'DESC')
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

  async findTimeEntryById(companyId: string, id: string): Promise<TimeEntry> {
    const entry = await this.timeEntryRepo.findOne({
      where: { id, companyId },
      relations: ['user', 'project', 'task', 'approver'],
    });
    if (!entry) throw new NotFoundError('TimeEntry', id);
    return entry;
  }

  /* ───────────── Clock In ───────────── */

  async clockIn(companyId: string, userId: string, dto: ClockInDto): Promise<TimeEntry> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);

    // Validate no open entry exists for this user today
    const openEntry = await this.timeEntryRepo.findOne({
      where: {
        companyId,
        userId,
        date: dateStr as any,
        endTime: IsNull(),
      },
    });

    if (openEntry) {
      throw new BusinessRuleError(
        'OPEN_ENTRY_EXISTS',
        'You already have an open time entry today. Please clock out first.',
      );
    }

    // Snapshot user's hourly rate
    const user = await this.userRepo.findOne({
      where: { id: userId, companyId },
    });
    if (!user) throw new NotFoundError('AppUser', userId);

    const now = new Date();
    const startTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const entry = this.timeEntryRepo.create({
      companyId,
      userId,
      projectId: dto.projectId,
      taskId: dto.taskId || null,
      date: dateStr as any,
      startTime,
      endTime: null,
      breakMinutes: 0,
      normalMinutes: null,
      overtimeMinutes: 0,
      travelMinutes: 0,
      totalMinutes: null,
      hourlyRateCents: user.hourlyRateCents,
      costCents: null,
      category: dto.category || 'normal',
      status: 'draft',
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      notes: dto.notes || null,
    });

    return this.timeEntryRepo.save(entry);
  }

  /* ───────────── Clock Out ───────────── */

  async clockOut(companyId: string, userId: string, id: string): Promise<TimeEntry> {
    const entry = await this.timeEntryRepo.findOne({
      where: { id, companyId, userId },
    });
    if (!entry) throw new NotFoundError('TimeEntry', id);

    if (entry.endTime) {
      throw new BusinessRuleError(
        'ALREADY_CLOCKED_OUT',
        'This time entry has already been clocked out.',
      );
    }

    const now = new Date();
    const endTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    entry.endTime = endTime;

    // Compute total minutes from startTime/endTime
    const startParts = entry.startTime.split(':').map(Number);
    const endParts = endTime.split(':').map(Number);
    const startMinTotal = startParts[0] * 60 + startParts[1];
    const endMinTotal = endParts[0] * 60 + endParts[1];
    const workedMinutes = endMinTotal - startMinTotal - entry.breakMinutes;
    const effectiveMinutes = Math.max(workedMinutes, 0);

    entry.totalMinutes = effectiveMinutes;

    if (entry.category === 'travel') {
      // Travel time goes into travelMinutes, not normal/overtime
      entry.travelMinutes = effectiveMinutes;
      entry.normalMinutes = 0;
      entry.overtimeMinutes = 0;
    } else {
      // Swiss CCT: normal day = 8h (480 min). Compute day totals for overtime split.
      const dayTotalBefore = await this.getDayNormalMinutes(companyId, userId, entry.date, id);
      const cumulativeBefore = dayTotalBefore;
      const cumulativeAfter = cumulativeBefore + effectiveMinutes;

      if (cumulativeAfter <= NORMAL_DAY_MINUTES) {
        entry.normalMinutes = effectiveMinutes;
        entry.overtimeMinutes = 0;
      } else if (cumulativeBefore >= NORMAL_DAY_MINUTES) {
        entry.normalMinutes = 0;
        entry.overtimeMinutes = effectiveMinutes;
      } else {
        entry.normalMinutes = NORMAL_DAY_MINUTES - cumulativeBefore;
        entry.overtimeMinutes = cumulativeAfter - NORMAL_DAY_MINUTES;
      }
    }

    // costCents = totalMinutes / 60 * hourlyRateCents
    if (entry.hourlyRateCents) {
      entry.costCents = Math.round((entry.totalMinutes / 60) * entry.hourlyRateCents);
    }

    return this.timeEntryRepo.save(entry);
  }

  /* ───────────── Update ───────────── */

  async updateTimeEntry(companyId: string, id: string, dto: UpdateTimeEntryDto): Promise<TimeEntry> {
    const entry = await this.findTimeEntryById(companyId, id);

    if (entry.status === 'approved') {
      throw new BusinessRuleError(
        'ENTRY_APPROVED',
        'Cannot modify an approved time entry.',
      );
    }

    if (dto.breakMinutes !== undefined) entry.breakMinutes = dto.breakMinutes;
    if (dto.notes !== undefined) entry.notes = dto.notes;
    if (dto.category !== undefined) entry.category = dto.category;
    if (dto.travelMinutes !== undefined) entry.travelMinutes = dto.travelMinutes;
    if (dto.taskId !== undefined) entry.taskId = dto.taskId;
    if (dto.latitude !== undefined) entry.latitude = dto.latitude;
    if (dto.longitude !== undefined) entry.longitude = dto.longitude;

    // Recalculate derived fields if entry is clocked out
    if (entry.endTime) {
      const startParts = entry.startTime.split(':').map(Number);
      const endParts = entry.endTime.split(':').map(Number);
      const startMinTotal = startParts[0] * 60 + startParts[1];
      const endMinTotal = endParts[0] * 60 + endParts[1];
      const workedMinutes = endMinTotal - startMinTotal - entry.breakMinutes;
      const effectiveMinutes = Math.max(workedMinutes, 0);

      entry.totalMinutes = effectiveMinutes;

      if (entry.category === 'travel') {
        entry.travelMinutes = effectiveMinutes;
        entry.normalMinutes = 0;
        entry.overtimeMinutes = 0;
      } else {
        const dayTotalBefore = await this.getDayNormalMinutes(companyId, entry.userId, entry.date, id);
        const cumulativeAfter = dayTotalBefore + effectiveMinutes;

        if (cumulativeAfter <= NORMAL_DAY_MINUTES) {
          entry.normalMinutes = effectiveMinutes;
          entry.overtimeMinutes = 0;
        } else if (dayTotalBefore >= NORMAL_DAY_MINUTES) {
          entry.normalMinutes = 0;
          entry.overtimeMinutes = effectiveMinutes;
        } else {
          entry.normalMinutes = NORMAL_DAY_MINUTES - dayTotalBefore;
          entry.overtimeMinutes = cumulativeAfter - NORMAL_DAY_MINUTES;
        }
      }

      if (entry.hourlyRateCents) {
        entry.costCents = Math.round((entry.totalMinutes / 60) * entry.hourlyRateCents);
      }
    }

    return this.timeEntryRepo.save(entry);
  }

  /* ───────────── Submit for Approval ───────────── */

  async submitForApproval(companyId: string, userId: string) {
    const drafts = await this.timeEntryRepo.find({
      where: { companyId, userId, status: 'draft' },
    });

    if (drafts.length === 0) {
      throw new BusinessRuleError(
        'NO_DRAFT_ENTRIES',
        'No draft time entries to submit.',
      );
    }

    const openEntries = drafts.filter((e) => !e.endTime);
    if (openEntries.length > 0) {
      throw new BusinessRuleError(
        'OPEN_ENTRIES_EXIST',
        `${openEntries.length} time entries have not been clocked out. Please clock out before submitting.`,
      );
    }

    for (const entry of drafts) {
      entry.status = 'submitted';
    }

    return this.timeEntryRepo.save(drafts);
  }

  /* ───────────── Approve ───────────── */

  async approveEntries(companyId: string, approverId: string, entryIds: string[]) {
    const entries = await this.timeEntryRepo
      .createQueryBuilder('te')
      .where('te.company_id = :companyId', { companyId })
      .andWhere('te.id IN (:...entryIds)', { entryIds })
      .getMany();

    if (entries.length !== entryIds.length) {
      throw new NotFoundError('TimeEntry', 'one or more entries');
    }

    const now = new Date();
    for (const entry of entries) {
      if (entry.status !== 'submitted') {
        throw new BusinessRuleError(
          'INVALID_STATUS',
          `Time entry ${entry.id} is not in 'submitted' status.`,
        );
      }
      entry.status = 'approved';
      entry.approvedBy = approverId;
      entry.approvedAt = now;
    }

    return this.timeEntryRepo.save(entries);
  }

  /* ───────────── Reject ───────────── */

  async rejectEntries(companyId: string, approverId: string, entryIds: string[], reason: string) {
    const entries = await this.timeEntryRepo
      .createQueryBuilder('te')
      .where('te.company_id = :companyId', { companyId })
      .andWhere('te.id IN (:...entryIds)', { entryIds })
      .getMany();

    if (entries.length !== entryIds.length) {
      throw new NotFoundError('TimeEntry', 'one or more entries');
    }

    for (const entry of entries) {
      if (entry.status !== 'submitted') {
        throw new BusinessRuleError(
          'INVALID_STATUS',
          `Time entry ${entry.id} is not in 'submitted' status.`,
        );
      }
      entry.status = 'rejected';
      entry.notes = entry.notes
        ? `${entry.notes}\n[Rejected by ${approverId}]: ${reason}`
        : `[Rejected]: ${reason}`;
    }

    return this.timeEntryRepo.save(entries);
  }

  /* ───────────── Weekly Summary ───────────── */

  async getWeeklySummary(companyId: string, userId: string, weekStartDate: string) {
    // weekStartDate is Monday (ISO); get entries for 7 days
    const weekStart = new Date(weekStartDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const entries = await this.timeEntryRepo
      .createQueryBuilder('te')
      .where('te.company_id = :companyId', { companyId })
      .andWhere('te.user_id = :userId', { userId })
      .andWhere('te.date >= :weekStart', { weekStart: weekStartDate })
      .andWhere('te.date <= :weekEnd', { weekEnd: weekEndStr })
      .orderBy('te.date', 'ASC')
      .addOrderBy('te.start_time', 'ASC')
      .getMany();

    let totalNormal = 0;
    let totalOvertime = 0;
    let totalTravel = 0;
    let totalCost = 0;

    const entriesByDay: Record<string, TimeEntry[]> = {};

    for (const entry of entries) {
      totalNormal += entry.normalMinutes || 0;
      totalOvertime += entry.overtimeMinutes || 0;
      totalTravel += entry.travelMinutes || 0;
      totalCost += entry.costCents || 0;

      const dateKey = typeof entry.date === 'string'
        ? entry.date
        : (entry.date as Date).toISOString().slice(0, 10);

      if (!entriesByDay[dateKey]) {
        entriesByDay[dateKey] = [];
      }
      entriesByDay[dateKey].push(entry);
    }

    return {
      totalNormal,
      totalOvertime,
      totalTravel,
      totalCost,
      entriesByDay,
    };
  }

  /* ───────────── Private Helpers ───────────── */

  /**
   * Get total normal+overtime minutes already recorded for a user on a given day,
   * excluding a specific entry (to avoid counting the entry being clocked out).
   */
  private async getDayNormalMinutes(
    companyId: string,
    userId: string,
    date: Date,
    excludeEntryId: string,
  ): Promise<number> {
    const result = await this.timeEntryRepo
      .createQueryBuilder('te')
      .select('COALESCE(SUM(te.total_minutes), 0)', 'total')
      .where('te.company_id = :companyId', { companyId })
      .andWhere('te.user_id = :userId', { userId })
      .andWhere('te.date = :date', { date })
      .andWhere('te.id != :excludeEntryId', { excludeEntryId })
      .andWhere("te.category != 'travel'")
      .getRawOne();

    return parseInt(result?.total || '0', 10);
  }
}
