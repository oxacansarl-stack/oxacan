import { MigrationInterface, QueryRunner } from 'typeorm';

// Creditor account for Swiss QR-bills and the default invoice payment term.
export class CompanyBanking1727500000015 implements MigrationInterface {
  name = 'CompanyBanking1727500000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE company
        ADD COLUMN iban TEXT,
        ADD COLUMN default_payment_terms_days INTEGER NOT NULL DEFAULT 30
          CHECK (default_payment_terms_days BETWEEN 0 AND 365);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE company DROP COLUMN default_payment_terms_days, DROP COLUMN iban;`);
  }
}
