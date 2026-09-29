-- Creditor account for Swiss QR-bills and the default invoice payment term.
ALTER TABLE company
  ADD COLUMN iban TEXT,
  ADD COLUMN default_payment_terms_days INTEGER NOT NULL DEFAULT 30
    CHECK (default_payment_terms_days BETWEEN 0 AND 365);
