import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { sanitiseForAudit } from './audit-redaction';

export interface AuditLogFilters {
  page: number;
  limit: number;
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  /** Inclusive lower bound: an ISO timestamp, or a YYYY-MM-DD day (from its start, Swiss time). */
  from?: string;
  /** Upper bound: an ISO timestamp (inclusive), or a YYYY-MM-DD day (up to its end, Swiss time). */
  to?: string;
}

export interface AuditLogRow {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
  user: { firstName: string; lastName: string; email: string } | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  /**
   * Appends an entry. Values are redacted and capped here, so every writer gets the same rules.
   * Pass the business transaction's manager to make the entry commit (or roll back) with it.
   */
  async log(entry: Partial<AuditLog>, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.auditRepo;
    const row = repo.create({
      ...entry,
      oldValues: entry.oldValues ? sanitiseForAudit(entry.oldValues) : null,
      newValues: entry.newValues ? sanitiseForAudit(entry.newValues) : null,
    });
    await repo.save(row);
  }

  /** Newest first, one company, with the acting user's name (anonymised users stay anonymised). */
  async list(companyId: string, f: AuditLogFilters) {
    const where: string[] = ['a.company_id = $1'];
    const params: unknown[] = [companyId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    if (f.entityType) add('a.entity_type = ?', f.entityType);
    if (f.entityId) add('a.entity_id = ?', f.entityId);
    if (f.userId) add('a.user_id = ?', f.userId);
    if (f.action) add('a.action = ?', f.action);
    if (f.from) {
      add(DAY_RE.test(f.from) ? `a.created_at >= (?::date::timestamp AT TIME ZONE 'Europe/Zurich')` : 'a.created_at >= ?::timestamptz', f.from);
    }
    if (f.to) {
      add(DAY_RE.test(f.to) ? `a.created_at < ((?::date + 1)::timestamp AT TIME ZONE 'Europe/Zurich')` : 'a.created_at <= ?::timestamptz', f.to);
    }

    const whereSql = where.join(' AND ');
    const manager = this.auditRepo.manager;
    const [{ total }] = await manager.query(
      `SELECT count(*)::int AS total FROM audit_log a WHERE ${whereSql}`,
      params,
    );
    const rows: any[] = await manager.query(
      `SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.user_id,
              a.old_values, a.new_values, a.ip_address, a.user_agent,
              u.first_name, u.last_name, u.email
         FROM audit_log a
         LEFT JOIN app_user u ON u.company_id = a.company_id AND u.id = a.user_id
        WHERE ${whereSql}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.limit, (f.page - 1) * f.limit],
    );

    const data: AuditLogRow[] = rows.map((r) => ({
      id: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      userId: r.user_id,
      user: r.user_id && r.email ? { firstName: r.first_name, lastName: r.last_name, email: r.email } : null,
      oldValues: r.old_values,
      newValues: r.new_values,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
    }));

    return {
      data,
      meta: { page: f.page, limit: f.limit, total, totalPages: Math.ceil(total / f.limit) },
    };
  }
}
