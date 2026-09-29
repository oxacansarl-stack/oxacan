import { MigrationInterface, QueryRunner } from 'typeorm';

// task_dependency has no company_id; scope it through its predecessor task so it is isolated
// like every other tenant table (and readable at all where Supabase auto-enables RLS).
export class TaskDependencyRls1727500000016 implements MigrationInterface {
  name = 'TaskDependencyRls1727500000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_dependency ENABLE ROW LEVEL SECURITY;
      ALTER TABLE task_dependency FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON task_dependency FOR ALL
        USING (app_rls_bypass() OR EXISTS (
          SELECT 1 FROM task t WHERE t.id = task_dependency.predecessor_id AND t.company_id = app_current_company_id()))
        WITH CHECK (app_rls_bypass() OR EXISTS (
          SELECT 1 FROM task t WHERE t.id = task_dependency.predecessor_id AND t.company_id = app_current_company_id()));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY tenant_isolation ON task_dependency;
      ALTER TABLE task_dependency NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE task_dependency DISABLE ROW LEVEL SECURITY;
    `);
  }
}
