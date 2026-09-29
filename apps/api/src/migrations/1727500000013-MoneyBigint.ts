import { MigrationInterface, QueryRunner } from 'typeorm';

// Money columns (centimes) to BIGINT: INTEGER capped single amounts at ~CHF 21.4 million.
export class MoneyBigint1727500000013 implements MigrationInterface {
  name = 'MoneyBigint1727500000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE app_user ALTER COLUMN hourly_rate_cents TYPE bigint;
      ALTER TABLE billing_event ALTER COLUMN amount_cents TYPE bigint;
      ALTER TABLE canonical_article ALTER COLUMN max_price_cents TYPE bigint, ALTER COLUMN median_price_cents TYPE bigint, ALTER COLUMN min_price_cents TYPE bigint;
      ALTER TABLE contract ALTER COLUMN total_ttc_cents TYPE bigint;
      ALTER TABLE contract_amendment ALTER COLUMN amount_delta_cents TYPE bigint;
      ALTER TABLE expense ALTER COLUMN amount_cents TYPE bigint;
      ALTER TABLE invoice ALTER COLUMN amount_paid_cents TYPE bigint, ALTER COLUMN prior_acomptes_cents TYPE bigint, ALTER COLUMN retention_amount_cents TYPE bigint, ALTER COLUMN subtotal_ht_cents TYPE bigint, ALTER COLUMN total_ttc_cents TYPE bigint, ALTER COLUMN vat_amount_cents TYPE bigint;
      ALTER TABLE invoice_line ALTER COLUMN total_price_cents TYPE bigint, ALTER COLUMN unit_price_cents TYPE bigint;
      ALTER TABLE journal_entry_line ALTER COLUMN credit_cents TYPE bigint, ALTER COLUMN debit_cents TYPE bigint;
      ALTER TABLE offer ALTER COLUMN total_ht_cents TYPE bigint, ALTER COLUMN total_ttc_cents TYPE bigint, ALTER COLUMN total_vat_cents TYPE bigint;
      ALTER TABLE offer_assumption ALTER COLUMN impact_amount_cents TYPE bigint;
      ALTER TABLE offer_line ALTER COLUMN total_price_cents TYPE bigint, ALTER COLUMN unit_price_cents TYPE bigint;
      ALTER TABLE payment ALTER COLUMN amount_cents TYPE bigint;
      ALTER TABLE plus_value ALTER COLUMN amount_cents TYPE bigint;
      ALTER TABLE price_observation ALTER COLUMN unit_price_cents TYPE bigint;
      ALTER TABLE project ALTER COLUMN actual_cost_cents TYPE bigint, ALTER COLUMN budget_ht_cents TYPE bigint;
      ALTER TABLE project_lot ALTER COLUMN budget_cents TYPE bigint;
      ALTER TABLE purchase_order ALTER COLUMN total_ht_cents TYPE bigint;
      ALTER TABLE purchase_order_line ALTER COLUMN total_price_cents TYPE bigint, ALTER COLUMN unit_price_cents TYPE bigint;
      ALTER TABLE source_occurrence ALTER COLUMN total_price_cents TYPE bigint, ALTER COLUMN unit_price_cents TYPE bigint;
      ALTER TABLE time_entry ALTER COLUMN cost_cents TYPE bigint, ALTER COLUMN hourly_rate_cents TYPE bigint;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE app_user ALTER COLUMN hourly_rate_cents TYPE integer;
      ALTER TABLE billing_event ALTER COLUMN amount_cents TYPE integer;
      ALTER TABLE canonical_article ALTER COLUMN max_price_cents TYPE integer, ALTER COLUMN median_price_cents TYPE integer, ALTER COLUMN min_price_cents TYPE integer;
      ALTER TABLE contract ALTER COLUMN total_ttc_cents TYPE integer;
      ALTER TABLE contract_amendment ALTER COLUMN amount_delta_cents TYPE integer;
      ALTER TABLE expense ALTER COLUMN amount_cents TYPE integer;
      ALTER TABLE invoice ALTER COLUMN amount_paid_cents TYPE integer, ALTER COLUMN prior_acomptes_cents TYPE integer, ALTER COLUMN retention_amount_cents TYPE integer, ALTER COLUMN subtotal_ht_cents TYPE integer, ALTER COLUMN total_ttc_cents TYPE integer, ALTER COLUMN vat_amount_cents TYPE integer;
      ALTER TABLE invoice_line ALTER COLUMN total_price_cents TYPE integer, ALTER COLUMN unit_price_cents TYPE integer;
      ALTER TABLE journal_entry_line ALTER COLUMN credit_cents TYPE integer, ALTER COLUMN debit_cents TYPE integer;
      ALTER TABLE offer ALTER COLUMN total_ht_cents TYPE integer, ALTER COLUMN total_ttc_cents TYPE integer, ALTER COLUMN total_vat_cents TYPE integer;
      ALTER TABLE offer_assumption ALTER COLUMN impact_amount_cents TYPE integer;
      ALTER TABLE offer_line ALTER COLUMN total_price_cents TYPE integer, ALTER COLUMN unit_price_cents TYPE integer;
      ALTER TABLE payment ALTER COLUMN amount_cents TYPE integer;
      ALTER TABLE plus_value ALTER COLUMN amount_cents TYPE integer;
      ALTER TABLE price_observation ALTER COLUMN unit_price_cents TYPE integer;
      ALTER TABLE project ALTER COLUMN actual_cost_cents TYPE integer, ALTER COLUMN budget_ht_cents TYPE integer;
      ALTER TABLE project_lot ALTER COLUMN budget_cents TYPE integer;
      ALTER TABLE purchase_order ALTER COLUMN total_ht_cents TYPE integer;
      ALTER TABLE purchase_order_line ALTER COLUMN total_price_cents TYPE integer, ALTER COLUMN unit_price_cents TYPE integer;
      ALTER TABLE source_occurrence ALTER COLUMN total_price_cents TYPE integer, ALTER COLUMN unit_price_cents TYPE integer;
      ALTER TABLE time_entry ALTER COLUMN cost_cents TYPE integer, ALTER COLUMN hourly_rate_cents TYPE integer;
    `);
  }
}
