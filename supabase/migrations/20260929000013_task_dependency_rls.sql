-- task_dependency has no company_id; scope it through its predecessor task.
ALTER TABLE task_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependency FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_dependency FOR ALL
  USING (app_rls_bypass() OR EXISTS (
    SELECT 1 FROM task t WHERE t.id = task_dependency.predecessor_id AND t.company_id = app_current_company_id()))
  WITH CHECK (app_rls_bypass() OR EXISTS (
    SELECT 1 FROM task t WHERE t.id = task_dependency.predecessor_id AND t.company_id = app_current_company_id()));
