import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase6InvoicingAccounting1727500000006
  implements MigrationInterface
{
  name = 'Phase6InvoicingAccounting1727500000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ========== invoice ==========
    await queryRunner.query(`
      CREATE TABLE invoice (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id),
        project_id UUID NOT NULL REFERENCES project(id),
        client_id UUID NOT NULL REFERENCES client(id),
        type TEXT NOT NULL CHECK (type IN ('invoice', 'situation', 'acompte', 'credit_note', 'final_invoice')),
        invoice_number TEXT NOT NULL,
        reference_invoice_id UUID REFERENCES invoice(id),
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled')),
        issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
        due_date DATE,
        vat_rate INTEGER NOT NULL,
        subtotal_ht_cents INTEGER NOT NULL DEFAULT 0,
        vat_amount_cents INTEGER NOT NULL DEFAULT 0,
        retention_amount_cents INTEGER DEFAULT 0,
        prior_acomptes_cents INTEGER DEFAULT 0,
        total_ttc_cents INTEGER NOT NULL DEFAULT 0,
        amount_paid_cents INTEGER DEFAULT 0,
        notes TEXT,
        payment_terms TEXT,
        pdf_url TEXT,
        sent_at TIMESTAMPTZ,
        paid_at TIMESTAMPTZ,
        created_by UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(company_id, invoice_number)
      );
    `);

    await queryRunner.query(
      `ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE invoice FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON invoice
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== invoice_line ==========
    await queryRunner.query(`
      CREATE TABLE invoice_line (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id UUID NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
        company_id UUID NOT NULL,
        description TEXT NOT NULL,
        unit TEXT,
        quantity REAL NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        total_price_cents INTEGER NOT NULL,
        cumulative_quantity REAL,
        previous_quantity REAL,
        period_quantity REAL,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE invoice_line ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE invoice_line FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON invoice_line
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== plus_value ==========
    await queryRunner.query(`
      CREATE TABLE plus_value (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        project_id UUID NOT NULL REFERENCES project(id),
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        status TEXT DEFAULT 'detected' CHECK (status IN ('detected', 'submitted', 'approved', 'rejected', 'invoiced')),
        approved_by_client BOOLEAN DEFAULT FALSE,
        approved_at TIMESTAMPTZ,
        invoice_id UUID REFERENCES invoice(id),
        created_by UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE plus_value ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE plus_value FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON plus_value
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== chart_of_accounts ==========
    await queryRunner.query(`
      CREATE TABLE chart_of_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id),
        account_number TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
        parent_id UUID REFERENCES chart_of_accounts(id),
        is_system BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(company_id, account_number)
      );
    `);

    await queryRunner.query(
      `ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON chart_of_accounts
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== journal_entry ==========
    await queryRunner.query(`
      CREATE TABLE journal_entry (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id),
        entry_number INTEGER NOT NULL,
        entry_date DATE NOT NULL,
        description TEXT NOT NULL,
        reference_type TEXT,
        reference_id UUID,
        is_posted BOOLEAN DEFAULT FALSE,
        posted_at TIMESTAMPTZ,
        posted_by UUID REFERENCES app_user(id),
        created_by UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(company_id, entry_number)
      );
    `);

    await queryRunner.query(
      `ALTER TABLE journal_entry ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE journal_entry FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON journal_entry
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== journal_entry_line ==========
    await queryRunner.query(`
      CREATE TABLE journal_entry_line (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        journal_entry_id UUID NOT NULL REFERENCES journal_entry(id),
        company_id UUID NOT NULL,
        account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
        debit_cents INTEGER DEFAULT 0,
        credit_cents INTEGER DEFAULT 0,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE journal_entry_line ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE journal_entry_line FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON journal_entry_line
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== payment ==========
    await queryRunner.query(`
      CREATE TABLE payment (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL,
        invoice_id UUID NOT NULL REFERENCES invoice(id),
        amount_cents INTEGER NOT NULL,
        payment_date DATE NOT NULL,
        payment_method TEXT CHECK (payment_method IN ('bank_transfer', 'card', 'cash', 'other')),
        reference TEXT,
        journal_entry_id UUID REFERENCES journal_entry(id),
        created_by UUID REFERENCES app_user(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryRunner.query(
      `ALTER TABLE payment ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(
      `ALTER TABLE payment FORCE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY "tenant_isolation" ON payment
        FOR ALL USING (company_id = current_setting('app.company_id', true)::uuid);
    `);

    // ========== Indexes ==========
    await queryRunner.query(`
      CREATE INDEX idx_invoice_project ON invoice(company_id, project_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_invoice_client ON invoice(company_id, client_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_invoice_status ON invoice(company_id, status);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_invoice_number ON invoice(company_id, invoice_number);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_invoice_line_invoice ON invoice_line(invoice_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_plus_value_project ON plus_value(company_id, project_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_plus_value_status ON plus_value(company_id, status);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_coa_company ON chart_of_accounts(company_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_journal_entry_company ON journal_entry(company_id, entry_date);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_journal_entry_line ON journal_entry_line(journal_entry_id);
    `);
    await queryRunner.query(`
      CREATE INDEX idx_payment_invoice ON payment(company_id, invoice_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX IF EXISTS idx_payment_invoice;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_journal_entry_line;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_journal_entry_company;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_coa_company;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_plus_value_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_plus_value_project;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_invoice_line_invoice;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_invoice_number;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_invoice_status;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_invoice_client;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_invoice_project;`);

    // Drop tables in reverse dependency order
    await queryRunner.query(`DROP TABLE IF EXISTS payment;`);
    await queryRunner.query(`DROP TABLE IF EXISTS journal_entry_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS journal_entry;`);
    await queryRunner.query(`DROP TABLE IF EXISTS chart_of_accounts;`);
    await queryRunner.query(`DROP TABLE IF EXISTS plus_value;`);
    await queryRunner.query(`DROP TABLE IF EXISTS invoice_line;`);
    await queryRunner.query(`DROP TABLE IF EXISTS invoice;`);
  }
}
