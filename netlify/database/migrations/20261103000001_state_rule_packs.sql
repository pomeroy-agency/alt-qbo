-- Payroll for states other than California. Each state's rule pack names its
-- own taxes, deposits and forms, so the California-only columns give way to
-- general ones. The old columns stay (unused) so this can be rolled back.

-- The employer's state payroll account number (EDD in California, TWC in
-- Texas...). Its format is checked against the state's rule pack.
UPDATE entities SET state_employer_id = ca_employer_account WHERE state_employer_id IS NULL AND ca_employer_account IS NOT NULL;
ALTER TABLE entities ADD CONSTRAINT entities_state_employer_id_check
  CHECK (state_employer_id IS NULL OR state_employer_id ~ '^[0-9A-Z]{4,15}$');

-- Rates the state assigned this employer, by tax code: { "CA_UI": "0.062" }.
ALTER TABLE entities ADD COLUMN state_tax_rates jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(state_tax_rates) = 'object');
UPDATE entities SET state_tax_rates = jsonb_build_object('CA_UI', (ca_ui_rate::numeric)::text) WHERE ca_ui_rate IS NOT NULL;

-- An employee's withholding certificate for a state other than California
-- (Arizona A-4: the percentage chosen); California's DE 4 stays in de4.
ALTER TABLE employees ADD COLUMN state_withholding jsonb CHECK (state_withholding IS NULL OR jsonb_typeof(state_withholding) = 'object');

-- Deposit kinds come from the rule packs: federal_941, federal_940 and
-- <state>_<what>, like ca_pit_sdi or tx_ui.
ALTER TABLE tax_deposit_payments DROP CONSTRAINT IF EXISTS tax_deposit_payments_kind_check;
ALTER TABLE tax_deposit_payments ADD CONSTRAINT tax_deposit_payments_kind_check
  CHECK (kind IN ('federal_941', 'federal_940') OR kind ~ '^[a-z]{2}_[a-z0-9_]{2,20}$');
