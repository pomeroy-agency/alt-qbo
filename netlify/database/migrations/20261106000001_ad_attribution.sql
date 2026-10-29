-- Where a new organisation's sign-up came from, so its sign-up and first
-- payment can be reported to Google and Meta once each (src/app/ad-events.ts).
-- Only written when the ad keys are set and the person didn't opt out or send
-- Global Privacy Control. The IP, browser and cookie IDs are cleared once the
-- first payment is reported, or after 120 days without one. Kept outside the
-- tenant boundary, like sessions: only the system connection touches it.
CREATE TABLE ad_attribution (
  org_id           uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ga_client_id     text,
  ga_session_id    text,
  fbp              text,
  fbc              text,
  gclid            text,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_term         text,
  utm_content      text,
  ip               text,
  user_agent       text,
  page_url         text,
  signup_sent_at   timestamptz,
  purchase_sent_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
