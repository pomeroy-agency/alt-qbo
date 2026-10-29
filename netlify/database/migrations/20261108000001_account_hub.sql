-- The Pomeroy account hub (account.pomeroyagency.com) keeps one list of what
-- each business has paid for, across TrailBook, MilePost and the agency's
-- own offers. TrailBook stays its own billing engine and tells the hub its
-- status: on every billing change, once a day for changes that happen by
-- date (a trial or grace period running out), and on request.
--
-- 1. A complimentary period on a subscription. The hub sets it: dated (The
--    Install, 12 months) or open-ended (the agency plans, until the hub ends
--    it). While it lasts nothing is charged, people paid included, and
--    everything on its plan is open. It runs as a trial: when it ends the
--    organisation is billed like any trial that ended: charged the next day if
--    a card is on file, otherwise read-only until one is added.
--
-- 2. The last status the hub accepted for each organisation, so only real
--    changes are sent. Like subscriptions, these rows sit outside the tenant
--    boundary and only the system connection touches them.

ALTER TABLE subscriptions
  -- The last day it covers; empty for an open-ended one. Kept after it ends.
  ADD COLUMN comp_until   date,
  -- Set while a complimentary period is (or was last) on this subscription.
  ADD COLUMN comp_reason  text CHECK (comp_reason IS NULL OR length(comp_reason) BETWEEN 1 AND 200),
  ADD COLUMN comp_set_at  timestamptz,
  ADD CONSTRAINT subscriptions_comp_reason CHECK (comp_until IS NULL OR comp_reason IS NOT NULL);

CREATE TABLE hub_pushes (
  org_id         uuid PRIMARY KEY REFERENCES organizations(id),
  -- SHA-256 of the last status the hub accepted; empty until one is.
  payload_hash   text NOT NULL DEFAULT '',
  pushed_at      timestamptz,
  last_error     text,
  last_error_at  timestamptz
);
