import { MigrationInterface, QueryRunner } from 'typeorm';

// Client portal actions (PRD §21.3).
// - Every portal link expires: links created before expiry was enforced (expires_at NULL) get
//   90 days from now, and the column becomes NOT NULL.
// - portal_offer_decision: the client's answer to a sent offer with a simple electronic signature
//   (typed name + consent), the declaration agreed to, IP / user agent and a snapshot of what was
//   answered (reference, version, total, digest of the client view). One answer per offer.
// - portal_comment: comments the client leaves on the project.
// Neither references portal_token: expired links are purged by the retention job, the records stay.
export class PortalClientActions1727500000028 implements MigrationInterface {
  name = 'PortalClientActions1727500000028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- portal_token has FORCE RLS; the owner lifts it for this backfill only, inside the migration's transaction.
      ALTER TABLE portal_token NO FORCE ROW LEVEL SECURITY;
      UPDATE portal_token SET expires_at = now() + interval '90 days' WHERE expires_at IS NULL;
      ALTER TABLE portal_token FORCE ROW LEVEL SECURITY;
      ALTER TABLE portal_token ALTER COLUMN expires_at SET NOT NULL;

      CREATE TABLE portal_offer_decision (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
        project_id UUID NOT NULL,
        offer_id UUID NOT NULL,
        portal_token_id UUID NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
        signer_name TEXT NOT NULL CHECK (length(btrim(signer_name)) BETWEEN 2 AND 200),
        consent_text TEXT NOT NULL,
        comment TEXT CHECK (comment IS NULL OR length(comment) <= 2000),
        offer_reference TEXT,
        offer_version INTEGER NOT NULL,
        offer_total_ttc_cents BIGINT NOT NULL,
        offer_digest TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT portal_offer_decision_offer_key UNIQUE (company_id, offer_id),
        CONSTRAINT portal_offer_decision_project_id_tenant_fkey FOREIGN KEY (company_id, project_id)
          REFERENCES project (company_id, id),
        CONSTRAINT portal_offer_decision_offer_id_tenant_fkey FOREIGN KEY (company_id, offer_id)
          REFERENCES offer (company_id, id)
      );
      CREATE INDEX idx_portal_offer_decision_project ON portal_offer_decision (company_id, project_id);

      ALTER TABLE portal_offer_decision ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal_offer_decision FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON portal_offer_decision FOR ALL
        USING (company_id = app_current_company_id() OR app_rls_bypass())
        WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

      CREATE TABLE portal_comment (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
        project_id UUID NOT NULL,
        portal_token_id UUID NOT NULL,
        author_name TEXT NOT NULL CHECK (length(btrim(author_name)) BETWEEN 1 AND 200),
        body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT portal_comment_project_id_tenant_fkey FOREIGN KEY (company_id, project_id)
          REFERENCES project (company_id, id) ON DELETE CASCADE
      );
      CREATE INDEX idx_portal_comment_project ON portal_comment (company_id, project_id, created_at);
      CREATE INDEX idx_portal_comment_token ON portal_comment (company_id, portal_token_id, created_at);

      ALTER TABLE portal_comment ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal_comment FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON portal_comment FOR ALL
        USING (company_id = app_current_company_id() OR app_rls_bypass())
        WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The backfilled expiry dates are kept: they cannot be told apart from chosen ones.
    await queryRunner.query(`
      DROP TABLE portal_comment;
      DROP TABLE portal_offer_decision;
      ALTER TABLE portal_token ALTER COLUMN expires_at DROP NOT NULL;
    `);
  }
}
