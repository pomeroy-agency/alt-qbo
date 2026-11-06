-- Moving from QuickBooks Online or Xero: how each account in the old chart
-- maps to an account here, so the trial balance and later imports land on
-- the same accounts. One row per source account; never deleted.

CREATE TABLE migration_account_map (
  org_id       uuid NOT NULL,
  entity_id    uuid NOT NULL,
  source       text NOT NULL CHECK (source IN ('qbo', 'xero')),
  -- Lowercased account name (and code, when the old chart had one).
  source_key   text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 300),
  source_name  text NOT NULL,
  source_type  text,
  account_id   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, source, source_key),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, account_id) REFERENCES accounts(org_id, entity_id, id)
);

ALTER TABLE migration_account_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON migration_account_map TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT ON migration_account_map TO altqbo_app;
