-- PRD §15.6: one reminder per planned acompte that is due and not issued yet.
ALTER TABLE financial_alert DROP CONSTRAINT financial_alert_kind_check;
ALTER TABLE financial_alert ADD CONSTRAINT financial_alert_kind_check
  CHECK (kind IN ('budget_drift', 'acompte_overdue', 'plus_value_detected', 'acompte_due'));
