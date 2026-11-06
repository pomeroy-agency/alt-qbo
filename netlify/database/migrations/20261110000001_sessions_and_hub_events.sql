-- Sign-in hardening ahead of the Pomeroy account hub, and the hub's
-- entitlements.changed notices.
--
-- 1. Sessions end after 12 hours without use, and 7 days after sign-in at
--    most (expires_at). last_seen_at moves as the session is used.
--
-- 2. mfa_at: when this session passed the second factor. Payroll, bank
--    details and tax filings need it. Sessions already open for someone who
--    had two-factor on before signing in passed it at sign-in.
--
-- 3. The latest entitlements.changed notice from the hub for each
--    organisation: the hub's organisation id and its access version, so an
--    older notice arriving late is ignored.

ALTER TABLE sessions
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN mfa_at       timestamptz;

UPDATE sessions s SET mfa_at = s.created_at
  FROM users u
 WHERE u.id = s.user_id AND u.totp_enabled_at IS NOT NULL AND u.totp_enabled_at <= s.created_at;

ALTER TABLE hub_pushes
  ADD COLUMN hub_org_id      text CHECK (hub_org_id IS NULL OR length(hub_org_id) BETWEEN 1 AND 100),
  ADD COLUMN ent_version     bigint,
  ADD COLUMN ent_changed_at  timestamptz;
