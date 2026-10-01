-- Stored responses for the Idempotency-Key header (see IdempotencyInterceptor), scoped per company + user.
CREATE TABLE idempotency_key (
  company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  key UUID NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  response_status INTEGER,
  -- SQL NULL on a completed key: the response was not storable (stream, too large) and is not replayed.
  response_body JSONB,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  PRIMARY KEY (company_id, user_id, key),
  CONSTRAINT idempotency_key_user_id_tenant_fkey FOREIGN KEY (company_id, user_id)
    REFERENCES app_user (company_id, id) ON DELETE CASCADE,
  CONSTRAINT idempotency_key_completed_check CHECK (status = 'pending' OR response_status IS NOT NULL)
);
-- Expired keys are deleted per user by the API on each keyed request; a periodic job can run
-- DELETE FROM idempotency_key WHERE expires_at < NOW() (as the owner) for idle tenants.
CREATE INDEX idx_idempotency_expires ON idempotency_key (expires_at);

ALTER TABLE idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_key FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_key FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());
