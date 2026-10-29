-- The rest of what the CDTFA's registration approval gives a business: its
-- CDTFA account number (what online services and every return ask for) and
-- the date its seller's permit takes effect. Returns are due only from the
-- period the permit starts in, so reminders and the period list start there.
ALTER TABLE entities
  ADD COLUMN cdtfa_account     text CHECK (cdtfa_account IS NULL OR cdtfa_account ~ '^[0-9][0-9-]{5,19}$'),
  ADD COLUMN sales_tax_start   date;
