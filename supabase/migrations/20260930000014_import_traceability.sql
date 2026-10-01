-- Soumission import traceability: document date, and page / section / variant flag per source line.
ALTER TABLE source_document ADD COLUMN document_date DATE;
ALTER TABLE source_occurrence ADD COLUMN page INTEGER CHECK (page > 0);
ALTER TABLE source_occurrence ADD COLUMN section_code TEXT;
ALTER TABLE source_occurrence ADD COLUMN is_variant BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_price_observation_source_occurrence ON price_observation(source_occurrence_id);
