-- Database backstops for business uniqueness rules enforced in services
ALTER TABLE contract ADD CONSTRAINT contract_company_id_reference_key UNIQUE (company_id, reference);
CREATE UNIQUE INDEX contract_one_live_per_offer ON contract (offer_id) WHERE status <> 'terminated';
ALTER TABLE project ADD CONSTRAINT project_company_id_reference_key UNIQUE (company_id, reference);
CREATE UNIQUE INDEX project_one_per_contract ON project (contract_id) WHERE contract_id IS NOT NULL;
ALTER TABLE purchase_order ADD CONSTRAINT purchase_order_company_id_reference_key UNIQUE (company_id, reference);
CREATE UNIQUE INDEX invoice_one_credit_note_per_invoice ON invoice (reference_invoice_id) WHERE type = 'credit_note';
