import { MigrationInterface, QueryRunner } from 'typeorm';

// Soumission import traceability (GEE spec §10, R001, R004, R007): each document keeps the date it
// was issued (prices are dated by it, not by the import day) and each source line keeps its page,
// section and whether it is a variant (variants never feed the price statistics).
export class ImportTraceability1727500000017 implements MigrationInterface {
  name = 'ImportTraceability1727500000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE source_document ADD COLUMN document_date DATE;
      ALTER TABLE source_occurrence ADD COLUMN page INTEGER CHECK (page > 0);
      ALTER TABLE source_occurrence ADD COLUMN section_code TEXT;
      ALTER TABLE source_occurrence ADD COLUMN is_variant BOOLEAN NOT NULL DEFAULT false;
      CREATE INDEX idx_price_observation_source_occurrence ON price_observation(source_occurrence_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX idx_price_observation_source_occurrence;
      ALTER TABLE source_occurrence DROP COLUMN is_variant;
      ALTER TABLE source_occurrence DROP COLUMN section_code;
      ALTER TABLE source_occurrence DROP COLUMN page;
      ALTER TABLE source_document DROP COLUMN document_date;
    `);
  }
}
