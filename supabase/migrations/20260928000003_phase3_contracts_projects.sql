-- OXACAN Phase 3: Contracts & Projects Tables
-- With RLS + FORCE ROW LEVEL SECURITY for dual-layer tenant isolation

-- ========== contract ==========
CREATE TABLE IF NOT EXISTS contract (
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

ALTER TABLE contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contract' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON contract
      FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
  END IF;
END $$;

-- ========== contract_amendment ==========
CREATE TABLE IF NOT EXISTS contract_amendment (
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

ALTER TABLE contract_amendment ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_amendment FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contract_amendment' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON contract_amendment
      FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
  END IF;
END $$;

-- ========== project ==========
CREATE TABLE IF NOT EXISTS project (
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

ALTER TABLE project ENABLE ROW LEVEL SECURITY;
ALTER TABLE project FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON project
      FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
  END IF;
END $$;

-- ========== project_lot ==========
CREATE TABLE IF NOT EXISTS project_lot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id),
  company_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  budget_cents INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE project_lot ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_lot FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_lot' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON project_lot
      FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
  END IF;
END $$;

-- ========== project_milestone ==========
CREATE TABLE IF NOT EXISTS project_milestone (
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

ALTER TABLE project_milestone ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_milestone FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_milestone' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON project_milestone
      FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
  END IF;
END $$;

-- ========== task ==========
CREATE TABLE IF NOT EXISTS task (
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

ALTER TABLE task ENABLE ROW LEVEL SECURITY;
ALTER TABLE task FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON task
      FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
  END IF;
END $$;

-- ========== task_dependency ==========
CREATE TABLE IF NOT EXISTS task_dependency (
  predecessor_id UUID NOT NULL REFERENCES task(id),
  successor_id UUID NOT NULL REFERENCES task(id),
  type TEXT DEFAULT 'finish_to_start' CHECK (type IN ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
  lag_days INTEGER DEFAULT 0,
  PRIMARY KEY (predecessor_id, successor_id)
);

-- ========== Indexes ==========
CREATE INDEX IF NOT EXISTS idx_contract_offer ON contract(company_id, offer_id);
CREATE INDEX IF NOT EXISTS idx_contract_client ON contract(company_id, client_id);
CREATE INDEX IF NOT EXISTS idx_contract_status ON contract(company_id, status);
CREATE INDEX IF NOT EXISTS idx_project_contract ON project(company_id, contract_id);
CREATE INDEX IF NOT EXISTS idx_project_client ON project(company_id, client_id);
CREATE INDEX IF NOT EXISTS idx_project_status ON project(company_id, status);
CREATE INDEX IF NOT EXISTS idx_project_lot_project ON project_lot(project_id);
CREATE INDEX IF NOT EXISTS idx_milestone_project ON project_milestone(project_id);
CREATE INDEX IF NOT EXISTS idx_task_project ON task(company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_task_lot ON task(lot_id);
CREATE INDEX IF NOT EXISTS idx_task_assigned ON task(company_id, assigned_to);
