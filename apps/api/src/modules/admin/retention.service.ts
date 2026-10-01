import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SET_LOCAL_CONTEXT_SQL, contextSecret, signedContext } from '../../common/tenant/context-signature';
import {
  PROTECTED_TABLES,
  RETENTION_RULES,
  RetentionRule,
  applySql,
  previewSql,
} from './retention.policy';

export interface RuleOutcome {
  key: string;
  table: string;
  action: RetentionRule['action'];
  description: string;
  retention: string;
  legalBasis: string;
  /** Rows affected (dry run: that would be affected). */
  affected: number;
}

export interface RetentionReport {
  dryRun: boolean;
  /** null: every company. */
  companyId: string | null;
  generatedAt: string;
  rules: RuleOutcome[];
  totalAffected: number;
  /** Per company: rule key → rows. */
  byCompany: Record<string, Record<string, number>>;
  /** Never deleted or rewritten by retention (CO art. 957–958f, PRD §25.4). */
  protectedTables: readonly string[];
}

export interface RunOptions {
  dryRun?: boolean;
  /** Limit the run to one company. */
  companyId?: string;
}

/**
 * Applies the retention policy (retention.policy.ts).
 *
 * - previewForCompany(): the dry run behind GET /admin/retention/dry-run. Read-only (COUNT
 *   queries) in the caller's tenant context, so RLS applies on top of the company filter.
 * - run(): the scheduled job (config/run-retention.ts). One transaction under the signed system
 *   context (bypass on, set with SET LOCAL so it ends with the transaction); every rule in order,
 *   then one RETENTION audit entry per affected company. All or nothing.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** What a run would change for one company, without changing anything. */
  async previewForCompany(companyId: string): Promise<RetentionReport> {
    const counts = await this.count(this.dataSource.manager, companyId);
    return report(true, companyId, counts);
  }

  /** Runs (or with dryRun, counts) the policy across every company or one, as the system. */
  async run(options: RunOptions = {}): Promise<RetentionReport> {
    const { dryRun = false, companyId } = options;
    const secret = contextSecret();
    return this.dataSource.transaction(async (m) => {
      await m.query(SET_LOCAL_CONTEXT_SQL, signedContext(secret, '', '', 'on'));
      // A context the database does not accept makes every tenant table look empty: the run
      // would "succeed" with nothing to do forever. Fail instead.
      const [{ ok }] = await m.query(`SELECT app_rls_bypass() AS ok`);
      if (!ok) {
        throw new Error('The database rejected the signed system context: RLS_CONTEXT_SECRET does not match app_private.context_key');
      }
      // Wait briefly for row locks rather than stall a busy API; a failed run is retried next time.
      await m.query(`SET LOCAL lock_timeout = '10s'`);
      await m.query(`SET LOCAL statement_timeout = '10min'`);

      const counts = dryRun ? await this.count(m, companyId) : await this.apply(m, companyId);
      const result = report(dryRun, companyId ?? null, counts);
      if (!dryRun) await this.auditRun(m, result);
      return result;
    });
  }

  private async count(m: EntityManager, companyId?: string): Promise<Map<string, Map<string, number>>> {
    const counts = new Map<string, Map<string, number>>();
    for (const rule of RETENTION_RULES) {
      const rows: { company_id: string; n: number }[] = await m.query(
        previewSql(rule, !!companyId),
        companyId ? [companyId] : [],
      );
      counts.set(rule.key, toMap(rows));
    }
    return counts;
  }

  private async apply(m: EntityManager, companyId?: string): Promise<Map<string, Map<string, number>>> {
    const counts = new Map<string, Map<string, number>>();
    for (const rule of RETENTION_RULES) {
      const rows: { company_id: string; n: number }[] = await m.query(
        applySql(rule, !!companyId),
        companyId ? [companyId] : [],
      );
      const perCompany = toMap(rows);
      counts.set(rule.key, perCompany);
      const total = [...perCompany.values()].reduce((a, b) => a + b, 0);
      if (total > 0) this.logger.log(`${rule.key}: ${total} row(s) ${rule.action === 'delete' ? 'deleted' : 'anonymised'}`);
    }
    return counts;
  }

  /** The audit trail records what retention did, per company (counts only, no personal data). */
  private async auditRun(m: EntityManager, result: RetentionReport): Promise<void> {
    for (const [companyId, rules] of Object.entries(result.byCompany)) {
      await m.query(
        `INSERT INTO audit_log (company_id, user_id, action, entity_type, entity_id, new_values)
         VALUES ($1, NULL, 'RETENTION', 'retention', NULL, $2::jsonb)`,
        [companyId, JSON.stringify({ rules, generatedAt: result.generatedAt })],
      );
    }
  }
}

function toMap(rows: { company_id: string; n: number }[]): Map<string, number> {
  return new Map(rows.map((r) => [r.company_id, Number(r.n)]));
}

function report(
  dryRun: boolean,
  companyId: string | null,
  counts: Map<string, Map<string, number>>,
): RetentionReport {
  const byCompany: Record<string, Record<string, number>> = {};
  const rules = RETENTION_RULES.map((rule) => {
    const perCompany = counts.get(rule.key) ?? new Map<string, number>();
    let affected = 0;
    for (const [company, n] of perCompany) {
      if (n <= 0) continue;
      affected += n;
      (byCompany[company] ??= {})[rule.key] = n;
    }
    return {
      key: rule.key,
      table: rule.table,
      action: rule.action,
      description: rule.description,
      retention: rule.retention,
      legalBasis: rule.legalBasis,
      affected,
    };
  });
  return {
    dryRun,
    companyId,
    generatedAt: new Date().toISOString(),
    rules,
    totalAffected: rules.reduce((a, r) => a + r.affected, 0),
    byCompany,
    protectedTables: PROTECTED_TABLES,
  };
}
