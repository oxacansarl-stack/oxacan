import { MigrationInterface, QueryRunner } from 'typeorm';

// VAT on expenses: amount_cents stays the TTC total actually paid; vat_rate_bps is the Swiss rate in
// basis points (810 = 8.1 %) and vat_amount_cents the VAT it contains, computed by the API and
// rounded to the centime. NULL = unknown (existing rows); project costs then use the TTC amount.
export class ExpenseVat1727500000031 implements MigrationInterface {
  name = 'ExpenseVat1727500000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE expense ADD COLUMN vat_rate_bps INTEGER;
      ALTER TABLE expense ADD COLUMN vat_amount_cents BIGINT;
      ALTER TABLE expense ADD CONSTRAINT expense_vat_rate_bps_check
        CHECK (vat_rate_bps IS NULL OR vat_rate_bps IN (0, 260, 380, 810));
      ALTER TABLE expense ADD CONSTRAINT expense_vat_amount_cents_check
        CHECK (vat_amount_cents IS NULL OR (vat_amount_cents >= 0 AND vat_amount_cents <= amount_cents));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE expense DROP CONSTRAINT IF EXISTS expense_vat_amount_cents_check;
      ALTER TABLE expense DROP CONSTRAINT IF EXISTS expense_vat_rate_bps_check;
      ALTER TABLE expense DROP COLUMN vat_amount_cents;
      ALTER TABLE expense DROP COLUMN vat_rate_bps;
    `);
  }
}
