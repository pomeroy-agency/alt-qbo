-- Direct deposit: the bank file a business uploads to its own bank to pay
-- employees. Alt-QBO builds the file; the bank moves the money.
--
--   * Each employee may have one checking or savings account. The account
--     number is sealed like a Social Security number (AES-256-GCM, key held
--     outside the database); only its last four digits are readable here.
--   * The business's bank details are what its bank gives it for ACH
--     origination: routing number, company ID and so on. Its own account
--     number is needed only when the bank wants a balanced file.

ALTER TABLE employees
  ADD COLUMN dd_routing        text CHECK (dd_routing IS NULL OR dd_routing ~ '^\d{9}$'),
  ADD COLUMN dd_account_type   text CHECK (dd_account_type IS NULL OR dd_account_type IN ('checking', 'savings')),
  ADD COLUMN dd_account_last4  text CHECK (dd_account_last4 IS NULL OR dd_account_last4 ~ '^[0-9A-Z]{4}$'),
  ADD COLUMN dd_account_sealed text,
  ADD CONSTRAINT employees_dd_complete CHECK (
    (dd_routing IS NULL AND dd_account_type IS NULL AND dd_account_last4 IS NULL AND dd_account_sealed IS NULL)
    OR (dd_routing IS NOT NULL AND dd_account_type IS NOT NULL AND dd_account_last4 IS NOT NULL AND dd_account_sealed IS NOT NULL)
  );

CREATE TABLE direct_deposit_settings (
  entity_id              uuid PRIMARY KEY,
  org_id                 uuid NOT NULL,
  odfi_routing           text NOT NULL CHECK (odfi_routing ~ '^\d{9}$'),
  immediate_destination  text NOT NULL CHECK (immediate_destination ~ '^\d{9}$'),
  destination_name       text NOT NULL CHECK (length(destination_name) BETWEEN 1 AND 23),
  immediate_origin       text NOT NULL CHECK (immediate_origin ~ '^[0-9A-Z]{1,10}$'),
  company_id             text NOT NULL CHECK (company_id ~ '^[0-9A-Z]{1,10}$'),
  company_name           text NOT NULL CHECK (length(company_name) BETWEEN 1 AND 16),
  balanced               boolean NOT NULL DEFAULT false,
  account_type           text CHECK (account_type IS NULL OR account_type IN ('checking', 'savings')),
  account_last4          text CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9A-Z]{4}$'),
  account_sealed         text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((account_last4 IS NULL) = (account_sealed IS NULL) AND (account_last4 IS NULL) = (account_type IS NULL)),
  CHECK (NOT balanced OR account_sealed IS NOT NULL),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);

ALTER TABLE direct_deposit_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON direct_deposit_settings TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON direct_deposit_settings TO altqbo_app;
