import { MigrationInterface, QueryRunner } from 'typeorm';

// User validation of an import (PRD §7.3 step 10: "L'utilisateur confirme ou corrige les
// suggestions"). What a PDF gave us is held in a draft, where a human can correct or drop any line,
// until they confirm it; only then does it become source occurrences, price observations and
// catalogue statistics.
//
// The draft is the right place for a correction because a source occurrence is immutable once
// written (step 4): a reading has to be fixed before it is committed, not after. A draft is working
// data, not a record of anything, so it can be edited and discarded freely.
export class ImportReview1727500000035 implements MigrationInterface {
  name = 'ImportReview1727500000035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE import_draft (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
        -- 'pending' while being reviewed, then 'confirmed' (imported) or 'discarded'.
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'discarded')),
        source TEXT NOT NULL CHECK (source IN ('pdf', 'csv')),
        filename TEXT NOT NULL,
        -- Read off the document; the reviewer may correct any of them before confirming.
        project_name TEXT,
        project_year INTEGER,
        entrepreneur_name TEXT,
        document_date DATE,
        document_reference TEXT,
        page_count INTEGER,
        -- Hash of the file as uploaded, so the same document is not reviewed twice over.
        content_sha256 TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0,
        flagged_count INTEGER NOT NULL DEFAULT 0,
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_by UUID,
        decided_at TIMESTAMPTZ,
        -- The import this draft became, once confirmed.
        source_document_id UUID,
        CONSTRAINT import_draft_company_id_id_key UNIQUE (company_id, id),
        CONSTRAINT import_draft_pending_content_key UNIQUE (company_id, content_sha256),
        CONSTRAINT import_draft_created_by_tenant_fkey FOREIGN KEY (company_id, created_by)
          REFERENCES app_user (company_id, id),
        CONSTRAINT import_draft_decided_by_tenant_fkey FOREIGN KEY (company_id, decided_by)
          REFERENCES app_user (company_id, id)
      );

      CREATE TABLE import_draft_row (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
        draft_id UUID NOT NULL,
        line_number INTEGER NOT NULL,
        page INTEGER,
        raw_text TEXT NOT NULL DEFAULT '',
        -- What the reader made of the line. Every one of these may be corrected.
        npk_number TEXT,
        description TEXT,
        unit TEXT,
        quantity NUMERIC(14, 3),
        unit_price_cents BIGINT,
        total_price_cents BIGINT,
        section_code TEXT,
        room_type TEXT,
        floor TEXT,
        is_variant BOOLEAN NOT NULL DEFAULT FALSE,
        -- 'pending' until the reviewer acts; 'edited' once corrected; 'excluded' to drop the line.
        review_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (review_status IN ('pending', 'edited', 'excluded')),
        -- Why this line wants a human eye: TOTAL_MISMATCH, MISSING_QUANTITY, UNKNOWN_CODE…
        flags TEXT[] NOT NULL DEFAULT '{}',
        edited_at TIMESTAMPTZ,
        CONSTRAINT import_draft_row_draft_tenant_fkey FOREIGN KEY (company_id, draft_id)
          REFERENCES import_draft (company_id, id) ON DELETE CASCADE
      );

      CREATE INDEX idx_import_draft_status ON import_draft (company_id, status, created_at DESC);
      CREATE INDEX idx_import_draft_row_draft ON import_draft_row (company_id, draft_id, line_number);

      ALTER TABLE import_draft ENABLE ROW LEVEL SECURITY;
      ALTER TABLE import_draft FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON import_draft FOR ALL
        USING (company_id = app_current_company_id() OR app_rls_bypass())
        WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

      ALTER TABLE import_draft_row ENABLE ROW LEVEL SECURITY;
      ALTER TABLE import_draft_row FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON import_draft_row FOR ALL
        USING (company_id = app_current_company_id() OR app_rls_bypass())
        WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE import_draft_row;
      DROP TABLE import_draft;
    `);
  }
}
