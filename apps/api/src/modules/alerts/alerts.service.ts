import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { runAsSystem, tenantStorage } from '../../common/tenant/tenant-context';
import { OFFICE_ROLES } from '../../common/decorators/roles.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { acompteDueMessage, acompteOverdueMessage, budgetDriftMessage, plusValueDetectedMessage } from './alert-messages';
import { findDueAcomptes } from '../contracts/acompte-schedule';
import { projectActualCostSql } from '../projects/project-cost';

/** Build Strategy Phase 6: the drift alert fires when actual costs exceed the budget by more than 10 %. */
export const DRIFT_THRESHOLD_PERCENT = 10;

/** Session advisory lock held by the instance running the all-companies job (see runAllCompanies). */
const JOB_LOCK = 'oxacan:financial_alerts';
/** Transaction advisory lock serialising the checks of one company (job, manual trigger, recalculation). */
const companyLock = (companyId: string) => `oxacan:financial_alerts:${companyId}`;

type AlertKind = 'budget_drift' | 'acompte_overdue' | 'plus_value_detected' | 'acompte_due';

export interface CompanyAlertResult {
  companyId: string;
  /** Notified alerts (new, or a drift re-opened after it was resolved). */
  budgetDrift: number;
  acompteOverdue: number;
  /** Planned acomptes due and not issued yet (PRD §15.6 "à émettre"). */
  acompteDue: number;
  plusValueDetected: number;
  /** Drift alerts closed because the project is back under the threshold. */
  driftResolved: number;
}

export interface JobResult {
  skipped: boolean;
  companies: number;
  failed: number;
  results: CompanyAlertResult[];
}

interface OfficeUser {
  id: string;
  role: string;
}

/**
 * Financial alerts of PRD §15.6: budget drift, overdue acomptes and detected plus-values.
 * Alert state lives in financial_alert (one row per kind and subject); a notification is only sent
 * by the statement that creates (or re-opens) the row, inside the same transaction, so the same alert
 * is never sent twice even when several runs overlap. Recipients are the project's manager (when an
 * office user) and the company's admins: the texts carry amounts, which field roles may not see.
 *
 * Every check runs in one company's RLS context (tenantStorage → signed context on checkout) and
 * also filters by company_id; only the list of companies is read with the system bypass.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  /* ───────────── All companies (daily job) ───────────── */

  /**
   * Runs every company's checks. With several API instances only the one that obtains the session
   * advisory lock runs; the others return { skipped: true }. The lock lives on a dedicated
   * connection held for the run and is released with it (or by Postgres if the process dies).
   */
  async runAllCompanies(): Promise<JobResult> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [JOB_LOCK]);
      if (!locked) return { skipped: true, companies: 0, failed: 0, results: [] };
      try {
        const companies: { id: string }[] = await runAsSystem(() =>
          this.dataSource.query('SELECT id FROM company ORDER BY id'),
        );
        const results: CompanyAlertResult[] = [];
        let failed = 0;
        for (const { id } of companies) {
          try {
            results.push(await this.runForCompany(id));
          } catch (err) {
            failed++;
            this.logger.error(`Financial alerts failed for company ${id}: ${(err as Error).message}`);
          }
        }
        return { skipped: false, companies: companies.length, failed, results };
      } finally {
        await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [JOB_LOCK]);
      }
    } finally {
      await runner.release();
    }
  }

  /* ───────────── One company ───────────── */

  /** Runs all checks for one company, in its own tenant context and one transaction. */
  runForCompany(companyId: string): Promise<CompanyAlertResult> {
    return this.inCompany(companyId, async (m) => {
      const office = await this.officeUsers(m, companyId);
      const drift = await this.checkBudgetDrift(m, companyId, office);
      return {
        companyId,
        budgetDrift: drift.notified,
        driftResolved: drift.resolved,
        acompteOverdue: await this.checkOverdueAcomptes(m, companyId, office),
        acompteDue: await this.checkDueAcomptes(m, companyId, office),
        plusValueDetected: await this.checkPlusValues(m, companyId, office),
      };
    });
  }

  /** Drift check of a single project, e.g. right after its actual cost was recalculated. */
  checkProjectDrift(companyId: string, projectId: string): Promise<{ notified: number; resolved: number }> {
    return this.inCompany(companyId, async (m) =>
      this.checkBudgetDrift(m, companyId, await this.officeUsers(m, companyId), projectId),
    );
  }

  private inCompany<T>(companyId: string, fn: (m: EntityManager) => Promise<T>): Promise<T> {
    // A fresh store: the connection is checked out inside it, so it gets this company's signed context.
    return tenantStorage.run({ companyId }, () =>
      this.dataSource.transaction(async (m) => {
        await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [companyLock(companyId)]);
        return fn(m);
      }),
    );
  }

  /* ───────────── Checks ───────────── */

  /**
   * Actual cost is computed live with the formula of ProjectsService.updateProgress (projectActualCostSql),
   * so a drift is caught even before anyone recalculates.
   * A project back under the threshold has its alert resolved; crossing it again notifies again.
   */
  private async checkBudgetDrift(
    m: EntityManager,
    companyId: string,
    office: OfficeUser[],
    projectId?: string,
  ): Promise<{ notified: number; resolved: number }> {
    const rows: {
      id: string; reference: string; name: string; manager_id: string | null;
      budget: number; actual: number; drifting: boolean;
    }[] = await m.query(
      `SELECT c.id, c.reference, c.name, c.manager_id, c.budget, c.actual,
              COALESCE(c.budget > 0 AND c.status NOT IN ('completed', 'cancelled')
                       AND c.actual::numeric * 100 > c.budget::numeric * (100 + $3::numeric), false) AS drifting
         FROM (SELECT p.id, p.reference, p.name, p.manager_id, p.status, p.budget_ht_cents AS budget,
                      ${projectActualCostSql('p.id', 'p.company_id')} AS actual
                 FROM project p
                WHERE p.company_id = $1 AND ($2::uuid IS NULL OR p.id = $2::uuid)) c`,
      [companyId, projectId ?? null, DRIFT_THRESHOLD_PERCENT],
    );

    let notified = 0;
    for (const p of rows.filter((r) => r.drifting)) {
      const details = { budgetCents: Number(p.budget), actualCents: Number(p.actual) };
      if (!(await this.claim(m, companyId, 'budget_drift', p.id, p.id, details))) continue;
      const msg = budgetDriftMessage({
        reference: p.reference, name: p.name, ...details, thresholdPercent: DRIFT_THRESHOLD_PERCENT,
      });
      await this.notify(m, companyId, recipients(office, p.manager_id), {
        type: 'budget_drift', ...msg, referenceType: 'project', referenceId: p.id,
      });
      notified++;
    }

    const healthy = rows.filter((r) => !r.drifting).map((r) => r.id);
    let resolved = 0;
    if (healthy.length > 0) {
      const [, count] = await m.query(
        `UPDATE financial_alert SET resolved_at = now()
          WHERE company_id = $1 AND kind = 'budget_drift' AND resolved_at IS NULL AND subject_id = ANY($2::uuid[])`,
        [companyId, healthy],
      );
      resolved = Number(count) || 0;
    }
    return { notified, resolved };
  }

  /**
   * An issued acompte (not credited) that is not fully paid and is past its due date: the invoice's
   * due_date, or else its issue date plus the company's default payment term; or marked 'overdue'.
   * Notified once per invoice.
   */
  private async checkOverdueAcomptes(m: EntityManager, companyId: string, office: OfficeUser[]): Promise<number> {
    const rows: {
      id: string; invoice_number: string; project_id: string; total: number; paid: number; due: string;
      reference: string; name: string; manager_id: string | null;
    }[] = await m.query(
      `SELECT i.id, i.invoice_number, i.project_id, i.total_ttc_cents AS total,
              COALESCE(i.amount_paid_cents, 0) AS paid,
              to_char(COALESCE(i.due_date, i.issue_date + c.default_payment_terms_days), 'DD.MM.YYYY') AS due,
              p.reference, p.name, p.manager_id
         FROM invoice i
         JOIN company c ON c.id = i.company_id
         JOIN project p ON p.id = i.project_id AND p.company_id = i.company_id
        WHERE i.company_id = $1 AND i.type = 'acompte'
          AND i.status IN ('sent', 'partially_paid', 'overdue')
          AND COALESCE(i.amount_paid_cents, 0) < i.total_ttc_cents
          AND (i.status = 'overdue' OR COALESCE(i.due_date, i.issue_date + c.default_payment_terms_days) < CURRENT_DATE)
          AND NOT EXISTS (SELECT 1 FROM invoice cn
                           WHERE cn.company_id = i.company_id AND cn.reference_invoice_id = i.id
                             AND cn.type = 'credit_note' AND cn.status <> 'cancelled')
          AND NOT EXISTS (SELECT 1 FROM financial_alert fa
                           WHERE fa.company_id = i.company_id AND fa.kind = 'acompte_overdue' AND fa.subject_id = i.id)
        ORDER BY i.invoice_number`,
      [companyId],
    );

    let notified = 0;
    for (const i of rows) {
      const details = { totalCents: Number(i.total), paidCents: Number(i.paid), dueDate: i.due };
      if (!(await this.claim(m, companyId, 'acompte_overdue', i.project_id, i.id, details))) continue;
      const msg = acompteOverdueMessage({ invoiceNumber: i.invoice_number, reference: i.reference, name: i.name, ...details });
      await this.notify(m, companyId, recipients(office, i.manager_id), {
        type: 'acompte_overdue', ...msg, referenceType: 'invoice', referenceId: i.id,
      });
      notified++;
    }
    return notified;
  }

  /**
   * Planned acomptes (contract acompte schedule) due today or earlier with no sent acompte yet.
   * One reminder per schedule item.
   */
  private async checkDueAcomptes(m: EntityManager, companyId: string, office: OfficeUser[]): Promise<number> {
    const due = await findDueAcomptes(m, companyId);
    if (!due.length) return 0;
    const projects: { id: string; reference: string; manager_id: string | null }[] = await m.query(
      'SELECT id, reference, manager_id FROM project WHERE company_id = $1 AND id = ANY($2::uuid[])',
      [companyId, [...new Set(due.map((d) => d.projectId))]],
    );
    const byId = new Map(projects.map((p) => [p.id, p]));

    let notified = 0;
    for (const d of due) {
      const project = byId.get(d.projectId);
      if (!project) continue;
      const dueDate = d.dueDate.split('-').reverse().join('.');
      const details = { amountHtCents: Number(d.amountHtCents), dueDate, contractReference: d.contractReference };
      if (!(await this.claim(m, companyId, 'acompte_due', d.projectId, d.id, details))) continue;
      const msg = acompteDueMessage({ label: d.label, reference: project.reference, name: d.projectName, ...details });
      await this.notify(m, companyId, recipients(office, project.manager_id), {
        type: 'acompte_due', ...msg, referenceType: 'contract', referenceId: d.contractId,
      });
      notified++;
    }
    return notified;
  }

  /** Plus-values still in status 'detected' that were never announced. Notified once per plus-value. */
  private async checkPlusValues(m: EntityManager, companyId: string, office: OfficeUser[]): Promise<number> {
    const rows: {
      id: string; project_id: string; description: string; amount: number;
      reference: string; name: string; manager_id: string | null;
    }[] = await m.query(
      `SELECT pv.id, pv.project_id, pv.description, pv.amount_cents AS amount, p.reference, p.name, p.manager_id
         FROM plus_value pv
         JOIN project p ON p.id = pv.project_id AND p.company_id = pv.company_id
        WHERE pv.company_id = $1 AND pv.status = 'detected'
          AND NOT EXISTS (SELECT 1 FROM financial_alert fa
                           WHERE fa.company_id = pv.company_id AND fa.kind = 'plus_value_detected' AND fa.subject_id = pv.id)
        ORDER BY pv.created_at`,
      [companyId],
    );

    let notified = 0;
    for (const pv of rows) {
      const details = { amountCents: Number(pv.amount) };
      if (!(await this.claim(m, companyId, 'plus_value_detected', pv.project_id, pv.id, details))) continue;
      const msg = plusValueDetectedMessage({
        reference: pv.reference, name: pv.name, description: pv.description, amountCents: details.amountCents,
      });
      await this.notify(m, companyId, recipients(office, pv.manager_id), {
        type: 'plus_value_detected', ...msg, referenceType: 'plus_value', referenceId: pv.id,
      });
      notified++;
    }
    return notified;
  }

  /* ───────────── Helpers ───────────── */

  /**
   * Records the alert; true when this call created it (or re-opened a resolved one) and must notify.
   * The unique key makes a concurrent duplicate a no-op instead of a second notification.
   */
  private async claim(
    m: EntityManager,
    companyId: string,
    kind: AlertKind,
    projectId: string,
    subjectId: string,
    details: Record<string, unknown>,
  ): Promise<boolean> {
    const rows = await m.query(
      `INSERT INTO financial_alert (company_id, project_id, kind, subject_id, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (company_id, kind, subject_id) DO UPDATE
          SET resolved_at = NULL, notified_at = now(), details = EXCLUDED.details
        WHERE financial_alert.resolved_at IS NOT NULL
       RETURNING id`,
      [companyId, projectId, kind, subjectId, JSON.stringify(details)],
    );
    return rows.length > 0;
  }

  private officeUsers(m: EntityManager, companyId: string): Promise<OfficeUser[]> {
    return m.query(
      `SELECT id, role FROM app_user
        WHERE company_id = $1 AND is_active AND deactivated_at IS NULL AND role = ANY($2::text[])`,
      [companyId, OFFICE_ROLES],
    );
  }

  private async notify(
    m: EntityManager,
    companyId: string,
    userIds: string[],
    n: { type: string; title: string; body: string; referenceType: string; referenceId: string },
  ): Promise<void> {
    for (const userId of userIds) {
      await this.notifications.createNotification(companyId, { userId, ...n }, m);
    }
  }
}

/** The company's admins plus the project's manager when the manager is an active office user. */
function recipients(office: OfficeUser[], managerId: string | null): string[] {
  return office.filter((u) => u.role === 'ADMIN' || u.id === managerId).map((u) => u.id);
}
