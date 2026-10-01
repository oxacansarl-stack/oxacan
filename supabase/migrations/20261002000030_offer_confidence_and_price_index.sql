-- Offer engine (PRD §7.4 / §7.7): the four confidence dimensions of an offer line, and the
-- company's yearly INDEXED price index in basis points (200 = +2.00 %/year).
ALTER TABLE offer_line ADD COLUMN confidence_classification REAL
  CONSTRAINT offer_line_confidence_classification_range CHECK (confidence_classification IS NULL OR (confidence_classification >= 0 AND confidence_classification <= 1));
ALTER TABLE offer_line ADD COLUMN confidence_mapping REAL
  CONSTRAINT offer_line_confidence_mapping_range CHECK (confidence_mapping IS NULL OR (confidence_mapping >= 0 AND confidence_mapping <= 1));
ALTER TABLE offer_line ADD COLUMN confidence_price REAL
  CONSTRAINT offer_line_confidence_price_range CHECK (confidence_price IS NULL OR (confidence_price >= 0 AND confidence_price <= 1));
ALTER TABLE offer_line ADD COLUMN confidence_rule REAL
  CONSTRAINT offer_line_confidence_rule_range CHECK (confidence_rule IS NULL OR (confidence_rule >= 0 AND confidence_rule <= 1));

ALTER TABLE company ADD COLUMN price_index_rate_bp INTEGER NOT NULL DEFAULT 200
  CONSTRAINT company_price_index_rate_bp_range CHECK (price_index_rate_bp BETWEEN -2000 AND 5000);
COMMENT ON COLUMN company.price_index_rate_bp IS
  'INDEXED pricing (PRD 7.4): yearly price change in basis points (200 = +2.00 %/year), normally the yearly change of the Swiss construction price index (OFS/BFS, SSE-IPB) for the company''s trade.';
