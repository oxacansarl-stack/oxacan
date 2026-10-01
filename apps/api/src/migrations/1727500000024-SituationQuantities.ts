import { MigrationInterface, QueryRunner } from 'typeorm';

// Situations de travaux (PRD §15.2) are billed per offer position on the quantities actually
// executed, and numbered Situation 1, 2, … per project.
// - invoice_line.offer_line_id ties a situation line to the contracted position it bills, so the
//   server can compute what earlier situations already billed for it (instead of trusting the
//   client's previous quantity). RESTRICT: a billed position can't disappear from under its invoices.
// - invoice.situation_number is the per-project number, next to the gapless company-wide
//   invoice_number. A cancelled draft gives its number back (it never reached the client).
export class SituationQuantities1727500000024 implements MigrationInterface {
  name = 'SituationQuantities1727500000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE invoice_line ADD COLUMN offer_line_id UUID;
      ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_offer_line_same_company
        FOREIGN KEY (company_id, offer_line_id) REFERENCES offer_line (company_id, id) ON DELETE RESTRICT;
      CREATE INDEX idx_invoice_line_offer_line ON invoice_line (company_id, offer_line_id)
        WHERE offer_line_id IS NOT NULL;

      ALTER TABLE invoice ADD COLUMN situation_number INTEGER
        CONSTRAINT invoice_situation_number_check
        CHECK (situation_number IS NULL OR (type = 'situation' AND situation_number > 0));

      -- Number the existing situations of each project in creation order. invoice has FORCE RLS;
      -- the owner lifts it for this backfill only, inside the migration's transaction.
      ALTER TABLE invoice NO FORCE ROW LEVEL SECURITY;
      UPDATE invoice i SET situation_number = n.num
        FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, project_id
                                            ORDER BY created_at, invoice_number) AS num
                FROM invoice WHERE type = 'situation' AND status <> 'cancelled') n
       WHERE i.id = n.id;
      ALTER TABLE invoice FORCE ROW LEVEL SECURITY;

      CREATE UNIQUE INDEX invoice_situation_number_key ON invoice (company_id, project_id, situation_number)
        WHERE situation_number IS NOT NULL AND status <> 'cancelled';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS invoice_situation_number_key;
      ALTER TABLE invoice DROP COLUMN situation_number;
      DROP INDEX IF EXISTS idx_invoice_line_offer_line;
      ALTER TABLE invoice_line DROP CONSTRAINT invoice_line_offer_line_same_company;
      ALTER TABLE invoice_line DROP COLUMN offer_line_id;
    `);
  }
}
