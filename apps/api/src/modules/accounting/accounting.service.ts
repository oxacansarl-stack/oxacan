import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ChartOfAccounts } from './entities/chart-of-accounts.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalEntryLine } from './entities/journal-entry-line.entity';
import { Invoice } from '../invoicing/entities/invoice.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import { CreateAccountDto, CreateJournalEntryDto, UpdateAccountDto } from './dto/accounting.dto';

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
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
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
     Fiduciary Export (CSV)
     ═══════════════════════════════════════════════ */

  async exportFiduciary(companyId: string, dateFrom: string, dateTo: string) {
    const BOM = '﻿';

    /* ── 1) Journal CSV ── */
    const entries = await this.entryRepo
      .createQueryBuilder('entry')
      .leftJoinAndSelect('entry.lines', 'line')
      .leftJoinAndSelect('line.account', 'account')
      .where('entry.company_id = :companyId', { companyId })
      .andWhere('entry.entry_date >= :dateFrom', { dateFrom })
      .andWhere('entry.entry_date <= :dateTo', { dateTo })
      .orderBy('entry.entryNumber', 'ASC')
      .getMany();

    let journalCsv = BOM + 'EntryNumber;Date;Description;AccountNumber;Debit;Credit\n';
    for (const entry of entries) {
      const dateStr = formatSwissDate(entry.entryDate);
      for (const line of entry.lines || []) {
        journalCsv += [
          entry.entryNumber,
          dateStr,
          escapeCsvField(entry.description),
          line.account?.accountNumber || '',
          formatAmount(line.debitCents),
          formatAmount(line.creditCents),
        ].join(';') + '\n';
      }
    }

    /* ── 2) Balance CSV ── */
    const trialBalance = await this.getTrialBalance(companyId, dateTo);

    let balanceCsv =
      BOM + 'AccountNumber;AccountName;Type;TotalDebit;TotalCredit;Balance\n';
    for (const acc of trialBalance.accounts) {
      balanceCsv += [
        acc.accountNumber,
        escapeCsvField(acc.accountName),
        acc.accountType,
        formatAmount(acc.totalDebitCents),
        formatAmount(acc.totalCreditCents),
        formatAmount(acc.balanceCents),
      ].join(';') + '\n';
    }

    /* ── 3) Client CSV ── */
    const invoices = await this.invoiceRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.client', 'client')
      .where('inv.company_id = :companyId', { companyId })
      .andWhere('inv.issue_date >= :dateFrom', { dateFrom })
      .andWhere('inv.issue_date <= :dateTo', { dateTo })
      .orderBy('inv.invoiceNumber', 'ASC')
      .getMany();

    let clientCsv =
      BOM + 'ClientName;InvoiceNumber;Date;AmountHT;VAT;AmountTTC;Status\n';
    for (const inv of invoices) {
      clientCsv += [
        escapeCsvField(inv.client?.name || ''),
        inv.invoiceNumber,
        formatSwissDate(inv.issueDate),
        formatAmount(inv.subtotalHtCents),
        formatAmount(inv.vatAmountCents),
        formatAmount(inv.totalTtcCents),
        inv.status,
      ].join(';') + '\n';
    }

    return { journalCsv, balanceCsv, clientCsv };
  }
}

/* ─── CSV helpers ─── */

function formatSwissDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

function formatAmount(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? '-' : '';
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

function escapeCsvField(value: string): string {
  if (value.includes(';') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
