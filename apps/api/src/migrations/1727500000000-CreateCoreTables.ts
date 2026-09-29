import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCoreTables1727500000000 implements MigrationInterface {
  name = 'CreateCoreTables1727500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ========== Company ==========
    await queryRunner.query(`
      CREATE TABLE company (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        legal_name TEXT,
        address_line1 TEXT,
        address_line2 TEXT,
        postal_code TEXT,
        city TEXT,
        canton TEXT,
        country TEXT DEFAULT 'CH',
        vat_number TEXT,
        phone TEXT,
        email TEXT,
        website TEXT,
        logo_url TEXT,
        default_vat_rate INTEGER DEFAULT 810,
        default_margin_factor INTEGER DEFAULT 120,
        default_retention_rate INTEGER DEFAULT 500,
        geolocation_enabled BOOLEAN DEFAULT FALSE,
        subscription_tier TEXT CHECK (subscription_tier IN ('solo', 'equipe', 'entreprise')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(`ALTER TABLE company ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(
      `ALTER TABLE company FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON company
        FOR ALL USING (id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== AppUser ==========
    await queryRunner.query(`
      CREATE TABLE app_user (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id),
        supabase_auth_id UUID UNIQUE,
        email TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        phone TEXT,
        role TEXT NOT NULL CHECK (role IN ('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')),
        licence_tier TEXT NOT NULL CHECK (licence_tier IN ('saas', 'application')),
        hourly_rate_cents INTEGER,
        cct_code TEXT,
        overtime_balance_minutes INTEGER DEFAULT 0,
        hire_date DATE,
        qualifications JSONB DEFAULT '[]',
        is_active BOOLEAN DEFAULT TRUE,
        deactivated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(company_id, email)
      );
    `);

    await queryRunner.query(
      `ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE app_user FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON app_user
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== AuditLog ==========
    await queryRunner.query(`
      CREATE TABLE audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        user_id UUID,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id UUID,
        old_values JSONB,
        new_values JSONB,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "audit_log_insert_only" ON audit_log
        FOR INSERT WITH CHECK (TRUE);
    `);

    // Append-only trigger
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_audit_modification()
        RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER no_audit_update
        BEFORE UPDATE OR DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
    `);

    // ========== Indexes ==========
    await queryRunner.query(`
      CREATE INDEX idx_audit_log_entity
        ON audit_log(company_id, entity_type, entity_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS no_audit_update ON audit_log;`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS prevent_audit_modification;`);
    await queryRunner.query(`DROP TABLE IF EXISTS audit_log;`);
    await queryRunner.query(`DROP TABLE IF EXISTS app_user;`);
    await queryRunner.query(`DROP TABLE IF EXISTS company;`);
  }
}
