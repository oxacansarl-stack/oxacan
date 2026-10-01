import { MigrationInterface, QueryRunner } from 'typeorm';

// plan.project_id, plan.offer_id and plan_annotation.linked_offer_line_id had no foreign key at
// all, so a company could attach its plans to another company's project or offer. Scope them to
// the row's own company like the other links (see TenantScopedForeignKeys1727500000011).
export class TenantScopedPlanLinks1727500000018 implements MigrationInterface {
  name = 'TenantScopedPlanLinks1727500000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      SELECT set_config('app.rls_bypass', 'on', true);

      -- Drop links that point outside the row's company (or to rows that no longer exist).
      UPDATE plan p SET project_id = NULL WHERE project_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM project x WHERE x.id = p.project_id AND x.company_id = p.company_id);
      UPDATE plan p SET offer_id = NULL WHERE offer_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM offer x WHERE x.id = p.offer_id AND x.company_id = p.company_id);
      UPDATE plan_annotation a SET linked_offer_line_id = NULL WHERE linked_offer_line_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM offer_line x WHERE x.id = a.linked_offer_line_id AND x.company_id = a.company_id);

      ALTER TABLE offer_line ADD CONSTRAINT offer_line_company_id_id_key UNIQUE (company_id, id);

      ALTER TABLE plan ADD CONSTRAINT plan_project_same_company
        FOREIGN KEY (company_id, project_id) REFERENCES project (company_id, id) ON DELETE SET NULL (project_id);
      ALTER TABLE plan ADD CONSTRAINT plan_offer_same_company
        FOREIGN KEY (company_id, offer_id) REFERENCES offer (company_id, id) ON DELETE SET NULL (offer_id);
      ALTER TABLE plan_annotation ADD CONSTRAINT plan_annotation_offer_line_same_company
        FOREIGN KEY (company_id, linked_offer_line_id) REFERENCES offer_line (company_id, id) ON DELETE SET NULL (linked_offer_line_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE plan_annotation DROP CONSTRAINT plan_annotation_offer_line_same_company;
      ALTER TABLE plan DROP CONSTRAINT plan_offer_same_company;
      ALTER TABLE plan DROP CONSTRAINT plan_project_same_company;
      ALTER TABLE offer_line DROP CONSTRAINT offer_line_company_id_id_key;
    `);
  }
}
