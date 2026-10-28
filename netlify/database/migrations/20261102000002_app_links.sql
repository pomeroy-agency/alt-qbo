-- Links to other apps, starting with MilePost (Greg's CRM).
--
-- Two directions, each scoped to one business (entity):
--
-- 1. MilePost signs in to TrailBook with OAuth 2.0 (authorization code). An
--    owner or admin approves it for one business; MilePost then gets an
--    access token (an hour) and a refresh token (rotated on every use). Only
--    SHA-256 hashes of codes and tokens are kept. Like sessions, these rows
--    sit outside the tenant boundary, because a token is looked up before
--    anyone knows which organisation it belongs to; only the system
--    connection touches them.
--
-- 2. TrailBook calls MilePost's REST API with a MilePost API key an owner or
--    admin pastes in. The key is sealed by the application with PII_KEY
--    before it is stored, so a copy of the database alone can't use it.
--
-- external_refs remembers which TrailBook customer or invoice belongs to
-- which MilePost contact or deal, so a repeated request finds the same record
-- instead of making a second one.

CREATE TABLE oauth_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           text NOT NULL,
  org_id              uuid NOT NULL,
  entity_id           uuid NOT NULL,
  -- Who approved it. The grant only works while they are still an owner or admin.
  user_id             uuid NOT NULL REFERENCES users(id),
  scopes              text[] NOT NULL,
  -- The authorization code it came from, so a replayed code can revoke it.
  code_hash           text NOT NULL UNIQUE,
  -- Choices the business makes for this app, such as the kind of sale on its invoices.
  settings            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz,
  revoked_at          timestamptz,
  revoked_by          text,
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);
-- One live grant per app per business: approving again replaces the old one.
CREATE UNIQUE INDEX oauth_grants_live ON oauth_grants (entity_id, client_id) WHERE revoked_at IS NULL;

CREATE TABLE oauth_codes (
  code_hash     text PRIMARY KEY,
  client_id     text NOT NULL,
  org_id        uuid NOT NULL,
  entity_id     uuid NOT NULL,
  user_id       uuid NOT NULL REFERENCES users(id),
  redirect_uri  text NOT NULL,
  scopes        text[] NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  CHECK (expires_at > created_at)
);

CREATE TABLE oauth_tokens (
  token_hash  text PRIMARY KEY,
  grant_id    uuid NOT NULL REFERENCES oauth_grants(id),
  kind        text NOT NULL CHECK (kind IN ('access', 'refresh')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  -- A refresh token works once; using a spent one again revokes the grant.
  used_at     timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens (grant_id);

-- MilePost's API key for this business, sealed with PII_KEY.
CREATE TABLE app_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  entity_id       uuid NOT NULL,
  app             text NOT NULL CHECK (app IN ('milepost')),
  api_key_sealed  text NOT NULL,
  key_hint        text NOT NULL,
  account_id      text,
  account_name    text,
  -- Whether the other app says its subscription is active, from the last check.
  active          boolean NOT NULL DEFAULT true,
  checked_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  removed_at      timestamptz,
  removed_by      text,
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);
CREATE UNIQUE INDEX app_links_live ON app_links (entity_id, app) WHERE removed_at IS NULL;

CREATE TABLE external_refs (
  org_id        uuid NOT NULL,
  entity_id     uuid NOT NULL,
  source        text NOT NULL,
  object_type   text NOT NULL CHECK (object_type IN ('contact', 'invoice')),
  object_id     uuid NOT NULL,
  external_ref  text NOT NULL CHECK (length(external_ref) BETWEEN 1 AND 100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, source, object_type, external_ref),
  UNIQUE (entity_id, source, object_type, object_id),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);

ALTER TABLE app_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_refs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON app_links     TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON external_refs TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON app_links TO altqbo_app;
GRANT SELECT, INSERT ON external_refs TO altqbo_app;

-- A phone number on customers and vendors, which MilePost sends with each customer.
ALTER TABLE contacts ADD COLUMN phone text CHECK (phone IS NULL OR length(phone) BETWEEN 3 AND 40);
