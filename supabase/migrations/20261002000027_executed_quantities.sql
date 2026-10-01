-- Executed quantities per offer position (PRD §10 field operations, §15.2: situations are billed on
-- the quantities actually executed). An append-only ledger per project + offer line: each entry adds
-- quantity_delta to the position; cumulative_quantity is the recorded total right after the entry.
-- - 'delta': quantity executed since the last entry (> 0)
-- - 'cumulative': the total measured on site; the server stores the difference as the delta (> 0)
-- - 'correction': adjusts the entry in corrects_entry_id (same position), signed, with a note
-- Entries are never edited: a mistake is fixed by a correction. A project manager validates entries
-- (validated_at / validated_by); only validated entries count towards what a situation may bill.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_report_company_id_id_key') THEN
    ALTER TABLE daily_report ADD CONSTRAINT daily_report_company_id_id_key UNIQUE (company_id, id);
  END IF;
END $$;

CREATE TABLE executed_quantity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  offer_line_id UUID NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('delta', 'cumulative', 'correction')),
  quantity_delta NUMERIC(18, 6) NOT NULL,
  cumulative_quantity NUMERIC(18, 6) NOT NULL CHECK (cumulative_quantity >= 0),
  corrects_entry_id UUID,
  daily_report_id UUID,
  task_id UUID,
  note TEXT,
  recorded_by UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_by UUID,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT executed_quantity_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT executed_quantity_position_id_key UNIQUE (company_id, project_id, offer_line_id, id),
  CONSTRAINT executed_quantity_project_id_tenant_fkey FOREIGN KEY (company_id, project_id)
    REFERENCES project (company_id, id),
  -- RESTRICT, like invoice_line: an executed position can't disappear from under its entries.
  CONSTRAINT executed_quantity_offer_line_id_tenant_fkey FOREIGN KEY (company_id, offer_line_id)
    REFERENCES offer_line (company_id, id) ON DELETE RESTRICT,
  -- A correction adjusts an entry of the same project and position.
  CONSTRAINT executed_quantity_corrects_entry_id_tenant_fkey
    FOREIGN KEY (company_id, project_id, offer_line_id, corrects_entry_id)
    REFERENCES executed_quantity (company_id, project_id, offer_line_id, id),
  -- Deleting the daily report or task keeps the entry and only drops the link.
  CONSTRAINT executed_quantity_daily_report_id_tenant_fkey FOREIGN KEY (company_id, daily_report_id)
    REFERENCES daily_report (company_id, id) ON DELETE SET NULL (daily_report_id),
  CONSTRAINT executed_quantity_task_id_tenant_fkey FOREIGN KEY (company_id, task_id)
    REFERENCES task (company_id, id) ON DELETE SET NULL (task_id),
  CONSTRAINT executed_quantity_recorded_by_tenant_fkey FOREIGN KEY (company_id, recorded_by)
    REFERENCES app_user (company_id, id),
  CONSTRAINT executed_quantity_validated_by_tenant_fkey FOREIGN KEY (company_id, validated_by)
    REFERENCES app_user (company_id, id),
  CONSTRAINT executed_quantity_correction_check CHECK (
    (entry_type = 'correction') = (corrects_entry_id IS NOT NULL)
    AND (entry_type <> 'correction' OR (quantity_delta <> 0 AND length(btrim(coalesce(note, ''))) > 0))
    AND (entry_type = 'correction' OR quantity_delta > 0)
  ),
  CONSTRAINT executed_quantity_validation_check CHECK ((validated_at IS NULL) = (validated_by IS NULL))
);
CREATE INDEX idx_executed_quantity_position ON executed_quantity (company_id, project_id, offer_line_id, recorded_at);
CREATE INDEX idx_executed_quantity_pending ON executed_quantity (company_id, project_id)
  WHERE validated_at IS NULL;
CREATE INDEX idx_executed_quantity_daily_report ON executed_quantity (company_id, daily_report_id)
  WHERE daily_report_id IS NOT NULL;
CREATE INDEX idx_executed_quantity_task ON executed_quantity (company_id, task_id)
  WHERE task_id IS NOT NULL;

-- Append-only: the only changes allowed are a first validation and a deleted report/task link.
CREATE OR REPLACE FUNCTION executed_quantity_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.offer_line_id IS DISTINCT FROM OLD.offer_line_id
     OR NEW.entry_type IS DISTINCT FROM OLD.entry_type
     OR NEW.quantity_delta IS DISTINCT FROM OLD.quantity_delta
     OR NEW.cumulative_quantity IS DISTINCT FROM OLD.cumulative_quantity
     OR NEW.corrects_entry_id IS DISTINCT FROM OLD.corrects_entry_id
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.daily_report_id IS DISTINCT FROM OLD.daily_report_id AND NEW.daily_report_id IS NOT NULL)
     OR (NEW.task_id IS DISTINCT FROM OLD.task_id AND NEW.task_id IS NOT NULL)
     OR (OLD.validated_at IS NOT NULL AND (NEW.validated_at IS DISTINCT FROM OLD.validated_at
                                           OR NEW.validated_by IS DISTINCT FROM OLD.validated_by))
  THEN
    RAISE EXCEPTION 'executed_quantity entries are append-only; record a correction instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER executed_quantity_append_only BEFORE UPDATE ON executed_quantity
  FOR EACH ROW EXECUTE FUNCTION executed_quantity_append_only();

ALTER TABLE executed_quantity ENABLE ROW LEVEL SECURITY;
ALTER TABLE executed_quantity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON executed_quantity FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());
