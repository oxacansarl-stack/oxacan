-- OXACAN Phase 0: Core Tables (Company, AppUser, AuditLog)
-- With RLS + FORCE ROW LEVEL SECURITY for dual-layer tenant isolation

-- ========== Company ==========
CREATE TABLE IF NOT EXISTS company (
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

ALTER TABLE company ENABLE ROW LEVEL SECURITY;
ALTER TABLE company FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'company' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON company
      FOR ALL USING (id = current_setting('app.company_id', true)::uuid);
  END IF;
END $$;

-- ========== AppUser ==========
CREATE TABLE IF NOT EXISTS app_user (
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

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_user' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY "tenant_isolation" ON app_user
      FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
  END IF;
END $$;

-- ========== AuditLog ==========
CREATE TABLE IF NOT EXISTS audit_log (
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

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_log' AND policyname = 'audit_log_insert_only') THEN
    CREATE POLICY "audit_log_insert_only" ON audit_log
      FOR INSERT WITH CHECK (TRUE);
  END IF;
END $$;

-- Append-only trigger
CREATE OR REPLACE FUNCTION prevent_audit_modification()
  RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_audit_update ON audit_log;
CREATE TRIGGER no_audit_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ========== Indexes ==========
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON audit_log(company_id, entity_type, entity_id);
