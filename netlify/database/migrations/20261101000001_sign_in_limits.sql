-- Failed password sign-ins, so guessing at one account's password is
-- slowed down: after too many misses in a short window, that email is
-- refused for a while. Kept outside the tenant boundary, like sessions;
-- rows older than a day are cleared as new ones arrive.
CREATE TABLE sign_in_failures (
  email      text NOT NULL,
  failed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sign_in_failures_email ON sign_in_failures (email, failed_at);
