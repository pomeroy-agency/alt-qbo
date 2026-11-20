-- A card at the start of the free trial (Greg, 2026-11-20).
--
--   * Organisations created by signing up from now on add a card before
--     they reach their books. The 30-day trial starts when the card is
--     saved, nothing is charged during it, and the plan they chose is
--     charged the day after it ends unless they cancel.
--   * Organisations that signed up before this keep the trial they had.
--   * Three days before a trial ends, the owners get an email with the
--     amount, the date and a link that cancels the trial in one click,
--     without signing in. Only a hash of each link's token is kept.

ALTER TABLE subscriptions ADD COLUMN card_required boolean NOT NULL DEFAULT false;
-- When the card was saved and the trial began, for an organisation that had to add one.
ALTER TABLE subscriptions ADD COLUMN trial_started_at timestamptz;
-- The trial end the three-day reminder was sent for, so it goes once per trial.
ALTER TABLE subscriptions ADD COLUMN trial_reminder_for date;

CREATE TABLE billing_cancel_links (
  token_hash  text PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES subscriptions(org_id) ON DELETE CASCADE,
  -- The link works through this day (Pacific), the last day of the trial.
  valid_until date NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_cancel_links_org ON billing_cancel_links (org_id);
