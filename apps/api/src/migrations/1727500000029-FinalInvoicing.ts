import { MigrationInterface, QueryRunner } from 'typeorm';

// Invoicing, PRD §15 (Build Strategy Phase 6):
// - contract.final_acceptance_*: the réception finale (§15.4). Once recorded, the project's final
//   invoice (décompte final, type 'final_invoice') can be created; it releases the retention held
//   on earlier situations. The retention rate itself was already per contract (retention_rate).
// - company.invoice_number_format: the invoice number format of each company (§15.1), e.g.
//   'F-{YYYY}-{NNNN}'. The default '{YYYY}-{NNN}' is the format every existing number already has.
// - acompte_schedule_item: acomptes planned by a contract (date + HT amount or % of the contract),
//   so the ones due can be reminded (§15.6). invoice.acompte_schedule_item_id links the acompte
//   invoice issued for one; a cancelled or credited invoice frees it again.
export class FinalInvoicing1727500000029 implements MigrationInterface {
  name = 'FinalInvoicing1727500000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contract ADD COLUMN final_acceptance_date DATE;
      ALTER TABLE contract ADD COLUMN final_acceptance_notes TEXT;
      ALTER TABLE contract ADD COLUMN final_acceptance_recorded_by UUID;
      ALTER TABLE contract ADD CONSTRAINT contract_final_acceptance_recorded_by_tenant_fkey
        FOREIGN KEY (company_id, final_acceptance_recorded_by) REFERENCES app_user (company_id, id)
        ON DELETE SET NULL (final_acceptance_recorded_by);

      -- Literals, one {N…} sequence token (its length is the zero padding) and at most one year token.
      ALTER TABLE company ADD COLUMN invoice_number_format TEXT NOT NULL DEFAULT '{YYYY}-{NNN}'
        CONSTRAINT company_invoice_number_format_check CHECK (
          length(invoice_number_format) <= 40
          AND invoice_number_format ~ '^([A-Za-z0-9 ._/-]|\\{(YYYY|YY|N{1,9})\\})+$'
          AND invoice_number_format ~ '\\{N+\\}'
          AND invoice_number_format !~ '\\{N+\\}.*\\{N+\\}'
          AND invoice_number_format !~ '\\{YY(YY)?\\}.*\\{YY(YY)?\\}'
        );

      CREATE TABLE acompte_schedule_item (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
        contract_id UUID NOT NULL,
        due_date DATE NOT NULL,
        label TEXT,
        -- Exactly one of: a fixed HT amount, or basis points of the contract's HT value.
        amount_ht_cents BIGINT CHECK (amount_ht_cents > 0),
        percent_bps INTEGER CHECK (percent_bps > 0 AND percent_bps <= 10000),
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT acompte_schedule_item_amount_check CHECK ((amount_ht_cents IS NULL) <> (percent_bps IS NULL)),
        CONSTRAINT acompte_schedule_item_company_id_id_key UNIQUE (company_id, id),
        CONSTRAINT acompte_schedule_item_contract_id_tenant_fkey FOREIGN KEY (company_id, contract_id)
          REFERENCES contract (company_id, id) ON DELETE CASCADE,
        CONSTRAINT acompte_schedule_item_created_by_tenant_fkey FOREIGN KEY (company_id, created_by)
          REFERENCES app_user (company_id, id) ON DELETE SET NULL (created_by)
      );
      CREATE INDEX idx_acompte_schedule_item_contract ON acompte_schedule_item (company_id, contract_id, due_date);
      CREATE INDEX idx_acompte_schedule_item_due ON acompte_schedule_item (company_id, due_date);

      ALTER TABLE acompte_schedule_item ENABLE ROW LEVEL SECURITY;
      ALTER TABLE acompte_schedule_item FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON acompte_schedule_item FOR ALL
        USING (company_id = app_current_company_id() OR app_rls_bypass())
        WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

      ALTER TABLE invoice ADD COLUMN acompte_schedule_item_id UUID
        CONSTRAINT invoice_acompte_schedule_item_type_check
        CHECK (acompte_schedule_item_id IS NULL OR type = 'acompte');
      ALTER TABLE invoice ADD CONSTRAINT invoice_acompte_schedule_item_tenant_fkey
        FOREIGN KEY (company_id, acompte_schedule_item_id) REFERENCES acompte_schedule_item (company_id, id)
        ON DELETE SET NULL (acompte_schedule_item_id);
      CREATE INDEX idx_invoice_acompte_schedule_item ON invoice (company_id, acompte_schedule_item_id)
        WHERE acompte_schedule_item_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_invoice_acompte_schedule_item;
      ALTER TABLE invoice DROP CONSTRAINT invoice_acompte_schedule_item_tenant_fkey;
      ALTER TABLE invoice DROP COLUMN acompte_schedule_item_id;
      DROP TABLE acompte_schedule_item;
      ALTER TABLE company DROP COLUMN invoice_number_format;
      ALTER TABLE contract DROP CONSTRAINT contract_final_acceptance_recorded_by_tenant_fkey;
      ALTER TABLE contract DROP COLUMN final_acceptance_recorded_by;
      ALTER TABLE contract DROP COLUMN final_acceptance_notes;
      ALTER TABLE contract DROP COLUMN final_acceptance_date;
    `);
  }
}
