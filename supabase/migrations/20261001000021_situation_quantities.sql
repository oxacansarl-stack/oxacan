-- Situations (PRD §15.2): situation lines are tied to the offer position they bill, so the server
-- computes the quantity earlier situations already billed; situations are numbered per project.
ALTER TABLE invoice_line ADD COLUMN offer_line_id UUID;
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_offer_line_same_company
  FOREIGN KEY (company_id, offer_line_id) REFERENCES offer_line (company_id, id) ON DELETE RESTRICT;
CREATE INDEX idx_invoice_line_offer_line ON invoice_line (company_id, offer_line_id)
  WHERE offer_line_id IS NOT NULL;

ALTER TABLE invoice ADD COLUMN situation_number INTEGER
  CONSTRAINT invoice_situation_number_check
  CHECK (situation_number IS NULL OR (type = 'situation' AND situation_number > 0));

-- Number the existing situations of each project in creation order. invoice has FORCE RLS;
-- the owner lifts it for this backfill only, inside the migration's transaction.
ALTER TABLE invoice NO FORCE ROW LEVEL SECURITY;
UPDATE invoice i SET situation_number = n.num
  FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, project_id
                                      ORDER BY created_at, invoice_number) AS num
          FROM invoice WHERE type = 'situation' AND status <> 'cancelled') n
 WHERE i.id = n.id;
ALTER TABLE invoice FORCE ROW LEVEL SECURITY;

-- A cancelled draft gives its number back (it never reached the client).
CREATE UNIQUE INDEX invoice_situation_number_key ON invoice (company_id, project_id, situation_number)
  WHERE situation_number IS NOT NULL AND status <> 'cancelled';
