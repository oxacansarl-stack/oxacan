import { MigrationInterface, QueryRunner } from 'typeorm';

// Alert state for the financial alerts of PRD §15.6 (see AlertsService): one row per alert kind
// and subject (the project for a budget drift, the invoice for an overdue acompte, the plus-value
// for a detected plus-value). Notifications are only sent by the INSERT that creates the row, or
// by the upsert that re-opens a resolved drift, so concurrent runs cannot notify twice.
export class FinancialAlerts1727500000026 implements MigrationInterface {
  name = 'FinancialAlerts1727500000026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE financial_alert (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
        project_id UUID NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('budget_drift', 'acompte_overdue', 'plus_value_detected')),
        -- The project, invoice or plus-value the alert is about.
        subject_id UUID NOT NULL,
        details JSONB NOT NULL DEFAULT '{}',
        notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        -- Set when a drift is back under the threshold; the next drift notifies again.
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT financial_alert_subject_key UNIQUE (company_id, kind, subject_id),
        CONSTRAINT financial_alert_project_id_tenant_fkey FOREIGN KEY (company_id, project_id)
          REFERENCES project (company_id, id) ON DELETE CASCADE,
        CONSTRAINT financial_alert_drift_subject_check CHECK (kind <> 'budget_drift' OR subject_id = project_id)
      );
      CREATE INDEX idx_financial_alert_project ON financial_alert (company_id, project_id);

      ALTER TABLE financial_alert ENABLE ROW LEVEL SECURITY;
      ALTER TABLE financial_alert FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON financial_alert FOR ALL
        USING (company_id = app_current_company_id() OR app_rls_bypass())
        WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE financial_alert;`);
  }
}
