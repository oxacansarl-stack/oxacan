import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase3ContractsProjects1727500000003
  implements MigrationInterface
{
  name = 'Phase3ContractsProjects1727500000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ========== contract ==========
    await queryRunner.query(`
      CREATE TABLE contract (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id),
        offer_id UUID NOT NULL REFERENCES offer(id),
        client_id UUID NOT NULL REFERENCES client(id),
        reference TEXT NOT NULL,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'active', 'completed', 'terminated')),
        signed_at TIMESTAMPTZ,
        total_ttc_cents INTEGER NOT NULL,
        retention_rate INTEGER DEFAULT 500,
        esignature_provider TEXT DEFAULT 'swisscom',
        esignature_request_id TEXT,
        esignature_status TEXT CHECK (esignature_status IN ('none', 'pending', 'signed', 'declined', 'expired')),
        notes TEXT,
        created_by UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE contract ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE contract FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON contract
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== contract_amendment ==========
    await queryRunner.query(`
      CREATE TABLE contract_amendment (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contract_id UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
        company_id UUID NOT NULL,
        amendment_number INTEGER NOT NULL,
        description TEXT NOT NULL,
        amount_delta_cents INTEGER DEFAULT 0,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed')),
        signed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE contract_amendment ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE contract_amendment FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON contract_amendment
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== project ==========
    await queryRunner.query(`
      CREATE TABLE project (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id),
        contract_id UUID REFERENCES contract(id),
        client_id UUID NOT NULL REFERENCES client(id),
        reference TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
        start_date DATE,
        end_date DATE,
        budget_ht_cents INTEGER,
        actual_cost_cents INTEGER DEFAULT 0,
        progress_percent INTEGER DEFAULT 0,
        address TEXT,
        postal_code TEXT,
        city TEXT,
        latitude REAL,
        longitude REAL,
        manager_id UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE project ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE project FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON project
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== project_lot ==========
    await queryRunner.query(`
      CREATE TABLE project_lot (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES project(id),
        company_id UUID NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        budget_cents INTEGER,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE project_lot ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE project_lot FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON project_lot
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== project_milestone ==========
    await queryRunner.query(`
      CREATE TABLE project_milestone (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES project(id),
        lot_id UUID REFERENCES project_lot(id),
        company_id UUID NOT NULL,
        name TEXT NOT NULL,
        target_date DATE,
        completed_date DATE,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'overdue')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE project_milestone ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE project_milestone FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON project_milestone
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== task ==========
    await queryRunner.query(`
      CREATE TABLE task (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES project(id),
        lot_id UUID REFERENCES project_lot(id),
        company_id UUID NOT NULL,
        parent_task_id UUID REFERENCES task(id),
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'validated', 'cancelled')),
        priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
        planned_start DATE,
        planned_end DATE,
        actual_start DATE,
        actual_end DATE,
        estimated_hours REAL,
        actual_hours REAL DEFAULT 0,
        progress_percent INTEGER DEFAULT 0,
        assigned_to UUID REFERENCES app_user(id),
        created_by UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE task ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE task FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON task
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== task_dependency ==========
    await queryRunner.query(`
      CREATE TABLE task_dependency (
        predecessor_id UUID NOT NULL REFERENCES task(id),
        successor_id UUID NOT NULL REFERENCES task(id),
        type TEXT DEFAULT 'finish_to_start' CHECK (type IN ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
        lag_days INTEGER DEFAULT 0,
        PRIMARY KEY (predecessor_id, successor_id)
      );
    `);

    // ========== Indexes ==========
    await queryRunner.query(`
      CREATE INDEX idx_contract_offer ON contract(company_id, offer_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_contract_client ON contract(company_id, client_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_contract_status ON contract(company_id, status);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_project_contract ON project(company_id, contract_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_project_client ON project(company_id, client_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_project_status ON project(company_id, status);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_project_lot_project ON project_lot(project_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_milestone_project ON project_milestone(project_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_project ON task(company_id, project_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_lot ON task(lot_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_assigned ON task(company_id, assigned_to);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_assigned;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_lot;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_project;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_milestone_project;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_project_lot_project;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_project_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_project_client;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_project_contract;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contract_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contract_client;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_contract_offer;`);

    // Drop tables in reverse dependency order
    await queryRunner.query(`DROP TABLE IF EXISTS task_dependency;`);
    await queryRunner.query(`DROP TABLE IF EXISTS task;`);
    await queryRunner.query(`DROP TABLE IF EXISTS project_milestone;`);
    await queryRunner.query(`DROP TABLE IF EXISTS project_lot;`);
    await queryRunner.query(`DROP TABLE IF EXISTS project;`);
    await queryRunner.query(`DROP TABLE IF EXISTS contract_amendment;`);
    await queryRunner.query(`DROP TABLE IF EXISTS contract;`);
  }
}
