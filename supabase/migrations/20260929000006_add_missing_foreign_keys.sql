-- Add foreign keys declared by entities but missing from the schema
ALTER TABLE client_interaction ADD CONSTRAINT client_interaction_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user(id);
ALTER TABLE project_type ADD CONSTRAINT project_type_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id);
ALTER TABLE room_type ADD CONSTRAINT room_type_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id);
ALTER TABLE business_rule ADD CONSTRAINT business_rule_company_id_fkey FOREIGN KEY (company_id) REFERENCES company(id);
ALTER TABLE source_document ADD CONSTRAINT source_document_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES app_user(id);
