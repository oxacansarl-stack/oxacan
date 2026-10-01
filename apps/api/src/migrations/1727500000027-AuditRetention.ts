import { MigrationInterface, QueryRunner } from 'typeorm';

// Data retention (PRD §25): app_user / client_contact rows are anonymised in place, never deleted
// (their ids stay referenced by time entries, invoices, journal entries…); anonymised_at marks
// them so the retention job is idempotent. Indexes for GET /admin/audit-log (newest first, by user)
// and for the job's notification purge.
export class AuditRetention1727500000027 implements MigrationInterface {
  name = 'AuditRetention1727500000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE app_user ADD COLUMN anonymised_at TIMESTAMPTZ;
      ALTER TABLE client_contact ADD COLUMN anonymised_at TIMESTAMPTZ;

      CREATE INDEX idx_audit_log_company_created ON audit_log (company_id, created_at DESC, id DESC);
      CREATE INDEX idx_audit_log_company_user ON audit_log (company_id, user_id, created_at DESC);
      CREATE INDEX idx_notification_created ON notification (created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_notification_created;
      DROP INDEX IF EXISTS idx_audit_log_company_user;
      DROP INDEX IF EXISTS idx_audit_log_company_created;
      ALTER TABLE client_contact DROP COLUMN anonymised_at;
      ALTER TABLE app_user DROP COLUMN anonymised_at;
    `);
  }
}
