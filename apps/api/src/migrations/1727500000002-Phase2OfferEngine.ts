import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase2OfferEngine1727500000002
  implements MigrationInterface
{
  name = 'Phase2OfferEngine1727500000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ========== room_type ==========
    await queryRunner.query(`
      CREATE TABLE room_type (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        typical_articles JSONB DEFAULT '[]',
        project_count INTEGER DEFAULT 0,
        occurrence_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE room_type ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE room_type FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON room_type
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== project_type ==========
    await queryRunner.query(`
      CREATE TABLE project_type (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE project_type ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE project_type FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON project_type
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== business_rule ==========
    await queryRunner.query(`
      CREATE TABLE business_rule (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        canonical_article_id UUID NOT NULL REFERENCES canonical_article(id),
        room_type_id UUID REFERENCES room_type(id),
        project_type_id UUID REFERENCES project_type(id),
        suggested_quantity REAL,
        confidence REAL DEFAULT 0,
        source TEXT CHECK (source IN ('statistical', 'manual', 'ai_suggested')),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE business_rule ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE business_rule FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON business_rule
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== offer ==========
    await queryRunner.query(`
      CREATE TABLE offer (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id),
        client_id UUID NOT NULL REFERENCES client(id),
        project_name TEXT NOT NULL,
        project_type_id UUID REFERENCES project_type(id),
        reference TEXT,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'submitted', 'accepted', 'rejected', 'archived')),
        version INTEGER DEFAULT 1,
        margin_factor INTEGER DEFAULT 120,
        total_ht_cents INTEGER DEFAULT 0,
        total_vat_cents INTEGER DEFAULT 0,
        total_ttc_cents INTEGER DEFAULT 0,
        vat_rate INTEGER DEFAULT 810,
        validity_days INTEGER DEFAULT 30,
        notes TEXT,
        submitted_at TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ,
        created_by UUID,
        updated_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE offer ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE offer FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON offer
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== offer_line ==========
    await queryRunner.query(`
      CREATE TABLE offer_line (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        offer_id UUID NOT NULL REFERENCES offer(id) ON DELETE CASCADE,
        company_id UUID NOT NULL,
        canonical_article_id UUID REFERENCES canonical_article(id),
        position_number INTEGER NOT NULL,
        description TEXT NOT NULL,
        unit TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_price_cents INTEGER,
        total_price_cents INTEGER,
        pricing_strategy TEXT CHECK (pricing_strategy IN ('LATEST', 'MEDIAN_N', 'INDEXED', 'COMPOSED', 'MANUAL')),
        confidence_score REAL,
        room_type TEXT,
        variant_type TEXT DEFAULT 'BASE' CHECK (variant_type IN ('BASE', 'VARIANTE', 'OPTION', 'HYPOTHESE_A_VALIDER', 'INFORMATION_MANQUANTE', 'EXCLU')),
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE offer_line ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE offer_line FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON offer_line
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== offer_assumption ==========
    await queryRunner.query(`
      CREATE TABLE offer_assumption (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        offer_id UUID NOT NULL REFERENCES offer(id) ON DELETE CASCADE,
        company_id UUID NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('VARIANTE', 'OPTION', 'HYPOTHESE_A_VALIDER', 'INFORMATION_MANQUANTE', 'EXCLU')),
        description TEXT NOT NULL,
        impact_amount_cents INTEGER,
        status TEXT DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'rejected')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE offer_assumption ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE offer_assumption FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON offer_assumption
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== Indexes ==========
    await queryRunner.query(`
      CREATE INDEX idx_offer_client ON offer(company_id, client_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_offer_status ON offer(company_id, status);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_offer_line_offer ON offer_line(offer_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_offer_assumption_offer ON offer_assumption(offer_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_business_rule_article ON business_rule(company_id, canonical_article_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_room_type_company ON room_type(company_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_room_type_company;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_business_rule_article;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offer_assumption_offer;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offer_line_offer;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offer_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_offer_client;`);

    // Drop tables in reverse dependency order
    await queryRunner.query(`DROP TABLE IF EXISTS offer_assumption;`);
    await queryRunner.query(`DROP TABLE IF EXISTS offer_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS offer;`);
    await queryRunner.query(`DROP TABLE IF EXISTS business_rule;`);
    await queryRunner.query(`DROP TABLE IF EXISTS project_type;`);
    await queryRunner.query(`DROP TABLE IF EXISTS room_type;`);
  }
}
