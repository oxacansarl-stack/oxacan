import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense } from './entities/expense.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';

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

interface CreateExpenseDto {
  projectId?: string;
  taskId?: string;
  date: string;
  category: string;
  description: string;
  amountCents: number;
  receiptUrl?: string;
  isBillable?: boolean;
}

interface UpdateExpenseDto {
  projectId?: string;
  taskId?: string;
  date?: string;
  category?: string;
  description?: string;
  amountCents?: number;
  receiptUrl?: string;
  isBillable?: boolean;
}

@Injectable()
export class ExpenseService {
  constructor(
    @InjectRepository(Expense)
    private readonly expenseRepo: Repository<Expense>,
  ) {}

  /* ───────────── List ───────────── */

  async findAll(companyId: string, filters: ExpenseFilters = {}) {
    const { page = 1, limit = 25, userId, projectId, status, category, dateFrom, dateTo } = filters;

    const qb = this.expenseRepo
      .createQueryBuilder('exp')
      .leftJoinAndSelect('exp.user', 'user')
      .leftJoinAndSelect('exp.project', 'project')
      .where('exp.company_id = :companyId', { companyId });

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

  async findById(companyId: string, id: string): Promise<Expense> {
    const expense = await this.expenseRepo.findOne({
      where: { id, companyId },
      relations: ['user', 'project', 'task', 'approver'],
    });
    if (!expense) throw new NotFoundError('Expense', id);
    return expense;
  }

  /* ───────────── Create ───────────── */

  async create(companyId: string, userId: string, dto: CreateExpenseDto): Promise<Expense> {
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

  async update(companyId: string, id: string, dto: UpdateExpenseDto): Promise<Expense> {
    const expense = await this.findById(companyId, id);

    if (expense.status !== 'draft') {
      throw new BusinessRuleError(
        'NOT_DRAFT',
        'Only draft expenses can be edited.',
      );
    }

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

  async delete(companyId: string, id: string): Promise<void> {
    const expense = await this.findById(companyId, id);

    if (expense.status !== 'draft') {
      throw new BusinessRuleError(
        'NOT_DRAFT',
        'Only draft expenses can be deleted.',
      );
    }

    await this.expenseRepo.remove(expense);
  }

  /* ───────────── Submit for Approval ───────────── */

  async submitForApproval(companyId: string, userId: string, expenseIds: string[]) {
    const expenses = await this.expenseRepo
      .createQueryBuilder('exp')
      .where('exp.company_id = :companyId', { companyId })
      .andWhere('exp.user_id = :userId', { userId })
      .andWhere('exp.id IN (:...expenseIds)', { expenseIds })
      .getMany();

    if (expenses.length !== expenseIds.length) {
      throw new NotFoundError('Expense', 'one or more expenses');
    }

    for (const expense of expenses) {
      if (expense.status !== 'draft') {
        throw new BusinessRuleError(
          'INVALID_STATUS',
          `Expense ${expense.id} is not in 'draft' status.`,
        );
      }
      expense.status = 'submitted';
    }

    return this.expenseRepo.save(expenses);
  }

  /* ───────────── Approve ───────────── */

  async approveExpenses(companyId: string, approverId: string, expenseIds: string[]) {
    const expenses = await this.expenseRepo
      .createQueryBuilder('exp')
      .where('exp.company_id = :companyId', { companyId })
      .andWhere('exp.id IN (:...expenseIds)', { expenseIds })
      .getMany();

    if (expenses.length !== expenseIds.length) {
      throw new NotFoundError('Expense', 'one or more expenses');
    }

    const now = new Date();
    for (const expense of expenses) {
      if (expense.status !== 'submitted') {
        throw new BusinessRuleError(
          'INVALID_STATUS',
          `Expense ${expense.id} is not in 'submitted' status.`,
        );
      }
      expense.status = 'approved';
      expense.approvedBy = approverId;
      expense.approvedAt = now;
    }

    return this.expenseRepo.save(expenses);
  }

  /* ───────────── Reject ───────────── */

  async rejectExpenses(companyId: string, approverId: string, expenseIds: string[], reason: string) {
    const expenses = await this.expenseRepo
      .createQueryBuilder('exp')
      .where('exp.company_id = :companyId', { companyId })
      .andWhere('exp.id IN (:...expenseIds)', { expenseIds })
      .getMany();

    if (expenses.length !== expenseIds.length) {
      throw new NotFoundError('Expense', 'one or more expenses');
    }

    for (const expense of expenses) {
      if (expense.status !== 'submitted') {
        throw new BusinessRuleError(
          'INVALID_STATUS',
          `Expense ${expense.id} is not in 'submitted' status.`,
        );
      }
      expense.status = 'rejected';
    }

    return this.expenseRepo.save(expenses);
  }

  /* ───────────── Project Summary ───────────── */

  async getProjectExpenseSummary(companyId: string, projectId: string) {
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
