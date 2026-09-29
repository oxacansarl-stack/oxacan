-- Unset tenant now matches no rows instead of failing the uuid cast.
-- app.rls_bypass is only set by the API for pre-tenant lookups (JWT user, portal token);
-- RLS here is a safety net for missing WHERE clauses, not a boundary against SQL injection.
CREATE OR REPLACE FUNCTION app_current_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.rls_bypass', true), '') = 'on' $$;

DROP POLICY IF EXISTS tenant_isolation ON company;
CREATE POLICY tenant_isolation ON company FOR ALL
  USING (id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON app_user;
CREATE POLICY tenant_isolation ON app_user FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON article_alias;
CREATE POLICY tenant_isolation ON article_alias FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON billing_event;
CREATE POLICY tenant_isolation ON billing_event FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON business_rule;
CREATE POLICY tenant_isolation ON business_rule FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON canonical_article;
CREATE POLICY tenant_isolation ON canonical_article FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON chart_of_accounts;
CREATE POLICY tenant_isolation ON chart_of_accounts FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON client;
CREATE POLICY tenant_isolation ON client FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON client_contact;
CREATE POLICY tenant_isolation ON client_contact FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON client_interaction;
CREATE POLICY tenant_isolation ON client_interaction FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON contract;
CREATE POLICY tenant_isolation ON contract FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON contract_amendment;
CREATE POLICY tenant_isolation ON contract_amendment FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON daily_report;
CREATE POLICY tenant_isolation ON daily_report FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON expense;
CREATE POLICY tenant_isolation ON expense FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON invoice;
CREATE POLICY tenant_isolation ON invoice FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON invoice_line;
CREATE POLICY tenant_isolation ON invoice_line FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON journal_entry;
CREATE POLICY tenant_isolation ON journal_entry FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON journal_entry_line;
CREATE POLICY tenant_isolation ON journal_entry_line FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON meeting_action;
CREATE POLICY tenant_isolation ON meeting_action FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON meeting_attendee;
CREATE POLICY tenant_isolation ON meeting_attendee FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON notification;
CREATE POLICY tenant_isolation ON notification FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON offer;
CREATE POLICY tenant_isolation ON offer FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON offer_assumption;
CREATE POLICY tenant_isolation ON offer_assumption FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON offer_line;
CREATE POLICY tenant_isolation ON offer_line FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON payment;
CREATE POLICY tenant_isolation ON payment FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON plan;
CREATE POLICY tenant_isolation ON plan FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON plan_annotation;
CREATE POLICY tenant_isolation ON plan_annotation FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON plus_value;
CREATE POLICY tenant_isolation ON plus_value FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON portal_token;
CREATE POLICY tenant_isolation ON portal_token FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON price_observation;
CREATE POLICY tenant_isolation ON price_observation FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON project;
CREATE POLICY tenant_isolation ON project FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON project_lot;
CREATE POLICY tenant_isolation ON project_lot FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON project_milestone;
CREATE POLICY tenant_isolation ON project_milestone FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON project_type;
CREATE POLICY tenant_isolation ON project_type FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON purchase_order;
CREATE POLICY tenant_isolation ON purchase_order FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON purchase_order_line;
CREATE POLICY tenant_isolation ON purchase_order_line FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON push_device;
CREATE POLICY tenant_isolation ON push_device FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON room_type;
CREATE POLICY tenant_isolation ON room_type FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON site_meeting;
CREATE POLICY tenant_isolation ON site_meeting FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON source_document;
CREATE POLICY tenant_isolation ON source_document FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON source_occurrence;
CREATE POLICY tenant_isolation ON source_occurrence FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON stock_item;
CREATE POLICY tenant_isolation ON stock_item FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON stock_location;
CREATE POLICY tenant_isolation ON stock_location FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON stock_movement;
CREATE POLICY tenant_isolation ON stock_movement FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON subscription;
CREATE POLICY tenant_isolation ON subscription FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON supplier;
CREATE POLICY tenant_isolation ON supplier FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON task;
CREATE POLICY tenant_isolation ON task FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON team;
CREATE POLICY tenant_isolation ON team FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON time_entry;
CREATE POLICY tenant_isolation ON time_entry FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS tenant_isolation ON vehicle;
CREATE POLICY tenant_isolation ON vehicle FOR ALL
  USING (company_id = app_current_company_id() OR app_rls_bypass())
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());

DROP POLICY IF EXISTS audit_log_insert_only ON audit_log;
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (company_id = app_current_company_id() OR app_rls_bypass());
CREATE POLICY audit_log_read ON audit_log FOR SELECT
  USING (company_id = app_current_company_id() OR app_rls_bypass());
