-- Two-factor sign-in with an authenticator app, and recovery codes.
--
-- The authenticator secret is sealed by the application with PII_KEY before
-- it is stored, so a copy of the database alone can't produce codes. A
-- sign-in that passed the password waits on a short-lived challenge; only a
-- hash of its ticket is kept. Like users and sessions, these rows sit
-- outside the tenant boundary and only the system connection touches them.

ALTER TABLE users
  ADD COLUMN totp_secret        text,
  -- A secret being set up, until the first code from it is entered.
  ADD COLUMN totp_pending       text,
  ADD COLUMN totp_enabled_at    timestamptz,
  -- The last time step accepted, so a code can't be used twice.
  ADD COLUMN totp_last_counter  bigint,
  ADD CONSTRAINT users_totp_complete CHECK ((totp_secret IS NULL) = (totp_enabled_at IS NULL));

CREATE TABLE mfa_challenges (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  used_at     timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX mfa_challenges_user ON mfa_challenges (user_id, created_at);

-- Each recovery code works once. Making new codes retires the old ones; none is deleted.
CREATE TABLE mfa_recovery_codes (
  code_hash   text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  retired_at  timestamptz
);
CREATE INDEX mfa_recovery_codes_user ON mfa_recovery_codes (user_id);

-- An organisation can require everyone in it to use two-factor sign-in.
ALTER TABLE organizations ADD COLUMN require_mfa boolean NOT NULL DEFAULT false;
