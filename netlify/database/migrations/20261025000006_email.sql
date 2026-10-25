-- Email sign-in, password reset and email confirmation.
--
-- Each emailed link carries a random token; only its SHA-256 hash is stored.
-- A token works once, for one purpose, until it expires. Like users and
-- sessions, these rows sit outside the tenant boundary and only the system
-- connection touches them.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

CREATE TABLE email_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  purpose     text NOT NULL CHECK (purpose IN ('sign_in', 'reset', 'verify')),
  -- The address the link was sent to; a link stops working if the account's email changes.
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX email_tokens_recent ON email_tokens (user_id, purpose, created_at);

-- A token is spent once and otherwise never changes or disappears, so the
-- record of which links were sent and used stays intact.
CREATE FUNCTION email_tokens_use_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE: email tokens are kept' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID: this link has already been used' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.used_at IS NULL OR (NEW.token_hash, NEW.user_id, NEW.purpose, NEW.email, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM (OLD.token_hash, OLD.user_id, OLD.purpose, OLD.email, OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'IMMUTABLE: only using a link can change it' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.expires_at <= now() THEN
    RAISE EXCEPTION 'INVALID: this link has expired' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER email_tokens_use_once BEFORE UPDATE OR DELETE ON email_tokens
  FOR EACH ROW EXECUTE FUNCTION email_tokens_use_once();
