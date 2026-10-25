-- The employer's EDD payroll tax account number (8 digits, shown as
-- 123-4567-8). It goes on the DE 9, DE 9C and box 15 of each W-2.
ALTER TABLE entities
  ADD COLUMN ca_employer_account text CHECK (ca_employer_account IS NULL OR ca_employer_account ~ '^\d{8}$');
