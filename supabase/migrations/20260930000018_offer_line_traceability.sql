-- Offer line traceability: the rule that proposed a line, its source evidence, and a 0–1 confidence.
ALTER TABLE offer_line ADD COLUMN rule_id TEXT;
ALTER TABLE offer_line ADD COLUMN evidence JSONB NOT NULL DEFAULT '[]'
  CONSTRAINT offer_line_evidence_array CHECK (jsonb_typeof(evidence) = 'array');
ALTER TABLE offer_line ADD CONSTRAINT offer_line_confidence_score_range
  CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1));
