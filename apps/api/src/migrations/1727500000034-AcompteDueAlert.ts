import { MigrationInterface, QueryRunner } from 'typeorm';

// PRD §15.6 "Acompte: rappel pour les acomptes à émettre": a planned acompte (acompte_schedule_item)
// that is due and not issued yet gets one reminder, recorded in financial_alert like the others.
export class AcompteDueAlert1727500000034 implements MigrationInterface {
  name = 'AcompteDueAlert1727500000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE financial_alert DROP CONSTRAINT financial_alert_kind_check;
      ALTER TABLE financial_alert ADD CONSTRAINT financial_alert_kind_check
        CHECK (kind IN ('budget_drift', 'acompte_overdue', 'plus_value_detected', 'acompte_due'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM financial_alert WHERE kind = 'acompte_due';
      ALTER TABLE financial_alert DROP CONSTRAINT financial_alert_kind_check;
      ALTER TABLE financial_alert ADD CONSTRAINT financial_alert_kind_check
        CHECK (kind IN ('budget_drift', 'acompte_overdue', 'plus_value_detected'));
    `);
  }
}
