import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AlertsService } from './alerts.service';

/**
 * Daily financial alerts over all companies, at 06:00 Swiss time (before the office day starts).
 * Every API instance schedules it; the advisory lock in AlertsService.runAllCompanies lets only one
 * of them run it, and the alert table keeps a late second run from notifying again.
 */
@Injectable()
export class AlertsScheduler {
  private readonly logger = new Logger(AlertsScheduler.name);

  constructor(private readonly alerts: AlertsService) {}

  @Cron('0 6 * * *', { name: 'financial-alerts', timeZone: 'Europe/Zurich', waitForCompletion: true })
  async runDaily(): Promise<void> {
    try {
      const r = await this.alerts.runAllCompanies();
      if (r.skipped) {
        this.logger.log('Financial alerts: another instance holds the lock, skipped');
        return;
      }
      const sum = (k: 'budgetDrift' | 'acompteOverdue' | 'plusValueDetected') =>
        r.results.reduce((n, c) => n + c[k], 0);
      this.logger.log(
        `Financial alerts: ${r.companies} companies (${r.failed} failed), ` +
          `${sum('budgetDrift')} drift, ${sum('acompteOverdue')} acompte, ${sum('plusValueDetected')} plus-value alerts`,
      );
    } catch (err) {
      this.logger.error(`Financial alerts job failed: ${(err as Error).message}`);
    }
  }
}
