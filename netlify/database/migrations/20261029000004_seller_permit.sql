-- The business's own California seller's permit and how often the CDTFA
-- has it file sales and use tax returns. Both come from the permit the
-- CDTFA issues; the return worksheet uses them for its periods and due dates.
ALTER TABLE entities
  ADD COLUMN seller_permit         text CHECK (seller_permit IS NULL OR seller_permit ~ '^[A-Z0-9][A-Z0-9 -]{4,23}$'),
  ADD COLUMN sales_tax_filing      text CHECK (sales_tax_filing IS NULL OR sales_tax_filing IN ('monthly', 'quarterly', 'quarterly_prepay', 'yearly', 'fiscal_yearly'));
