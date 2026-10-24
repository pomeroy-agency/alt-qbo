-- Sign-in, organisation membership, and saved pay runs for the web app.
--
-- users, memberships and sessions sit outside the tenant boundary: they are
-- read before an organisation is chosen, so only the system connection
-- touches them. pay_runs belong to a tenant and get row-level security.

-- The connecting role must be able to SET ROLE altqbo_app. A superuser can
-- already; a managed-database owner role needs membership.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    -- PostgreSQL 16+: the role's creator holds ADMIN but not SET; grant SET explicitly.
    IF NOT pg_has_role(current_user, 'altqbo_app', 'SET') THEN
      EXECUTE format('GRANT altqbo_app TO %I WITH SET TRUE, INHERIT FALSE', current_user);
    END IF;
  ELSIF NOT pg_has_role(current_user, 'altqbo_app', 'MEMBER') THEN
    EXECUTE format('GRANT altqbo_app TO %I', current_user);
  END IF;
END
$$;

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE CHECK (email = lower(email) AND email LIKE '%_@_%'),
  name           text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id     uuid NOT NULL REFERENCES users(id),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'bookkeeper', 'approver', 'accountant', 'read_only')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

-- Only a hash of the session token is stored.
CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE pay_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  entity_id    uuid NOT NULL,
  status       text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'posted', 'voided')),
  input        jsonb NOT NULL,
  result       jsonb NOT NULL,
  prepared_by  text NOT NULL,
  approved_by  text,
  entry_id     uuid REFERENCES journal_entries(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);

ALTER TABLE pay_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON pay_runs TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON pay_runs TO altqbo_app;
