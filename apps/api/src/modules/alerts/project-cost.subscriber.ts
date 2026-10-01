import { Injectable, Logger } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  UpdateEvent,
} from 'typeorm';
import { Project } from '../projects/entities/project.entity';
import { AlertsService } from './alerts.service';

const PENDING = 'financialAlertsDriftProjects';
const WATCHED = new Set(['actualCostCents', 'budgetHtCents']);

/**
 * Runs the drift check of a project as soon as a save changes its actual cost or budget (e.g.
 * POST /projects/:id/recalculate), without touching the projects module. Projects are collected
 * on the transaction's query runner and checked after it commits, so the check sees the new values
 * and a failure can never roll back the save. Raw-SQL updates are left to the daily job.
 */
@Injectable()
export class ProjectCostSubscriber implements EntitySubscriberInterface<Project> {
  private readonly logger = new Logger(ProjectCostSubscriber.name);

  constructor(
    dataSource: DataSource,
    private readonly alerts: AlertsService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return Project;
  }

  afterUpdate(event: UpdateEvent<Project>): void {
    const project = event.entity as Partial<Project> | undefined;
    if (!project?.id || !project.companyId) return;
    if (!event.updatedColumns.some((c) => WATCHED.has(c.propertyName))) return;
    const data = event.queryRunner.data as Record<string, Map<string, string> | undefined>;
    (data[PENDING] ??= new Map()).set(project.id, project.companyId);
  }

  afterTransactionCommit(event: TransactionCommitEvent): void {
    const pending = this.take(event);
    if (!pending) return;
    for (const [projectId, companyId] of pending) {
      setImmediate(() => {
        this.alerts.checkProjectDrift(companyId, projectId).catch((err: Error) =>
          this.logger.error(`Drift check failed for project ${projectId}: ${err.message}`),
        );
      });
    }
  }

  afterTransactionRollback(event: TransactionRollbackEvent): void {
    this.take(event);
  }

  private take(event: TransactionCommitEvent | TransactionRollbackEvent): Map<string, string> | undefined {
    const data = event.queryRunner.data as Record<string, Map<string, string> | undefined>;
    const pending = data[PENDING];
    delete data[PENDING];
    return pending;
  }
}
