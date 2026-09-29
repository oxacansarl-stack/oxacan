-- Phase 4: Field Operations (Timekeeping, Expenses, Daily Reports)

-- ========== time_entry ==========
CREATE TABLE time_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_user(id),
  project_id UUID NOT NULL REFERENCES project(id),
  task_id UUID REFERENCES task(id),
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  break_minutes INTEGER DEFAULT 0,
  normal_minutes INTEGER,
  overtime_minutes INTEGER DEFAULT 0,
  travel_minutes INTEGER DEFAULT 0,
  total_minutes INTEGER,
  hourly_rate_cents INTEGER,
  cost_cents INTEGER,
  category TEXT DEFAULT 'normal' CHECK (category IN ('normal', 'overtime', 'travel', 'absence')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  approved_by UUID REFERENCES app_user(id),
  approved_at TIMESTAMPTZ,
  latitude REAL,
  longitude REAL,
  notes TEXT,
  is_offline_entry BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE time_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON time_entry
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

-- ========== expense ==========
CREATE TABLE expense (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_user(id),
  project_id UUID REFERENCES project(id),
  task_id UUID REFERENCES task(id),
  date DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('material', 'travel', 'per_diem', 'subcontractor', 'equipment_rental', 'other')),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  receipt_url TEXT,
  is_billable BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  approved_by UUID REFERENCES app_user(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE expense ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON expense
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

-- ========== daily_report ==========
CREATE TABLE daily_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_user(id),
  project_id UUID NOT NULL REFERENCES project(id),
  date DATE NOT NULL,
  work_description TEXT,
  materials_used JSONB DEFAULT '[]',
  weather TEXT,
  temperature_celsius REAL,
  notes TEXT,
  photos JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_id, project_id, date)
);

ALTER TABLE daily_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_report FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON daily_report
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

-- ========== Indexes ==========
CREATE INDEX idx_time_entry_user ON time_entry(company_id, user_id);
CREATE INDEX idx_time_entry_project ON time_entry(company_id, project_id);
CREATE INDEX idx_time_entry_date ON time_entry(company_id, date);
CREATE INDEX idx_time_entry_status ON time_entry(company_id, status);
CREATE INDEX idx_expense_user ON expense(company_id, user_id);
CREATE INDEX idx_expense_project ON expense(company_id, project_id);
CREATE INDEX idx_expense_status ON expense(company_id, status);
CREATE INDEX idx_daily_report_user ON daily_report(company_id, user_id);
CREATE INDEX idx_daily_report_project ON daily_report(company_id, project_id);
