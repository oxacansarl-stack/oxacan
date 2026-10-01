-- Data retention (PRD §25): app_user / client_contact rows are anonymised in place, never deleted;
-- anonymised_at makes the retention job idempotent. Indexes for GET /admin/audit-log and the
-- notification purge.
ALTER TABLE app_user ADD COLUMN anonymised_at TIMESTAMPTZ;
ALTER TABLE client_contact ADD COLUMN anonymised_at TIMESTAMPTZ;

CREATE INDEX idx_audit_log_company_created ON audit_log (company_id, created_at DESC, id DESC);
CREATE INDEX idx_audit_log_company_user ON audit_log (company_id, user_id, created_at DESC);
CREATE INDEX idx_notification_created ON notification (created_at);
