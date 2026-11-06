-- Signing in to TrailBook with a Pomeroy Account (phase 6).
--
-- 1. Each TrailBook person can be connected to one Pomeroy Account (the hub's
--    user id), and each Pomeroy Account to one TrailBook person.
--
-- 2. A sign-in started here waits for the hub's answer: the state sent to the
--    hub (hashed), the PKCE verifier, and, when a signed-in person is
--    connecting their account, who they are. Each works once, for 10 minutes.
--
-- 3. Connecting by email: someone who signs in with a Pomeroy Account that
--    isn't connected yet gets a one-time link at their TrailBook address.
--    The link carries the hub user id it will connect.

ALTER TABLE users
  ADD COLUMN hub_user_id    text UNIQUE CHECK (hub_user_id IS NULL OR length(hub_user_id) BETWEEN 1 AND 100),
  ADD COLUMN hub_linked_at  timestamptz,
  ADD CONSTRAINT users_hub_link_complete CHECK ((hub_user_id IS NULL) = (hub_linked_at IS NULL));

CREATE TABLE hub_sign_in_requests (
  state_hash     text PRIMARY KEY,
  code_verifier  text NOT NULL,
  link_user_id   uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  CHECK (expires_at > created_at)
);

ALTER TABLE email_tokens
  ADD COLUMN hub_user_id text CHECK (hub_user_id IS NULL OR length(hub_user_id) BETWEEN 1 AND 100),
  DROP CONSTRAINT email_tokens_purpose_check,
  ADD CONSTRAINT email_tokens_purpose_check CHECK (purpose IN ('sign_in', 'reset', 'verify', 'hub_link')),
  ADD CONSTRAINT email_tokens_hub_link CHECK ((purpose = 'hub_link') = (hub_user_id IS NOT NULL));
