import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase5HRProcurement1727500000005
  implements MigrationInterface
{
  name = 'Phase5HRProcurement1727500000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ========== team ==========
    await queryRunner.query(`
      CREATE TABLE team (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id),
        name TEXT NOT NULL,
        leader_id UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE team ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE team FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON team
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== team_member (junction — no RLS) ==========
    await queryRunner.query(`
      CREATE TABLE team_member (
        team_id UUID NOT NULL REFERENCES team(id),
        user_id UUID NOT NULL REFERENCES app_user(id),
        company_id UUID NOT NULL,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (team_id, user_id)
      );
    `);

    // ========== supplier ==========
    await queryRunner.query(`
      CREATE TABLE supplier (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        name TEXT NOT NULL,
        contact_person TEXT,
        email TEXT,
        phone TEXT,
        address TEXT,
        payment_terms_days INTEGER DEFAULT 30,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE supplier ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE supplier FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON supplier
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== purchase_order ==========
    await queryRunner.query(`
      CREATE TABLE purchase_order (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        supplier_id UUID NOT NULL REFERENCES supplier(id),
        project_id UUID REFERENCES project(id),
        reference TEXT NOT NULL,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'confirmed', 'partially_delivered', 'delivered', 'cancelled')),
        total_ht_cents INTEGER DEFAULT 0,
        ordered_at TIMESTAMPTZ,
        expected_delivery DATE,
        created_by UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE purchase_order ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE purchase_order FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON purchase_order
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== purchase_order_line ==========
    await queryRunner.query(`
      CREATE TABLE purchase_order_line (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_id UUID NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
        company_id UUID NOT NULL,
        canonical_article_id UUID REFERENCES canonical_article(id),
        description TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        total_price_cents INTEGER NOT NULL,
        delivered_quantity REAL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE purchase_order_line ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE purchase_order_line FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON purchase_order_line
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== stock_location ==========
    await queryRunner.query(`
      CREATE TABLE stock_location (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        name TEXT NOT NULL,
        type TEXT CHECK (type IN ('warehouse', 'vehicle', 'site')),
        address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE stock_location ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE stock_location FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON stock_location
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== stock_item ==========
    await queryRunner.query(`
      CREATE TABLE stock_item (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        canonical_article_id UUID NOT NULL REFERENCES canonical_article(id),
        location_id UUID NOT NULL REFERENCES stock_location(id),
        quantity REAL NOT NULL DEFAULT 0,
        min_threshold REAL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(company_id, canonical_article_id, location_id)
      );
    `);

    await queryRunner.query(
      `ALTER TABLE stock_item ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE stock_item FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON stock_item
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== stock_movement ==========
    await queryRunner.query(`
      CREATE TABLE stock_movement (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        stock_item_id UUID NOT NULL REFERENCES stock_item(id),
        type TEXT NOT NULL CHECK (type IN ('in', 'out', 'transfer', 'adjustment')),
        quantity REAL NOT NULL,
        from_location_id UUID REFERENCES stock_location(id),
        to_location_id UUID REFERENCES stock_location(id),
        project_id UUID REFERENCES project(id),
        reference TEXT,
        performed_by UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE stock_movement ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE stock_movement FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON stock_movement
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== vehicle ==========
    await queryRunner.query(`
      CREATE TABLE vehicle (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        registration TEXT NOT NULL,
        make TEXT,
        model TEXT,
        assigned_team_id UUID REFERENCES team(id),
        assigned_project_id UUID REFERENCES project(id),
        insurance_expiry DATE,
        next_service_date DATE,
        odometer_km INTEGER,
        stock_location_id UUID REFERENCES stock_location(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE vehicle ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE vehicle FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON vehicle
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== site_meeting ==========
    await queryRunner.query(`
      CREATE TABLE site_meeting (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        project_id UUID NOT NULL REFERENCES project(id),
        meeting_number INTEGER NOT NULL,
        meeting_date TIMESTAMPTZ NOT NULL,
        location TEXT,
        agenda TEXT,
        minutes TEXT,
        status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed')),
        pdf_url TEXT,
        created_by UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE site_meeting ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE site_meeting FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON site_meeting
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== meeting_attendee ==========
    await queryRunner.query(`
      CREATE TABLE meeting_attendee (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        meeting_id UUID NOT NULL REFERENCES site_meeting(id) ON DELETE CASCADE,
        company_id UUID NOT NULL,
        name TEXT NOT NULL,
        role TEXT,
        organization TEXT,
        attendance TEXT DEFAULT 'present' CHECK (attendance IN ('present', 'absent', 'excused')),
        signature_url TEXT
      );
    `);

    await queryRunner.query(
      `ALTER TABLE meeting_attendee ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE meeting_attendee FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON meeting_attendee
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== meeting_action ==========
    await queryRunner.query(`
      CREATE TABLE meeting_action (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        meeting_id UUID NOT NULL REFERENCES site_meeting(id) ON DELETE CASCADE,
        company_id UUID NOT NULL,
        description TEXT NOT NULL,
        responsible TEXT NOT NULL,
        due_date DATE,
        status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE meeting_action ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE meeting_action FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON meeting_action
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== Indexes ==========
    await queryRunner.query(`
      CREATE INDEX idx_team_company ON team(company_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_supplier_company ON supplier(company_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_po_supplier ON purchase_order(company_id, supplier_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_po_project ON purchase_order(company_id, project_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_po_status ON purchase_order(company_id, status);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_po_line_po ON purchase_order_line(purchase_order_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_stock_item_article ON stock_item(company_id, canonical_article_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_stock_item_location ON stock_item(location_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_stock_movement_item ON stock_movement(stock_item_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_vehicle_company ON vehicle(company_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_meeting_project ON site_meeting(company_id, project_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_meeting_attendee ON meeting_attendee(meeting_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_meeting_action ON meeting_action(meeting_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_meeting_action;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_meeting_attendee;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_meeting_project;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_vehicle_company;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_stock_movement_item;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_stock_item_location;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_stock_item_article;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_po_line_po;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_po_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_po_project;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_po_supplier;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_supplier_company;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_team_company;`);

    // Drop tables in reverse dependency order
    await queryRunner.query(`DROP TABLE IF EXISTS meeting_action;`);
    await queryRunner.query(`DROP TABLE IF EXISTS meeting_attendee;`);
    await queryRunner.query(`DROP TABLE IF EXISTS site_meeting;`);
    await queryRunner.query(`DROP TABLE IF EXISTS vehicle;`);
    await queryRunner.query(`DROP TABLE IF EXISTS stock_movement;`);
    await queryRunner.query(`DROP TABLE IF EXISTS stock_item;`);
    await queryRunner.query(`DROP TABLE IF EXISTS stock_location;`);
    await queryRunner.query(`DROP TABLE IF EXISTS purchase_order_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS purchase_order;`);
    await queryRunner.query(`DROP TABLE IF EXISTS supplier;`);
    await queryRunner.query(`DROP TABLE IF EXISTS team_member;`);
    await queryRunner.query(`DROP TABLE IF EXISTS team;`);
  }
}
