-- Who rejected a time entry or expense, when, and why (previously lost or appended to notes).
ALTER TABLE time_entry ADD COLUMN rejection_reason TEXT, ADD COLUMN rejected_by UUID, ADD COLUMN rejected_at TIMESTAMPTZ;
ALTER TABLE expense ADD COLUMN rejection_reason TEXT, ADD COLUMN rejected_by UUID, ADD COLUMN rejected_at TIMESTAMPTZ;
ALTER TABLE time_entry ADD CONSTRAINT time_entry_rejected_by_tenant_fkey
  FOREIGN KEY (company_id, rejected_by) REFERENCES app_user (company_id, id);
ALTER TABLE expense ADD CONSTRAINT expense_rejected_by_tenant_fkey
  FOREIGN KEY (company_id, rejected_by) REFERENCES app_user (company_id, id);
