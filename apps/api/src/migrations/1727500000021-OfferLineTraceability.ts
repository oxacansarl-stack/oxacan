import { MigrationInterface, QueryRunner } from 'typeorm';

// Offer line traceability (GEE spec §11.2, R007, R008): a proposed line keeps the rule that proposed
// it and the source lines it is based on, next to its confidence score (0–1).
export class OfferLineTraceability1727500000021 implements MigrationInterface {
  name = 'OfferLineTraceability1727500000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE offer_line ADD COLUMN rule_id TEXT;
      ALTER TABLE offer_line ADD COLUMN evidence JSONB NOT NULL DEFAULT '[]'
        CONSTRAINT offer_line_evidence_array CHECK (jsonb_typeof(evidence) = 'array');
      ALTER TABLE offer_line ADD CONSTRAINT offer_line_confidence_score_range
        CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE offer_line DROP CONSTRAINT offer_line_confidence_score_range;
      ALTER TABLE offer_line DROP COLUMN evidence;
      ALTER TABLE offer_line DROP COLUMN rule_id;
    `);
  }
}
