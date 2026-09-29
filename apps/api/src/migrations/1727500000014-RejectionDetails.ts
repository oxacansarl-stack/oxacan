import { MigrationInterface, QueryRunner } from 'typeorm';

// Who rejected a time entry or expense, when, and why (previously lost or appended to notes).
export class RejectionDetails1727500000014 implements MigrationInterface {
  name = 'RejectionDetails1727500000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE time_entry ADD COLUMN rejection_reason TEXT, ADD COLUMN rejected_by UUID, ADD COLUMN rejected_at TIMESTAMPTZ;
      ALTER TABLE expense ADD COLUMN rejection_reason TEXT, ADD COLUMN rejected_by UUID, ADD COLUMN rejected_at TIMESTAMPTZ;
      ALTER TABLE time_entry ADD CONSTRAINT time_entry_rejected_by_tenant_fkey
        FOREIGN KEY (company_id, rejected_by) REFERENCES app_user (company_id, id);
      ALTER TABLE expense ADD CONSTRAINT expense_rejected_by_tenant_fkey
        FOREIGN KEY (company_id, rejected_by) REFERENCES app_user (company_id, id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE expense DROP CONSTRAINT expense_rejected_by_tenant_fkey;
      ALTER TABLE time_entry DROP CONSTRAINT time_entry_rejected_by_tenant_fkey;
      ALTER TABLE expense DROP COLUMN rejection_reason, DROP COLUMN rejected_by, DROP COLUMN rejected_at;
      ALTER TABLE time_entry DROP COLUMN rejection_reason, DROP COLUMN rejected_by, DROP COLUMN rejected_at;
    `);
  }
}
