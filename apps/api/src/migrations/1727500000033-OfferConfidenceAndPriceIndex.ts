import { MigrationInterface, QueryRunner } from 'typeorm';

// Offer engine alignment with PRD §7.4 / §7.7:
//  - the four confidence dimensions of an offer line (classification, mapping, price, business
//    rule), each 0–1 or NULL when not applicable; confidence_score stays the combined value;
//  - the yearly price index of the INDEXED strategy as a company setting, in basis points like
//    default_vat_rate (200 = +2.00 %/year, the engine's former fixed rate; the PRD names the
//    index, SSE-IPB / construction price index, but gives no rate).
export class OfferConfidenceAndPriceIndex1727500000033 implements MigrationInterface {
  name = 'OfferConfidenceAndPriceIndex1727500000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE offer_line ADD COLUMN confidence_classification REAL
        CONSTRAINT offer_line_confidence_classification_range CHECK (confidence_classification IS NULL OR (confidence_classification >= 0 AND confidence_classification <= 1));
      ALTER TABLE offer_line ADD COLUMN confidence_mapping REAL
        CONSTRAINT offer_line_confidence_mapping_range CHECK (confidence_mapping IS NULL OR (confidence_mapping >= 0 AND confidence_mapping <= 1));
      ALTER TABLE offer_line ADD COLUMN confidence_price REAL
        CONSTRAINT offer_line_confidence_price_range CHECK (confidence_price IS NULL OR (confidence_price >= 0 AND confidence_price <= 1));
      ALTER TABLE offer_line ADD COLUMN confidence_rule REAL
        CONSTRAINT offer_line_confidence_rule_range CHECK (confidence_rule IS NULL OR (confidence_rule >= 0 AND confidence_rule <= 1));

      ALTER TABLE company ADD COLUMN price_index_rate_bp INTEGER NOT NULL DEFAULT 200
        CONSTRAINT company_price_index_rate_bp_range CHECK (price_index_rate_bp BETWEEN -2000 AND 5000);
      COMMENT ON COLUMN company.price_index_rate_bp IS
        'INDEXED pricing (PRD 7.4): yearly price change in basis points (200 = +2.00 %/year), normally the yearly change of the Swiss construction price index (OFS/BFS, SSE-IPB) for the company''s trade.';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE company DROP COLUMN price_index_rate_bp;
      ALTER TABLE offer_line DROP COLUMN confidence_rule;
      ALTER TABLE offer_line DROP COLUMN confidence_price;
      ALTER TABLE offer_line DROP COLUMN confidence_mapping;
      ALTER TABLE offer_line DROP COLUMN confidence_classification;
    `);
  }
}
