import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, EntityManager } from 'typeorm';
import { TimeEntry } from './entities/time-entry.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { NotFoundError, BusinessRuleError, ValidationError } from '@oxacan/shared-types';
import { AccessScopeService, ScopeUser } from './access-scope.service';
import { APP_TIME_ZONE, todayInZurich } from '../../common/util/business-date';
import { NotificationsService } from '../notifications/notifications.service';
import { notifyOwners } from './approval-notifications';
import { ClockInDto, UpdateTimeEntryDto } from './dto/time-entry.dto';

interface TimeEntryFilters {
  page?: number;
  limit?: number;
  userId?: string;
  projectId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

const NORMAL_DAY_MINUTES = 480; // 8h (CCT)

/** A rejected entry goes back to its owner, who corrects and resubmits it. */
const SUBMITTABLE = ['draft', 'rejected'];

/** Current calendar date and wall-clock time on Swiss sites, independent of the server's zone. */
/** How far a client-reported time may lie in the future (clock drift) or the past (offline). */
const MAX_CLIENT_CLOCK_AHEAD_MS = 2 * 60 * 1000;
const MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_THRESHOLD_MS = 60 * 1000;

/** Validates a client-reported event time; returns it and whether it was recorded offline. */
function resolveOccurredAt(occurredAt?: string): { at: Date; offline: boolean } {
  const now = Date.now();
  if (!occurredAt) return { at: new Date(now), offline: false };
  const at = new Date(occurredAt);
  if (at.getTime() > now + MAX_CLIENT_CLOCK_AHEAD_MS) {
    throw new ValidationError('occurredAt is in the future. Check the device clock.');
  }
  if (at.getTime() < now - MAX_OFFLINE_AGE_MS) {
    throw new ValidationError('occurredAt is more than 7 days old; ask your team leader to enter it manually.');
  }
  return { at, offline: now - at.getTime() > OFFLINE_THRESHOLD_MS };
}

function localNow(at: Date = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

@Injectable()
export class TimekeepingService {
  constructor(
    @InjectRepository(TimeEntry)
    private readonly timeEntryRepo: Repository<TimeEntry>,
    @InjectRepository(AppUser)
    private readonly userRepo: Repository<AppUser>,
    private readonly scope: AccessScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Entries with their user/project reduced to non-sensitive columns (no rates, no budgets). */
  private listQuery(companyId: string) {
    return this.timeEntryRepo
      .createQueryBuilder('te')
      .leftJoin('te.user', 'user')
      .addSelect(['user.id', 'user.firstName', 'user.lastName'])
      .leftJoin('te.project', 'project')
      .addSelect(['project.id', 'project.name', 'project.reference'])
      .where('te.company_id = :companyId', { companyId });
  }

  /* ───────────── List ───────────── */

  async findAllTimeEntries(caller: ScopeUser, filters: TimeEntryFilters = {}) {
    const { page = 1, limit = 25, userId, projectId, status, dateFrom, dateTo } = filters;

    const qb = this.listQuery(caller.companyId);

    // Visibility scope first; a ?userId outside it can only narrow to nothing.
    const visible = await this.scope.visibleUserIds(caller);
    if (visible) {
      qb.andWhere('te.user_id IN (:...visible)', { visible });
    }
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
      .addOrderBy('te.startTime', 'DESC')
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

  /** 404 when the entry does not exist in the company or is outside the caller's scope. */
  async findTimeEntryById(caller: ScopeUser, id: string): Promise<TimeEntry> {
    const entry = await this.listQuery(caller.companyId)
      .leftJoin('te.task', 'task')
      .addSelect(['task.id', 'task.title'])
      .leftJoin('te.approver', 'approver')
      .addSelect(['approver.id', 'approver.firstName', 'approver.lastName'])
      .andWhere('te.id = :id', { id })
      .getOne();
    if (!entry || !(await this.scope.canSee(caller, entry.userId))) {
      throw new NotFoundError('TimeEntry', id);
    }
    return entry;
  }

  /** Relation-free load for mutations (loaded relations would override changed FK columns on save). */
  private async loadScoped(caller: ScopeUser, id: string): Promise<TimeEntry> {
    const entry = await this.timeEntryRepo.findOne({ where: { id, companyId: caller.companyId } });
    if (!entry || !(await this.scope.canSee(caller, entry.userId))) {
      throw new NotFoundError('TimeEntry', id);
    }
    return entry;
  }

  /* ───────────── Clock In ───────────── */

  async clockIn(companyId: string, userId: string, dto: ClockInDto): Promise<TimeEntry> {
    await this.scope.assertProjectInCompany(companyId, dto.projectId);
    if (dto.taskId) await this.scope.assertTaskInCompany(companyId, dto.taskId);

    const occurred = resolveOccurredAt(dto.occurredAt);
    const { date: dateStr, time: startTime } = localNow(occurred.at);

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
      isOfflineEntry: occurred.offline,
      syncedAt: occurred.offline ? new Date() : null,
    });

    return this.timeEntryRepo.save(entry);
  }

  /* ───────────── Clock Out ───────────── */

  async clockOut(companyId: string, userId: string, id: string, occurredAt?: string): Promise<TimeEntry> {
    // Only the owner may clock out their own entry (others get 404).
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

    const occurred = resolveOccurredAt(occurredAt);
    const { date: endDate, time: endTime } = localNow(occurred.at);
    const entryDate = String(entry.date).slice(0, 10);
    if (endDate < entryDate || (endDate === entryDate && endTime < entry.startTime)) {
      throw new ValidationError('Clock-out cannot be earlier than clock-in.');
    }
    if (occurred.offline) entry.syncedAt = new Date();

    entry.endTime = endTime;

    // Compute total minutes from startTime/endTime
    const startParts = entry.startTime.split(':').map(Number);
    const endParts = endTime.split(':').map(Number);
    const startMinTotal = startParts[0] * 60 + startParts[1];
    const endMinTotal = endParts[0] * 60 + endParts[1];
    // A shift that crosses midnight ends on the next day.
    const spanMinutes =
      endMinTotal >= startMinTotal ? endMinTotal - startMinTotal : endMinTotal + 24 * 60 - startMinTotal;
    const workedMinutes = spanMinutes - entry.breakMinutes;
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

  async updateTimeEntry(caller: ScopeUser, id: string, dto: UpdateTimeEntryDto): Promise<TimeEntry> {
    const companyId = caller.companyId;
    const entry = await this.loadScoped(caller, id);

    if (entry.status === 'approved') {
      throw new BusinessRuleError(
        'ENTRY_APPROVED',
        'Cannot modify an approved time entry.',
      );
    }
    // Once submitted, only the reviewer (team leader / office) may correct it.
    if (entry.userId === caller.id && !['draft', 'rejected'].includes(entry.status)) {
      throw new BusinessRuleError(
        'ENTRY_SUBMITTED',
        'This entry is awaiting approval and can no longer be edited.',
      );
    }

    if (dto.taskId) await this.scope.assertTaskInCompany(companyId, dto.taskId);

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
      // A shift that crosses midnight ends on the next day.
      const spanMinutes =
        endMinTotal >= startMinTotal ? endMinTotal - startMinTotal : endMinTotal + 24 * 60 - startMinTotal;
      const workedMinutes = spanMinutes - entry.breakMinutes;
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

  /**
   * Submits the caller's own draft entries: the given ids, or every draft when omitted.
   * Ids that are not the caller's own entries → 404 (nothing submitted).
   */
  async submitForApproval(companyId: string, userId: string, entryIds?: string[]) {
    let drafts: TimeEntry[];

    if (entryIds && entryIds.length > 0) {
      const ids = [...new Set(entryIds)];
      drafts = await this.timeEntryRepo.find({
        where: { companyId, userId, id: In(ids) },
      });
      if (drafts.length !== ids.length) {
        throw new NotFoundError('TimeEntry', 'one or more entries');
      }
      const notDraft = drafts.find((e) => !SUBMITTABLE.includes(e.status));
      if (notDraft) {
        throw new BusinessRuleError(
          'INVALID_STATUS',
          `Time entry ${notDraft.id} is not a draft or rejected entry.`,
        );
      }
    } else {
      drafts = await this.timeEntryRepo.find({
        where: { companyId, userId, status: In(SUBMITTABLE) },
      });
    }

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
      entry.rejectionReason = null;
      entry.rejectedBy = null;
      entry.rejectedAt = null;
    }

    return this.timeEntryRepo.save(drafts);
  }

  /* ───────────── Approve / Reject ───────────── */

  /**
   * Loads the requested entries and enforces the approval scope before anything changes:
   * TEAM_LEADER → 403 unless every id is a team member's entry (never their own);
   * office roles → 404 when an id does not exist in the company.
   */
  private async loadForApproval(approver: ScopeUser, entryIds: string[], m: EntityManager): Promise<TimeEntry[]> {
    const ids = [...new Set(entryIds)];
    // Row locks: a concurrent approve / reject of the same rows waits here, then sees the new status.
    const entries = await m.find(TimeEntry, {
      where: { companyId: approver.companyId, id: In(ids) },
      lock: { mode: 'pessimistic_write' },
    });

    await this.scope.assertCanApprove(approver, entries.map((e) => e.userId), ids.length);

    if (entries.length !== ids.length) {
      throw new NotFoundError('TimeEntry', 'one or more entries');
    }

    for (const entry of entries) {
      if (entry.status !== 'submitted') {
        throw new BusinessRuleError(
          'INVALID_STATUS',
          `Time entry ${entry.id} is not in 'submitted' status.`,
        );
      }
    }
    return entries;
  }

  async approveEntries(approver: ScopeUser, entryIds: string[]) {
    return this.timeEntryRepo.manager.transaction(async (m) => {
      const entries = await this.loadForApproval(approver, entryIds, m);

      const now = new Date();
      for (const entry of entries) {
        entry.status = 'approved';
        entry.approvedBy = approver.id;
        entry.approvedAt = now;
      }

      const saved = await m.save(entries);
      await notifyOwners(this.notifications, m, approver, saved, 'time_approved', (n) =>
        n === 1 ? 'Vos heures ont été approuvées' : `${n} de vos saisies d'heures ont été approuvées`);
      return saved;
    });
  }

  async rejectEntries(approver: ScopeUser, entryIds: string[], reason: string) {
    return this.timeEntryRepo.manager.transaction(async (m) => {
      const entries = await this.loadForApproval(approver, entryIds, m);

      const now = new Date();
      for (const entry of entries) {
        entry.status = 'rejected';
        entry.rejectionReason = reason;
        entry.rejectedBy = approver.id;
        entry.rejectedAt = now;
      }

      const saved = await m.save(entries);
      await notifyOwners(this.notifications, m, approver, saved, 'time_rejected', (n) =>
        n === 1 ? 'Vos heures ont été refusées' : `${n} de vos saisies d'heures ont été refusées`, reason);
      return saved;
    });
  }

  /* ───────────── Weekly Summary ───────────── */

  async getWeeklySummary(companyId: string, userId: string, weekStartDate?: string) {
    let weekStart: Date;
    if (weekStartDate) {
      weekStart = new Date(`${weekStartDate}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate) || isNaN(weekStart.getTime())) {
        throw new ValidationError('weekStart must be a date in YYYY-MM-DD format.');
      }
    } else {
      // Seed from the Zurich calendar day: after midnight local, the UTC day is still yesterday
      // and would shift the whole week (PRD §23.5).
      weekStart = new Date(`${todayInZurich()}T00:00:00Z`);
      weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    }
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    const entries = await this.timeEntryRepo
      .createQueryBuilder('te')
      .where('te.company_id = :companyId', { companyId })
      .andWhere('te.user_id = :userId', { userId })
      .andWhere('te.date >= :weekStart', { weekStart: weekStartStr })
      .andWhere('te.date <= :weekEnd', { weekEnd: weekEndStr })
      .orderBy('te.date', 'ASC')
      .addOrderBy('te.startTime', 'ASC')
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
      userId,
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
