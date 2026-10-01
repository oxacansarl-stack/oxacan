-- Bank reconciliation (PRD §16.2 "Rapprochement"): imported bank statements (camt.053 or CSV) and
-- their lines. A line is unmatched, matched (to a recorded payment and / or the invoice it pays)
-- or ignored (bank fees, supplier payments…). A payment confirms at most one bank line, and a line
-- is imported once per company (dedupe_key: the bank's booking reference, else a content hash),
-- so re-importing an overlapping statement does not duplicate lines.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_company_id_id_key') THEN
    ALTER TABLE payment ADD CONSTRAINT payment_company_id_id_key UNIQUE (company_id, id);
  END IF;
END $$;

CREATE TABLE bank_statement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('csv', 'camt053')),
  filename TEXT,
  -- camt.053 Stmt/Id, account IBAN and currency, statement period and balances (camt only).
  statement_ref TEXT,
  iban TEXT,
  currency TEXT,
  period_from DATE,
  period_to DATE,
  opening_balance_cents BIGINT,
  closing_balance_cents BIGINT,
  content_sha256 TEXT NOT NULL,
  line_count INTEGER NOT NULL DEFAULT 0,
  imported_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_statement_company_id_id_key UNIQUE (company_id, id),
  CONSTRAINT bank_statement_content_key UNIQUE (company_id, content_sha256),
  CONSTRAINT bank_statement_imported_by_tenant_fkey FOREIGN KEY (company_id, imported_by)
    REFERENCES app_user (company_id, id)
);

CREATE TABLE bank_statement_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  statement_id UUID NOT NULL,
  line_no INTEGER NOT NULL,
  booking_date DATE NOT NULL,
  value_date DATE,
  -- Signed centimes: incoming (credit) > 0, outgoing (debit) < 0.
  amount_cents BIGINT NOT NULL CHECK (amount_cents <> 0),
  currency TEXT,
  -- Structured creditor reference (QR / RF reference), whitespace removed.
  reference TEXT,
  remittance_info TEXT,
  counterparty_name TEXT,
  counterparty_iban TEXT,
  bank_reference TEXT,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'matched', 'ignored')),
  matched_payment_id UUID,
  matched_invoice_id UUID,
  matched_at TIMESTAMPTZ,
  matched_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_statement_line_dedupe_key UNIQUE (company_id, dedupe_key),
  CONSTRAINT bank_statement_line_statement_id_tenant_fkey FOREIGN KEY (company_id, statement_id)
    REFERENCES bank_statement (company_id, id) ON DELETE CASCADE,
  CONSTRAINT bank_statement_line_matched_payment_id_tenant_fkey FOREIGN KEY (company_id, matched_payment_id)
    REFERENCES payment (company_id, id),
  CONSTRAINT bank_statement_line_matched_invoice_id_tenant_fkey FOREIGN KEY (company_id, matched_invoice_id)
    REFERENCES invoice (company_id, id),
  CONSTRAINT bank_statement_line_matched_by_tenant_fkey FOREIGN KEY (company_id, matched_by)
    REFERENCES app_user (company_id, id),
  CONSTRAINT bank_statement_line_match_check
    CHECK ((status = 'matched') = (matched_payment_id IS NOT NULL OR matched_invoice_id IS NOT NULL))
);
CREATE UNIQUE INDEX bank_statement_line_payment_key ON bank_statement_line (company_id, matched_payment_id)
  WHERE matched_payment_id IS NOT NULL;
CREATE INDEX idx_bank_statement_line_statement ON bank_statement_line (company_id, statement_id, line_no);
CREATE INDEX idx_bank_statement_line_status ON bank_statement_line (company_id, status, booking_date);

ALTER TABLE bank_statement ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bank_statement FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

ALTER TABLE bank_statement_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_statement_line FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bank_statement_line FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());
