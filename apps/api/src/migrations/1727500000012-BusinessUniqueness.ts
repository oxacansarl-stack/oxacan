import { MigrationInterface, QueryRunner } from 'typeorm';

// Database backstops for business uniqueness rules enforced in services.
export class BusinessUniqueness1727500000012 implements MigrationInterface {
  name = 'BusinessUniqueness1727500000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contract ADD CONSTRAINT contract_company_id_reference_key UNIQUE (company_id, reference);
      CREATE UNIQUE INDEX contract_one_live_per_offer ON contract (offer_id) WHERE status <> 'terminated';
      ALTER TABLE project ADD CONSTRAINT project_company_id_reference_key UNIQUE (company_id, reference);
      CREATE UNIQUE INDEX project_one_per_contract ON project (contract_id) WHERE contract_id IS NOT NULL;
      ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_company_id_reference_key UNIQUE (company_id, reference);
      CREATE UNIQUE INDEX invoice_one_credit_note_per_invoice ON invoice (reference_invoice_id) WHERE type = 'credit_note';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX invoice_one_credit_note_per_invoice;
      ALTER TABLE purchase_order DROP CONSTRAINT purchase_order_company_id_reference_key;
      DROP INDEX project_one_per_contract;
      ALTER TABLE project DROP CONSTRAINT project_company_id_reference_key;
      DROP INDEX contract_one_live_per_offer;
      ALTER TABLE contract DROP CONSTRAINT contract_company_id_reference_key;
    `);
  }
}
