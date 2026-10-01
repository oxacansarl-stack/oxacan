import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ChartOfAccounts } from './entities/chart-of-accounts.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import { CreateAccountDto, CreateJournalEntryDto, UpdateAccountDto } from './dto/accounting.dto';
import {
  FRAIS_COLUMNS,
  FiduciaryCategory,
  FiduciaryFile,
  HEURES_COLUMNS,
  RESUME_COLUMNS,
  buildCsv,
  dbCategoriesFor,
  escapeCsvField,
  fiduciaryFilename,
  formatAmount,
  formatHours,
  periodLabel,
  toFiduciaryCategory,
} from './fiduciary-csv';

/* ─── DTOs ─── */

interface AccountFilters {
  page?: number;
  limit?: number;
  type?: string;
  isActive?: boolean;
}

interface EntryFilters {
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  isPosted?: boolean;
  referenceType?: string;
}

interface LedgerFilters {
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class AccountingService {
  constructor(
    @InjectRepository(ChartOfAccounts)
    private readonly accountRepo: Repository<ChartOfAccounts>,
    @InjectRepository(JournalEntry)
    private readonly entryRepo: Repository<JournalEntry>,
    @InjectRepository(JournalEntryLine)
    private readonly entryLineRepo: Repository<JournalEntryLine>,
    private readonly dataSource: DataSource,
  ) {}

  /* ═══════════════════════════════════════════════
     Chart of Accounts — List
     ═══════════════════════════════════════════════ */

  async findAllAccounts(companyId: string, filters: AccountFilters = {}) {
    const { page = 1, limit = 25, type, isActive } = filters;

    const qb = this.accountRepo
      .createQueryBuilder('account')
      .where('account.company_id = :companyId', { companyId });

    if (type) {
      qb.andWhere('account.type = :type', { type });
    }
    if (isActive !== undefined) {
      qb.andWhere('account.is_active = :isActive', { isActive });
    }

    qb.orderBy('account.accountNumber', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /* ═══════════════════════════════════════════════
     Chart of Accounts — Find by ID
     ═══════════════════════════════════════════════ */

  async findAccountById(companyId: string, id: string): Promise<ChartOfAccounts> {
    const account = await this.accountRepo.findOne({
      where: { id, companyId },
      relations: ['parent'],
    });
    if (!account) throw new NotFoundError('ChartOfAccounts', id);
    return account;
  }

  /* ═══════════════════════════════════════════════
     Chart of Accounts — Create
     ═══════════════════════════════════════════════ */

  async createAccount(
    companyId: string,
    dto: CreateAccountDto,
  ): Promise<ChartOfAccounts> {
    /* Validate uniqueness */
    const existing = await this.accountRepo.findOne({
      where: { companyId, accountNumber: dto.accountNumber },
    });
    if (existing) {
      throw new BusinessRuleError(
        'DUPLICATE_ACCOUNT_NUMBER',
        `Account number ${dto.accountNumber} already exists.`,
      );
    }

    const account = this.accountRepo.create({
      companyId,
      accountNumber: dto.accountNumber,
      name: dto.name,
      type: dto.type,
      parentId: dto.parentId || null,
      isSystem: dto.isSystem ?? false,
      isActive: true,
    });

    return this.accountRepo.save(account);
  }

  /* ═══════════════════════════════════════════════
     Chart of Accounts — Update
     ═══════════════════════════════════════════════ */

  async updateAccount(
    companyId: string,
    id: string,
    dto: UpdateAccountDto,
  ): Promise<ChartOfAccounts> {
    const account = await this.findAccountById(companyId, id);

    if (account.isSystem) {
      throw new BusinessRuleError(
        'SYSTEM_ACCOUNT',
        'Cannot modify a system account.',
      );
    }

    if (dto.accountNumber !== undefined) {
      /* Check uniqueness if changing number */
      const existing = await this.accountRepo.findOne({
        where: { companyId, accountNumber: dto.accountNumber },
      });
      if (existing && existing.id !== id) {
        throw new BusinessRuleError(
          'DUPLICATE_ACCOUNT_NUMBER',
          `Account number ${dto.accountNumber} already exists.`,
        );
      }
      account.accountNumber = dto.accountNumber;
    }

    if (dto.name !== undefined) account.name = dto.name;
    if (dto.type !== undefined) account.type = dto.type;
    if (dto.parentId !== undefined) account.parentId = dto.parentId || null;
    if (dto.isActive !== undefined) account.isActive = dto.isActive;

    return this.accountRepo.save(account);
  }

  /* ═══════════════════════════════════════════════
     Chart of Accounts — Seed Swiss Standard
     ═══════════════════════════════════════════════ */

  async seedDefaultAccounts(companyId: string): Promise<ChartOfAccounts[]> {
    const defaults = [
      { accountNumber: '1000', name: 'Cash', type: 'asset' },
      { accountNumber: '1020', name: 'Bank', type: 'asset' },
      { accountNumber: '1100', name: 'Accounts Receivable', type: 'asset' },
      { accountNumber: '2000', name: 'Accounts Payable', type: 'liability' },
      { accountNumber: '2030', name: 'Customer Advances', type: 'liability' },
      { accountNumber: '2200', name: 'VAT Payable', type: 'liability' },
      { accountNumber: '3000', name: 'Revenue', type: 'revenue' },
      { accountNumber: '3200', name: 'Work in Progress', type: 'revenue' },
      { accountNumber: '4000', name: 'Materials', type: 'expense' },
      { accountNumber: '4100', name: 'Subcontractors', type: 'expense' },
      { accountNumber: '4200', name: 'Salaries', type: 'expense' },
    ];

    const created: ChartOfAccounts[] = [];

    for (const def of defaults) {
      const existing = await this.accountRepo.findOne({
        where: { companyId, accountNumber: def.accountNumber },
      });
      if (existing) continue;

      const account = this.accountRepo.create({
        companyId,
        accountNumber: def.accountNumber,
        name: def.name,
        type: def.type,
        isSystem: true,
        isActive: true,
      });
      created.push(await this.accountRepo.save(account));
    }

    return created;
  }

  /* ═══════════════════════════════════════════════
     Journal Entries — List
     ═══════════════════════════════════════════════ */

  async findAllEntries(companyId: string, filters: EntryFilters = {}) {
    const { page = 1, limit = 25, dateFrom, dateTo, isPosted, referenceType } =
      filters;

    const qb = this.entryRepo
      .createQueryBuilder('entry')
      .leftJoinAndSelect('entry.lines', 'line')
      .leftJoinAndSelect('line.account', 'account')
      .where('entry.company_id = :companyId', { companyId });

    if (dateFrom) {
      qb.andWhere('entry.entry_date >= :dateFrom', { dateFrom });
    }
    if (dateTo) {
      qb.andWhere('entry.entry_date <= :dateTo', { dateTo });
    }
    if (isPosted !== undefined) {
      qb.andWhere('entry.is_posted = :isPosted', { isPosted });
    }
    if (referenceType) {
      qb.andWhere('entry.reference_type = :referenceType', { referenceType });
    }

    qb.orderBy('entry.entryNumber', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /* ═══════════════════════════════════════════════
     Journal Entries — Find by ID
     ═══════════════════════════════════════════════ */

  async findEntryById(companyId: string, id: string): Promise<JournalEntry> {
    const entry = await this.entryRepo.findOne({
      where: { id, companyId },
      relations: ['lines', 'lines.account'],
    });
    if (!entry) throw new NotFoundError('JournalEntry', id);
    return entry;
  }

  /* ═══════════════════════════════════════════════
     Journal Entries — Create
     ═══════════════════════════════════════════════ */

  async createEntry(
    companyId: string,
    userId: string,
    dto: CreateJournalEntryDto,
  ): Promise<JournalEntry> {
    /* Validate balanced entry */
    const totalDebits = dto.lines.reduce((s, l) => s + l.debitCents, 0);
    const totalCredits = dto.lines.reduce((s, l) => s + l.creditCents, 0);

    if (totalDebits !== totalCredits) {
      throw new BusinessRuleError(
        'UNBALANCED_ENTRY',
        `Journal entry is unbalanced: debits (${totalDebits}) != credits (${totalCredits}).`,
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      /* Gapless entry number */
      const lockKey = Buffer.from(companyId.replace(/-/g, '').slice(0, 8), 'hex').readInt32BE(0);
      await queryRunner.query('SELECT pg_advisory_xact_lock($1)', [lockKey + 1]);

      const maxResult = await queryRunner.query(
        `SELECT MAX(entry_number) as max_num FROM journal_entry WHERE company_id = $1`,
        [companyId],
      );
      const nextNum = (parseInt(maxResult?.[0]?.max_num || '0', 10)) + 1;

      const entry = queryRunner.manager.create(JournalEntry, {
        companyId,
        entryNumber: nextNum,
        entryDate: dto.entryDate as any,
        description: dto.description,
        referenceType: dto.referenceType || null,
        referenceId: dto.referenceId || null,
        isPosted: false,
        createdById: userId,
      });
      const savedEntry = await queryRunner.manager.save(JournalEntry, entry);

      for (const lineDto of dto.lines) {
        const line = queryRunner.manager.create(JournalEntryLine, {
          journalEntryId: savedEntry.id,
          companyId,
          accountId: lineDto.accountId,
          debitCents: lineDto.debitCents,
          creditCents: lineDto.creditCents,
          description: lineDto.description || null,
        });
        await queryRunner.manager.save(JournalEntryLine, line);
      }

      await queryRunner.commitTransaction();
      return this.findEntryById(companyId, savedEntry.id);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /* ═══════════════════════════════════════════════
     Journal Entries — Post
     ═══════════════════════════════════════════════ */

  async postEntry(
    companyId: string,
    userId: string,
    entryId: string,
  ): Promise<JournalEntry> {
    const entry = await this.findEntryById(companyId, entryId);

    if (entry.isPosted) {
      throw new BusinessRuleError(
        'ALREADY_POSTED',
        'This journal entry is already posted.',
      );
    }

    entry.isPosted = true;
    entry.postedAt = new Date();
    entry.postedById = userId;

    await this.entryRepo.save(entry);
    return this.findEntryById(companyId, entryId);
  }

  /* ═══════════════════════════════════════════════
     Ledger
     ═══════════════════════════════════════════════ */

  async getLedger(companyId: string, accountId: string, filters: LedgerFilters = {}) {
    /* Verify account exists */
    await this.findAccountById(companyId, accountId);

    const qb = this.entryLineRepo
      .createQueryBuilder('line')
      .innerJoinAndSelect('line.journalEntry', 'entry')
      .where('line.company_id = :companyId', { companyId })
      .andWhere('line.account_id = :accountId', { accountId });

    if (filters.dateFrom) {
      qb.andWhere('entry.entry_date >= :dateFrom', { dateFrom: filters.dateFrom });
    }
    if (filters.dateTo) {
      qb.andWhere('entry.entry_date <= :dateTo', { dateTo: filters.dateTo });
    }

    qb.orderBy('entry.entryDate', 'ASC').addOrderBy('entry.entryNumber', 'ASC');

    const lines = await qb.getMany();

    /* Compute running balance */
    let runningBalance = 0;
    const ledger = lines.map((line) => {
      runningBalance += line.debitCents - line.creditCents;
      return {
        entryNumber: line.journalEntry.entryNumber,
        entryDate: line.journalEntry.entryDate,
        description: line.description || line.journalEntry.description,
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        balanceCents: runningBalance,
      };
    });

    return { accountId, entries: ledger };
  }

  /* ═══════════════════════════════════════════════
     Trial Balance
     ═══════════════════════════════════════════════ */

  async getTrialBalance(companyId: string, asOfDate?: string) {
    const qb = this.entryLineRepo
      .createQueryBuilder('line')
      .innerJoin('line.journalEntry', 'entry')
      .innerJoin('line.account', 'account')
      .select('account.id', 'accountId')
      .addSelect('account.account_number', 'accountNumber')
      .addSelect('account.name', 'accountName')
      .addSelect('account.type', 'accountType')
      .addSelect('COALESCE(SUM(line.debit_cents), 0)', 'totalDebitCents')
      .addSelect('COALESCE(SUM(line.credit_cents), 0)', 'totalCreditCents')
      .where('line.company_id = :companyId', { companyId })
      .andWhere('account.is_active = true');

    if (asOfDate) {
      qb.andWhere('entry.entry_date <= :asOfDate', { asOfDate });
    }

    qb.groupBy('account.id')
      .addGroupBy('account.account_number')
      .addGroupBy('account.name')
      .addGroupBy('account.type')
      .orderBy('account.accountNumber', 'ASC');

    const rows = await qb.getRawMany();

    const accounts = rows.map((r) => ({
      accountId: r.accountId,
      accountNumber: r.accountNumber,
      accountName: r.accountName,
      accountType: r.accountType,
      totalDebitCents: parseInt(r.totalDebitCents, 10),
      totalCreditCents: parseInt(r.totalCreditCents, 10),
      balanceCents:
        parseInt(r.totalDebitCents, 10) - parseInt(r.totalCreditCents, 10),
    }));

    const sumDebits = accounts.reduce((s, a) => s + a.totalDebitCents, 0);
    const sumCredits = accounts.reduce((s, a) => s + a.totalCreditCents, 0);

    return {
      asOfDate: asOfDate || new Date().toISOString().split('T')[0],
      accounts,
      totalDebitCents: sumDebits,
      totalCreditCents: sumCredits,
      isBalanced: sumDebits === sumCredits,
    };
  }

  /* ═══════════════════════════════════════════════
     Fiduciary Export (PRD §17) — 3 CSV files
     ═══════════════════════════════════════════════ */

  /**
   * Builds heures_employes, frais_debours and resume_projets for [dateFrom, dateTo].
   *
   * Only approved time entries and approved expenses are exported (validated data only).
   * Access (§17.6): ADMIN → every project and employee; PROJECT_MANAGER → only projects whose
   * manager is the caller (project.manager_id). Expenses without a project are therefore admin-only.
   * resume_projets is aggregated from exactly the rows of the two detail files, one row per
   * project and calendar month, so the three files always reconcile.
   */
  async exportFiduciary(
    companyId: string,
    caller: FiduciaryCaller,
    filters: FiduciaryFilters,
  ): Promise<FiduciaryExportResult> {
    const { dateFrom, dateTo, projectId, employeeId, category } = filters;
    const ownProjectsOnly = caller.role !== 'ADMIN';

    if (projectId) {
      const [project] = await this.dataSource.query(
        'SELECT manager_id FROM project WHERE id = $1 AND company_id = $2',
        [projectId, companyId],
      );
      if (!project) throw new NotFoundError('Project', projectId);
      if (ownProjectsOnly && project.manager_id !== caller.id) {
        throw new ForbiddenException('A project manager may only export their own projects.');
      }
    }

    /* ── Shared WHERE clause ── */
    const where = (alias: string) => {
      const params: unknown[] = [companyId, dateFrom, dateTo];
      const clauses = [
        `${alias}.company_id = $1`,
        `${alias}.status = 'approved'`,
        `${alias}.date >= $2`,
        `${alias}.date <= $3`,
      ];
      if (ownProjectsOnly) {
        params.push(caller.id);
        clauses.push(`p.manager_id = $${params.length}`);
      }
      if (projectId) {
        params.push(projectId);
        clauses.push(`${alias}.project_id = $${params.length}`);
      }
      if (employeeId) {
        params.push(employeeId);
        clauses.push(`${alias}.user_id = $${params.length}`);
      }
      return { sql: clauses.join(' AND '), params };
    };

    /* ── 1) Heures des employés (§17.3) ── */
    const te = where('te');
    const timeRows: TimeRow[] = await this.dataSource.query(
      `SELECT to_char(te.date, 'YYYY-MM-DD') AS date,
              u.id AS user_id, u.first_name, u.last_name,
              p.id AS project_id, p.reference AS project_ref, p.name AS project_name,
              te.normal_minutes, te.overtime_minutes, te.travel_minutes, te.total_minutes,
              COALESCE(te.hourly_rate_cents, u.hourly_rate_cents) AS rate_cents,
              te.cost_cents, te.notes
         FROM time_entry te
         JOIN app_user u ON u.id = te.user_id AND u.company_id = te.company_id
         JOIN project p ON p.id = te.project_id AND p.company_id = te.company_id
        WHERE ${te.sql}
        ORDER BY te.date, u.last_name, u.first_name, p.reference, te.start_time, te.id`,
      te.params,
    );

    /* ── 2) Frais et débours (§17.4) ── */
    const ex = where('e');
    if (category) {
      ex.params.push(dbCategoriesFor(category));
      ex.sql += ` AND e.category = ANY($${ex.params.length})`;
    }
    const expenseRows: ExpenseRow[] = await this.dataSource.query(
      `SELECT to_char(e.date, 'YYYY-MM-DD') AS date,
              u.id AS user_id, u.first_name, u.last_name,
              p.id AS project_id, p.reference AS project_ref, p.name AS project_name,
              e.category, e.description, e.amount_cents, e.receipt_url
         FROM expense e
         JOIN app_user u ON u.id = e.user_id AND u.company_id = e.company_id
         LEFT JOIN project p ON p.id = e.project_id AND p.company_id = e.company_id
        WHERE ${ex.sql}
        ORDER BY e.date, u.last_name, u.first_name, p.reference NULLS LAST, e.created_at, e.id`,
      ex.params,
    );

    const fullName = (r: { first_name: string; last_name: string }) =>
      `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();

    const heures = timeRows.map((r) => {
      const normal = Number(r.normal_minutes) || 0;
      const overtime = Number(r.overtime_minutes) || 0;
      const travel = Number(r.travel_minutes) || 0;
      const total = r.total_minutes != null ? Number(r.total_minutes) : normal + overtime + travel;
      const rate = r.rate_cents != null ? Number(r.rate_cents) : 0;
      const amount = r.cost_cents != null ? Number(r.cost_cents) : Math.round((total / 60) * rate);
      return { r, total, amount, cells: [
        r.date,
        escapeCsvField(fullName(r)),
        r.user_id,
        escapeCsvField(r.project_ref),
        escapeCsvField(r.project_name),
        formatHours(normal),
        formatHours(overtime),
        formatHours(travel),
        formatHours(total),
        formatAmount(rate),
        formatAmount(amount),
        escapeCsvField(r.notes),
      ] };
    });

    // Expenses carry one amount (the receipt total) and no VAT breakdown in the data model,
    // so HT = TTC and the VAT columns are 0.00 until a VAT rate is recorded per expense.
    const frais = expenseRows.map((r) => {
      const amount = Number(r.amount_cents) || 0;
      const vatRate = 0; // hundredths of a percent: 810 = 8.10 %
      const vat = Math.round((amount * vatRate) / 10000);
      const cat = toFiduciaryCategory(r.category);
      return { r, cat, ht: amount, cells: [
        r.date,
        escapeCsvField(fullName(r)),
        r.user_id,
        escapeCsvField(r.project_ref),
        escapeCsvField(r.project_name),
        cat,
        escapeCsvField(r.description),
        formatAmount(amount),
        formatAmount(vatRate),
        formatAmount(vat),
        formatAmount(amount + vat),
        escapeCsvField(r.receipt_url),
      ] };
    });

    /* ── 3) Résumé par projet (§17.5) ── */
    const summary = new Map<string, ProjectSummary>();
    const bucket = (r: { project_id: string; project_ref: string; project_name: string; date: string }) => {
      const periode = r.date.slice(0, 7);
      const key = `${periode}|${r.project_id}`;
      let s = summary.get(key);
      if (!s) {
        s = { ref: r.project_ref, name: r.project_name, periode, minutes: 0, labour: 0,
          materiel: 0, deplacement: 0, sousTraitance: 0, divers: 0 };
        summary.set(key, s);
      }
      return s;
    };
    for (const h of heures) {
      const s = bucket(h.r);
      s.minutes += h.total;
      s.labour += h.amount;
    }
    for (const f of frais) {
      if (!f.r.project_id) continue; // not attributable to a project
      const s = bucket(f.r as ExpenseRow & { project_id: string; project_ref: string; project_name: string });
      // §17.5 has no equipment column: equipment rental is reported with matériel.
      if (f.cat === 'materiel' || f.cat === 'equipement') s.materiel += f.ht;
      else if (f.cat === 'deplacement') s.deplacement += f.ht;
      else if (f.cat === 'sous-traitance') s.sousTraitance += f.ht;
      else s.divers += f.ht;
    }
    const resume = [...summary.values()]
      .sort((a, b) => a.periode.localeCompare(b.periode) || a.ref.localeCompare(b.ref))
      .map((s) => [
        escapeCsvField(s.ref),
        escapeCsvField(s.name),
        s.periode,
        formatHours(s.minutes),
        formatAmount(s.labour),
        formatAmount(s.materiel),
        formatAmount(s.deplacement),
        formatAmount(s.sousTraitance),
        formatAmount(s.divers),
        formatAmount(s.labour + s.materiel + s.deplacement + s.sousTraitance + s.divers),
      ]);

    const file = (key: FiduciaryFile, columns: readonly string[], rows: string[][]): FiduciaryCsvFile => ({
      filename: fiduciaryFilename(key, dateFrom, dateTo),
      content: buildCsv(columns, rows),
      rowCount: rows.length,
    });

    return {
      dateFrom,
      dateTo,
      periode: periodLabel(dateFrom, dateTo),
      scope: ownProjectsOnly ? 'own_projects' : 'all',
      files: {
        heures_employes: file('heures_employes', HEURES_COLUMNS, heures.map((h) => h.cells)),
        frais_debours: file('frais_debours', FRAIS_COLUMNS, frais.map((f) => f.cells)),
        resume_projets: file('resume_projets', RESUME_COLUMNS, resume),
      },
    };
  }
}

/* ─── Fiduciary export types ─── */

export interface FiduciaryCaller {
  id: string;
  role: string;
}

export interface FiduciaryFilters {
  dateFrom: string;
  dateTo: string;
  projectId?: string;
  employeeId?: string;
  category?: FiduciaryCategory;
}

export interface FiduciaryCsvFile {
  filename: string;
  /** UTF-8 BOM + ';'-separated, CRLF-terminated CSV text. */
  content: string;
  rowCount: number;
}

export interface FiduciaryExportResult {
  dateFrom: string;
  dateTo: string;
  periode: string;
  scope: 'all' | 'own_projects';
  files: Record<FiduciaryFile, FiduciaryCsvFile>;
}

interface TimeRow {
  date: string;
  user_id: string;
  first_name: string;
  last_name: string;
  project_id: string;
  project_ref: string;
  project_name: string;
  normal_minutes: number | null;
  overtime_minutes: number | null;
  travel_minutes: number | null;
  total_minutes: number | null;
  rate_cents: string | number | null;
  cost_cents: string | number | null;
  notes: string | null;
}

interface ExpenseRow {
  date: string;
  user_id: string;
  first_name: string;
  last_name: string;
  project_id: string | null;
  project_ref: string | null;
  project_name: string | null;
  category: string;
  description: string;
  amount_cents: string | number;
  receipt_url: string | null;
}

interface ProjectSummary {
  ref: string;
  name: string;
  periode: string;
  minutes: number;
  labour: number;
  materiel: number;
  deplacement: number;
  sousTraitance: number;
  divers: number;
}
