-- Phase 1: CRM, catalogue, plans (mirrors TypeORM migration 1727500000001)
CREATE TABLE client (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  type TEXT CHECK (type IN ('entreprise_generale', 'maitre_ouvrage', 'architecte', 'sous_traitant', 'fournisseur', 'autre')),
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  postal_code TEXT,
  city TEXT,
  canton TEXT,
  country TEXT DEFAULT 'CH',
  notes TEXT,
  pipeline_stage TEXT DEFAULT 'prospect',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client ENABLE ROW LEVEL SECURITY;

ALTER TABLE client FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON client
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

CREATE TABLE client_contact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client_contact ENABLE ROW LEVEL SECURITY;

ALTER TABLE client_contact FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON client_contact
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

CREATE TABLE client_interaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  user_id UUID,
  type TEXT CHECK (type IN ('call', 'email', 'meeting', 'note', 'site_visit')),
  subject TEXT,
  body TEXT,
  interaction_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client_interaction ENABLE ROW LEVEL SECURITY;

ALTER TABLE client_interaction FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON client_interaction
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

CREATE TABLE canonical_article (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  npk_number TEXT,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  category TEXT,
  is_composed BOOLEAN DEFAULT FALSE,
  composed_components JSONB,
  median_price_cents INTEGER,
  min_price_cents INTEGER,
  max_price_cents INTEGER,
  observation_count INTEGER DEFAULT 0,
  last_price_date DATE,
  confidence_classification REAL DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE canonical_article ENABLE ROW LEVEL SECURITY;

ALTER TABLE canonical_article FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON canonical_article
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

CREATE TABLE article_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_article_id UUID NOT NULL REFERENCES canonical_article(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  alias_text TEXT NOT NULL,
  source TEXT,
  match_confidence REAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE article_alias ENABLE ROW LEVEL SECURITY;

ALTER TABLE article_alias FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON article_alias
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

CREATE TABLE source_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  hash_sha256 TEXT NOT NULL,
  filename TEXT NOT NULL,
  project_name TEXT,
  project_year INTEGER,
  entrepreneur_name TEXT,
  document_type TEXT DEFAULT 'soumission',
  import_date TIMESTAMPTZ,
  status TEXT DEFAULT 'imported',
  total_occurrences INTEGER DEFAULT 0,
  matched_occurrences INTEGER DEFAULT 0,
  imported_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, hash_sha256)
);

ALTER TABLE source_document ENABLE ROW LEVEL SECURITY;

ALTER TABLE source_document FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON source_document
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

CREATE TABLE source_occurrence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id UUID NOT NULL REFERENCES source_document(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  line_number INTEGER,
  raw_text TEXT NOT NULL,
  npk_number TEXT,
  description TEXT,
  unit TEXT,
  quantity REAL,
  unit_price_cents INTEGER,
  total_price_cents INTEGER,
  room_type TEXT,
  floor TEXT,
  status TEXT DEFAULT 'unmatched',
  canonical_article_id UUID REFERENCES canonical_article(id),
  match_confidence REAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE source_occurrence ENABLE ROW LEVEL SECURITY;

ALTER TABLE source_occurrence FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON source_occurrence
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

CREATE OR REPLACE FUNCTION prevent_source_occurrence_modification()
  RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source_occurrence is immutable after creation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_source_occurrence_update
  BEFORE UPDATE OR DELETE ON source_occurrence
  FOR EACH ROW EXECUTE FUNCTION prevent_source_occurrence_modification();

CREATE TABLE price_observation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_article_id UUID NOT NULL REFERENCES canonical_article(id),
  company_id UUID NOT NULL,
  source_occurrence_id UUID REFERENCES source_occurrence(id),
  unit_price_cents INTEGER NOT NULL,
  observation_date DATE NOT NULL,
  project_name TEXT,
  project_type TEXT,
  is_outlier BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE price_observation ENABLE ROW LEVEL SECURITY;

ALTER TABLE price_observation FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON price_observation
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

CREATE TABLE plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID,
  offer_id UUID,
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'dwg', 'dxf', 'png', 'jpg')),
  file_size_bytes INTEGER,
  version INTEGER DEFAULT 1,
  scale TEXT,
  floor TEXT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE plan ENABLE ROW LEVEL SECURITY;

ALTER TABLE plan FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON plan
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

CREATE TABLE plan_annotation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pin', 'rectangle', 'polygon', 'text', 'measurement')),
  geometry JSONB NOT NULL,
  label TEXT,
  color TEXT DEFAULT '#FF0000',
  linked_offer_line_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE plan_annotation ENABLE ROW LEVEL SECURITY;

ALTER TABLE plan_annotation FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON plan_annotation
  FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);

CREATE INDEX idx_client_company ON client(company_id, pipeline_stage);

CREATE INDEX idx_client_contact_client ON client_contact(client_id);

CREATE INDEX idx_canonical_article_company ON canonical_article(company_id, npk_number);

CREATE INDEX idx_price_observation_article ON price_observation(company_id, canonical_article_id, observation_date);

CREATE INDEX idx_source_occurrence_document ON source_occurrence(source_document_id);

CREATE INDEX idx_plan_project ON plan(company_id, project_id);

CREATE INDEX idx_plan_offer ON plan(company_id, offer_id);

CREATE INDEX idx_plan_annotation_plan ON plan_annotation(plan_id);
