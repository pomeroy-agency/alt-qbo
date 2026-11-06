-- Getting paid: estimates, recurring invoices and bills, emailed invoices
-- with a view link, and automatic overdue reminders.
--
--   * An estimate is a quote, not a posting: it never touches the books. When
--     the customer accepts, it becomes an ordinary invoice (taxed on the
--     invoice date) and points at it.
--   * A recurring template issues an invoice or records a bill on each date
--     in its schedule. The daily job uses an idempotency key per template and
--     date, so a rerun never issues twice.
--   * Every email sent to a customer is logged. Reminders are logged by stage,
--     and the unique index stops a stage from going out twice.
--   * A view link is a random token; only its hash is stored.

ALTER TABLE entities
  ADD COLUMN next_estimate_number bigint NOT NULL DEFAULT 1001,
  -- Off until the business turns it on: customers shouldn't get emails nobody chose to send.
  ADD COLUMN invoice_reminders    boolean NOT NULL DEFAULT false,
  -- Where customers' replies go. Blank means the organisation's first owner.
  ADD COLUMN invoice_reply_to     text CHECK (invoice_reply_to IS NULL OR invoice_reply_to LIKE '%_@_%');

-- -------------------------------------------------------------- estimates

CREATE TABLE estimates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  entity_id       uuid NOT NULL,
  number          text NOT NULL,
  contact_id      uuid NOT NULL,
  issue_date      date NOT NULL,
  expiry_date     date NOT NULL,
  memo            text NOT NULL DEFAULT '',
  currency        currency_code NOT NULL,
  -- The lines as entered (product, description, quantity, price, kind of sale), and as priced.
  lines           jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 200),
  subtotal_minor  money_minor NOT NULL CHECK (subtotal_minor >= 0),
  -- Sales tax as it would be on the estimate date; the invoice works it out again on its own date.
  tax_minor       money_minor NOT NULL CHECK (tax_minor >= 0),
  total_minor     money_minor NOT NULL CHECK (total_minor > 0),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined')),
  invoice_id      uuid,
  decided_at      timestamptz,
  decided_by      text,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (expiry_date >= issue_date),
  CHECK (total_minor = subtotal_minor + tax_minor),
  CHECK ((status = 'accepted') = (invoice_id IS NOT NULL)),
  CHECK ((status = 'open') = (decided_at IS NULL)),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, contact_id) REFERENCES contacts(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, invoice_id) REFERENCES documents(org_id, entity_id, id),
  UNIQUE (entity_id, number),
  UNIQUE (invoice_id),
  UNIQUE (org_id, entity_id, id)
);

-- Only the decision changes, once.
CREATE OR REPLACE FUNCTION estimates_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fixed text[] := ARRAY['status', 'invoice_id', 'decided_at', 'decided_by'];
BEGIN
  IF (to_jsonb(NEW) - fixed) IS DISTINCT FROM (to_jsonb(OLD) - fixed) THEN
    RAISE EXCEPTION 'IMMUTABLE: an estimate cannot be edited; decline it and make a new one' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'INVALID: estimate % was already %', OLD.number, OLD.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER estimates_guard_update BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION estimates_guard_update();
CREATE TRIGGER estimates_no_delete BEFORE DELETE ON estimates
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- -------------------------------------------------------------- recurring

CREATE TABLE recurring_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  entity_id       uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('invoice', 'bill')),
  contact_id      uuid NOT NULL,
  lines           jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 200),
  memo            text NOT NULL DEFAULT '',
  reference       text,
  -- Days from the issue date to the due date.
  due_days        integer NOT NULL DEFAULT 30 CHECK (due_days BETWEEN 0 AND 365),
  frequency       text NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  -- The day of the month the schedule keeps to (31 means the last day in short months).
  anchor_day      integer NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  next_date       date NOT NULL,
  end_date        date,
  -- Invoices: email each one to the customer when it's issued.
  email           boolean NOT NULL DEFAULT false,
  -- Bills: add the use tax the vendor didn't charge.
  use_tax         boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  issued_count    integer NOT NULL DEFAULT 0,
  last_document_id uuid,
  last_error      text,
  last_error_at   timestamptz,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  stopped_by      text,
  stopped_at      timestamptz,
  CHECK (kind = 'invoice' OR NOT email),
  CHECK (kind = 'bill' OR NOT use_tax),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, contact_id) REFERENCES contacts(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, last_document_id) REFERENCES documents(org_id, entity_id, id)
);
CREATE INDEX recurring_due ON recurring_templates (next_date) WHERE active;

CREATE TRIGGER recurring_templates_no_delete BEFORE DELETE ON recurring_templates
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ----------------------------------------------------------------- emails

CREATE TABLE customer_emails (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  entity_id    uuid NOT NULL,
  document_id  uuid,
  estimate_id  uuid,
  kind         text NOT NULL CHECK (kind IN ('invoice', 'estimate', 'reminder')),
  -- Reminders: 'due-3' three days before the due date, 'over-7' seven days after, and so on.
  stage        text,
  sent_to      text NOT NULL,
  sent_by      text NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((document_id IS NULL) <> (estimate_id IS NULL)),
  CHECK ((kind = 'reminder') = (stage IS NOT NULL)),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, document_id) REFERENCES documents(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, estimate_id) REFERENCES estimates(org_id, entity_id, id)
);
CREATE INDEX customer_emails_doc ON customer_emails (document_id);
CREATE INDEX customer_emails_estimate ON customer_emails (estimate_id);
CREATE UNIQUE INDEX customer_emails_one_reminder ON customer_emails (document_id, stage) WHERE kind = 'reminder';

CREATE TRIGGER customer_emails_immutable BEFORE UPDATE OR DELETE ON customer_emails
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- A customer's link to view an invoice or estimate without signing in.
CREATE TABLE view_links (
  token_hash   text PRIMARY KEY,
  org_id       uuid NOT NULL,
  entity_id    uuid NOT NULL,
  document_id  uuid,
  estimate_id  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((document_id IS NULL) <> (estimate_id IS NULL)),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, document_id) REFERENCES documents(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, estimate_id) REFERENCES estimates(org_id, entity_id, id)
);

-- ---------------------------------------------------- row-level security

ALTER TABLE estimates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_emails     ENABLE ROW LEVEL SECURITY;
ALTER TABLE view_links          ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant ON estimates           TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON recurring_templates TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON customer_emails     TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON view_links          TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());

GRANT SELECT, INSERT, UPDATE ON estimates, recurring_templates TO altqbo_app;
GRANT SELECT, INSERT ON customer_emails, view_links TO altqbo_app;
