-- California taxes digital products (prewritten software, including SaaS)
-- from January 1, 2027 (SB 122, Rev. & Tax. Code §6016.1).
--
--   * Customers can hold a use tax direct payment permit: past $5,000,000 a
--     year of software from one seller, the buyer reports the tax instead.
--   * Customers can give a multiple-points-of-use certificate saying what
--     share of their use is in California (proposed Regulation 1600.2).
--   * Invoice lines carry the period the customer has access, which decides
--     the tax, and how much of the line is taxable.

ALTER TABLE contacts
  ADD COLUMN direct_pay_permit    text CHECK (direct_pay_permit IS NULL OR length(trim(direct_pay_permit)) > 0),
  ADD COLUMN mpu_ca_percent       numeric(5, 2) CHECK (mpu_ca_percent IS NULL OR mpu_ca_percent BETWEEN 0 AND 100),
  ADD COLUMN mpu_certificate_date date,
  ADD CHECK ((mpu_ca_percent IS NULL) = (mpu_certificate_date IS NULL));

-- A new way an invoice's tax can be decided: the buyer pays it directly.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'documents'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%user_entered%';
  EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE documents ADD CONSTRAINT documents_tax_source_check
  CHECK (tax_source IN ('none', 'user_entered', 'not_taxable', 'resale', 'out_of_state', 'lookup', 'manual', 'direct_pay'));

ALTER TABLE document_lines
  ADD COLUMN service_period_start date,
  ADD COLUMN service_period_end   date,
  -- The part of a taxable line that is taxed, when less than all of it.
  ADD COLUMN taxable_minor        money_minor,
  -- Why a software line is untaxed or partly taxed.
  ADD COLUMN tax_exemption        text CHECK (tax_exemption IS NULL OR tax_exemption IN ('direct_pay', 'mpu')),
  ADD CHECK (service_period_end IS NULL OR (service_period_start IS NOT NULL AND service_period_end >= service_period_start)),
  ADD CHECK (taxable_minor IS NULL OR (taxable AND taxable_minor BETWEEN 0 AND amount_minor));

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'document_lines'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%(tax_minor)::numeric =%';
  EXECUTE format('ALTER TABLE document_lines DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE document_lines ADD CONSTRAINT document_lines_tax_check
  CHECK (tax_minor = CASE WHEN taxable THEN round(coalesce(taxable_minor, amount_minor) * tax_rate) ELSE 0 END);
