import { NotificationsService } from '../notifications/notifications.service';
import { notifyOwners } from './approval-notifications';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, EntityManager } from 'typeorm';
import { Expense } from './entities/expense.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import { AccessScopeService, ScopeUser } from './access-scope.service';
import { assertProjectExists } from '../../common/util/assert-project';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

interface ExpenseFilters {
  page?: number;
  limit?: number;
  userId?: string;
  projectId?: string;
  status?: string;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class ExpenseService {
  constructor(
    @InjectRepository(Expense)
    private readonly expenseRepo: Repository<Expense>,
    private readonly scope: AccessScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Expenses with user/project reduced to non-sensitive columns. */
  private listQuery(companyId: string) {
    return this.expenseRepo
      .createQueryBuilder('exp')
      .leftJoin('exp.user', 'user')
      .addSelect(['user.id', 'user.firstName', 'user.lastName'])
      .leftJoin('exp.project', 'project')
      .addSelect(['project.id', 'project.name', 'project.reference'])
      .where('exp.company_id = :companyId', { companyId });
  }

  /** Relation-free load for mutations; 404 outside the caller's scope. */
  private async loadScoped(caller: ScopeUser, id: string): Promise<Expense> {
    const expense = await this.expenseRepo.findOne({ where: { id, companyId: caller.companyId } });
    if (!expense || !(await this.scope.canSee(caller, expense.userId))) {
      throw new NotFoundError('Expense', id);
    }
    return expense;
  }

  /* ───────────── List ───────────── */

  async findAll(caller: ScopeUser, filters: ExpenseFilters = {}) {
    const { page = 1, limit = 25, userId, projectId, status, category, dateFrom, dateTo } = filters;

    const qb = this.listQuery(caller.companyId);

    // Visibility scope first; a ?userId outside it can only narrow to nothing.
    const visible = await this.scope.visibleUserIds(caller);
    if (visible) {
      qb.andWhere('exp.user_id IN (:...visible)', { visible });
    }
    if (userId) {
      qb.andWhere('exp.user_id = :userId', { userId });
    }
    if (projectId) {
      qb.andWhere('exp.project_id = :projectId', { projectId });
    }
    if (status) {
      qb.andWhere('exp.status = :status', { status });
    }
    if (category) {
      qb.andWhere('exp.category = :category', { category });
    }
    if (dateFrom) {
      qb.andWhere('exp.date >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      qb.andWhere('exp.date <= :dateTo', { dateTo });
    }

    qb.orderBy('exp.date', 'DESC')
      .addOrderBy('exp.createdAt', 'DESC')
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

  async findById(caller: ScopeUser, id: string): Promise<Expense> {
    const expense = await this.listQuery(caller.companyId)
      .leftJoin('exp.task', 'task')
      .addSelect(['task.id', 'task.title'])
      .leftJoin('exp.approver', 'approver')
      .addSelect(['approver.id', 'approver.firstName', 'approver.lastName'])
      .andWhere('exp.id = :id', { id })
      .getOne();
    if (!expense || !(await this.scope.canSee(caller, expense.userId))) {
      throw new NotFoundError('Expense', id);
    }
    return expense;
  }

  /* ───────────── Create ───────────── */

  async create(companyId: string, userId: string, dto: CreateExpenseDto): Promise<Expense> {
    if (dto.projectId) await this.scope.assertProjectInCompany(companyId, dto.projectId);
    if (dto.taskId) await this.scope.assertTaskInCompany(companyId, dto.taskId);

    const expense = this.expenseRepo.create({
      companyId,
      userId,
      projectId: dto.projectId || null,
      taskId: dto.taskId || null,
      date: dto.date as any,
      category: dto.category,
      description: dto.description,
      amountCents: dto.amountCents,
      receiptUrl: dto.receiptUrl || null,
      isBillable: dto.isBillable ?? false,
      status: 'draft',
    });

    return this.expenseRepo.save(expense);
  }

  /* ───────────── Update ───────────── */

  async update(caller: ScopeUser, id: string, dto: UpdateExpenseDto): Promise<Expense> {
    const expense = await this.loadScoped(caller, id);

    if (expense.status !== 'draft') {
      throw new BusinessRuleError(
        'NOT_DRAFT',
        'Only draft expenses can be edited.',
      );
    }

    if (dto.projectId) await this.scope.assertProjectInCompany(caller.companyId, dto.projectId);
    if (dto.taskId) await this.scope.assertTaskInCompany(caller.companyId, dto.taskId);

    if (dto.projectId !== undefined) expense.projectId = dto.projectId || null;
    if (dto.taskId !== undefined) expense.taskId = dto.taskId || null;
    if (dto.date !== undefined) expense.date = dto.date as any;
    if (dto.category !== undefined) expense.category = dto.category;
    if (dto.description !== undefined) expense.description = dto.description;
    if (dto.amountCents !== undefined) expense.amountCents = dto.amountCents;
    if (dto.receiptUrl !== undefined) expense.receiptUrl = dto.receiptUrl || null;
    if (dto.isBillable !== undefined) expense.isBillable = dto.isBillable;

    return this.expenseRepo.save(expense);
  }

  /* ───────────── Delete ───────────── */

  async delete(caller: ScopeUser, id: string): Promise<void> {
    const expense = await this.loadScoped(caller, id);

    if (expense.status !== 'draft') {
      throw new BusinessRuleError(
        'NOT_DRAFT',
        'Only draft expenses can be deleted.',
      );
    }

    await this.expenseRepo.remove(expense);
  }

  /* ───────────── Submit for Approval ───────────── */

  /** Callers submit only their own drafts; any other id → 404, nothing submitted. */
  async submitForApproval(companyId: string, userId: string, expenseIds: string[]) {
    const ids = [...new Set(expenseIds)];
    const expenses = await this.expenseRepo.find({
      where: { companyId, userId, id: In(ids) },
    });

    if (expenses.length !== ids.length) {
      throw new NotFoundError('Expense', 'one or more expenses');
    }

    for (const expense of expenses) {
      if (expense.status !== 'draft' && expense.status !== 'rejected') {
        throw new BusinessRuleError(
          'INVALID_STATUS',
          `Expense ${expense.id} is not a draft or rejected expense.`,
        );
      }
      expense.status = 'submitted';
      expense.rejectionReason = null;
      expense.rejectedBy = null;
      expense.rejectedAt = null;
    }

    return this.expenseRepo.save(expenses);
  }

  /* ───────────── Approve / Reject ───────────── */

  /**
   * Enforces the approval scope before anything changes: TEAM_LEADER → 403 unless every
   * id is a team member's expense (never their own); office roles → 404 on unknown ids.
   */
  private async loadForApproval(approver: ScopeUser, expenseIds: string[], m: EntityManager): Promise<Expense[]> {
    const ids = [...new Set(expenseIds)];
    // Row locks: a concurrent approve / reject of the same rows waits here, then sees the new status.
    const expenses = await m.find(Expense, {
      where: { companyId: approver.companyId, id: In(ids) },
      lock: { mode: 'pessimistic_write' },
    });

    await this.scope.assertCanApprove(approver, expenses.map((e) => e.userId), ids.length);

    if (expenses.length !== ids.length) {
      throw new NotFoundError('Expense', 'one or more expenses');
    }

    for (const expense of expenses) {
      if (expense.status !== 'submitted') {
        throw new BusinessRuleError(
          'INVALID_STATUS',
          `Expense ${expense.id} is not in 'submitted' status.`,
        );
      }
    }
    return expenses;
  }

  async approveExpenses(approver: ScopeUser, expenseIds: string[]) {
    return this.expenseRepo.manager.transaction(async (m) => {
      const expenses = await this.loadForApproval(approver, expenseIds, m);

      const now = new Date();
      for (const expense of expenses) {
        expense.status = 'approved';
        expense.approvedBy = approver.id;
        expense.approvedAt = now;
      }

      const saved = await m.save(expenses);
      await notifyOwners(this.notifications, m, approver, saved, 'expense_approved', (n) =>
        n === 1 ? 'Votre frais a été approuvé' : `${n} de vos frais ont été approuvés`);
      return saved;
    });
  }

  async rejectExpenses(approver: ScopeUser, expenseIds: string[], reason: string) {
    return this.expenseRepo.manager.transaction(async (m) => {
      const expenses = await this.loadForApproval(approver, expenseIds, m);

      const now = new Date();
      for (const expense of expenses) {
        expense.status = 'rejected';
        expense.rejectionReason = reason;
        expense.rejectedBy = approver.id;
        expense.rejectedAt = now;
      }

      const saved = await m.save(expenses);
      await notifyOwners(this.notifications, m, approver, saved, 'expense_rejected', (n) =>
        n === 1 ? 'Votre frais a été refusé' : `${n} de vos frais ont été refusés`, reason);
      return saved;
    });
  }

  /* ───────────── Project Summary ───────────── */

  async getProjectExpenseSummary(companyId: string, projectId: string) {
    await assertProjectExists(this.expenseRepo.manager, companyId, projectId);
    const results = await this.expenseRepo
      .createQueryBuilder('exp')
      .select('exp.category', 'category')
      .addSelect('SUM(exp.amount_cents)', 'totalCents')
      .addSelect('COUNT(exp.id)', 'count')
      .where('exp.company_id = :companyId', { companyId })
      .andWhere('exp.project_id = :projectId', { projectId })
      .groupBy('exp.category')
      .getRawMany();

    const grandTotal = results.reduce(
      (sum, row) => sum + parseInt(row.totalCents || '0', 10),
      0,
    );

    return {
      projectId,
      grandTotalCents: grandTotal,
      byCategory: results.map((row) => ({
        category: row.category,
        totalCents: parseInt(row.totalCents || '0', 10),
        count: parseInt(row.count || '0', 10),
      })),
    };
  }
}
