-- Sign-up requests for TrailBook News. Brevo sends each one a confirmation
-- link (double opt-in) and adds the person to the list only when they click
-- it. To keep the form from being used to flood someone's inbox, an address
-- gets at most one confirmation email an hour; only its SHA-256 hash is kept.
CREATE TABLE newsletter_signups (
  email_hash    text NOT NULL,
  source        text NOT NULL CHECK (source IN ('website', 'app_signup')),
  requested_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX newsletter_signups_recent ON newsletter_signups (email_hash, requested_at DESC);
