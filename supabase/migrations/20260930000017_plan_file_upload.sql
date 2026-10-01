-- Uploaded plan files (PDF / PNG / JPEG, at most 25 MiB, one per plan) and 'symbol' annotations.
ALTER TABLE plan_annotation DROP CONSTRAINT plan_annotation_type_check;
ALTER TABLE plan_annotation ADD CONSTRAINT plan_annotation_type_check
  CHECK (type IN ('pin', 'rectangle', 'polygon', 'text', 'measurement', 'symbol'));

CREATE TABLE plan_file (
  plan_id UUID PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES company(id),
  content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  data BYTEA NOT NULL,
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_file_size_matches_data CHECK (octet_length(data) = size_bytes),
  CONSTRAINT plan_file_plan_same_company
    FOREIGN KEY (company_id, plan_id) REFERENCES plan (company_id, id) ON DELETE CASCADE,
  CONSTRAINT plan_file_uploaded_by_same_company
    FOREIGN KEY (company_id, uploaded_by) REFERENCES app_user (company_id, id) ON DELETE SET NULL (uploaded_by)
);
-- PDFs and images are already compressed: store out of line without another compression pass.
ALTER TABLE plan_file ALTER COLUMN data SET STORAGE EXTERNAL;

ALTER TABLE plan_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_file FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plan_file FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());
