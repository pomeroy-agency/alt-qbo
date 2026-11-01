-- Canadian direct deposit: the CPA 005 file a business uploads to its own
-- bank. TrailBook builds the file; the bank moves the money.
--
--   * A Canadian employee's bank is stored in employees.dd_routing as "0",
--     the three-digit institution number and the five-digit transit number,
--     which is how the CPA 005 format writes it.
--   * The business's details are what its bank gives it for payroll files:
--     an originator ID and processing centre, plus its own account for
--     returned payments (sealed like an employee's account).
--   * Each file gets a new file creation number, which banks use to refuse
--     duplicates.

CREATE TABLE ca_direct_deposit_settings (
  entity_id              uuid PRIMARY KEY,
  org_id                 uuid NOT NULL,
  originator_id          text NOT NULL CHECK (originator_id ~ '^[0-9A-Z]{1,10}$'),
  data_centre            text NOT NULL CHECK (data_centre ~ '^\d{5}$'),
  short_name             text NOT NULL CHECK (length(short_name) BETWEEN 1 AND 15),
  long_name              text NOT NULL CHECK (length(long_name) BETWEEN 1 AND 30),
  return_institution     text NOT NULL CHECK (return_institution ~ '^\d{3}$'),
  return_transit         text NOT NULL CHECK (return_transit ~ '^\d{5}$'),
  return_account_last4   text NOT NULL CHECK (return_account_last4 ~ '^\d{4}$'),
  return_account_sealed  text NOT NULL,
  last_file_number       integer NOT NULL DEFAULT 0 CHECK (last_file_number BETWEEN 0 AND 9999),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);

ALTER TABLE ca_direct_deposit_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON ca_direct_deposit_settings TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON ca_direct_deposit_settings TO altqbo_app;
