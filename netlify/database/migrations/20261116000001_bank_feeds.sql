-- Automatic bank feeds (Plaid). One row per bank account linked to a feed.
-- The access token is sealed with PII_KEY like other secrets; it is never
-- returned by the API. A removed feed keeps its row for the audit trail.

CREATE TABLE bank_feeds (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  entity_id            uuid NOT NULL,
  bank_account_id      uuid NOT NULL,
  provider             text NOT NULL CHECK (provider IN ('plaid')),
  item_id              text NOT NULL,
  provider_account_id  text NOT NULL,
  access_token_sealed  text NOT NULL,
  institution          text,
  account_name         text,
  account_mask         text CHECK (account_mask IS NULL OR length(account_mask) <= 8),
  sync_cursor          text,
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_login', 'error', 'removed')),
  last_synced_at       timestamptz,
  last_error           text,
  created_by           text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  removed_at           timestamptz,
  CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, bank_account_id) REFERENCES accounts(org_id, entity_id, id)
);
-- One live feed per bank account.
CREATE UNIQUE INDEX bank_feeds_one_live ON bank_feeds (bank_account_id) WHERE status <> 'removed';

ALTER TABLE bank_feeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON bank_feeds TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON bank_feeds TO altqbo_app;
