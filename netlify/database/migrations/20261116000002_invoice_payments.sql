-- Card and bank payments on invoices through the business's own Stripe
-- account (Stripe Connect Standard). The business connects its account; the
-- customer pays on Stripe's page; the money goes straight to the business's
-- Stripe balance. TrailBook takes no fee and never holds the money.

CREATE TABLE stripe_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  entity_id          uuid NOT NULL,
  stripe_account_id  text NOT NULL CHECK (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  livemode           boolean NOT NULL,
  -- The "Stripe balance" bank account in the books that payments land in.
  bank_account_id    uuid NOT NULL,
  display_name       text,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  connected_by       text NOT NULL,
  connected_at       timestamptz NOT NULL DEFAULT now(),
  removed_at         timestamptz,
  CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, bank_account_id) REFERENCES accounts(org_id, entity_id, id)
);
-- One live connection per business.
CREATE UNIQUE INDEX stripe_connections_one_live ON stripe_connections (entity_id) WHERE status = 'active';

CREATE TABLE invoice_payment_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  entity_id          uuid NOT NULL,
  document_id        uuid NOT NULL,
  connection_id      uuid NOT NULL REFERENCES stripe_connections(id),
  session_id         text NOT NULL UNIQUE CHECK (session_id ~ '^cs_[A-Za-z0-9_]+$'),
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           char(3) NOT NULL,
  -- open: on Stripe's page; processing: paid by bank debit, not cleared yet;
  -- paid: recorded in the books; needs_review: paid but couldn't be recorded.
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'paid', 'expired', 'needs_review')),
  payment_intent_id  text,
  payment_method     text,
  fee_minor          bigint,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  settled_at         timestamptz,
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, document_id) REFERENCES documents(org_id, entity_id, id)
);
CREATE INDEX invoice_payment_sessions_open ON invoice_payment_sessions (created_at) WHERE status IN ('open', 'processing');
CREATE INDEX invoice_payment_sessions_document ON invoice_payment_sessions (document_id);

ALTER TABLE stripe_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON stripe_connections TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON stripe_connections TO altqbo_app;

ALTER TABLE invoice_payment_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON invoice_payment_sessions TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON invoice_payment_sessions TO altqbo_app;
