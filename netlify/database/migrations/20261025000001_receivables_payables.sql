-- Customers, vendors, invoices, bills and their payments.
--
-- Rules the database enforces on its own, whatever the application does:
--   * line amounts are quantity x unit price and line tax is the document's
--     rate applied to taxable lines, rounded half-up to the cent;
--   * a document's totals equal the sum of its lines, and it cannot commit
--     without a posted journal entry whose receivable (or payable) line
--     equals its total;
--   * an issued document's lines, totals, customer and dates never change;
--     the only change allowed is a void, which must point at a reversal;
--   * payments can never exceed the amount still due, never land on a void
--     document, and each one is backed by its own posted entry;
--   * invoice and bill numbers are gapless per entity.

ALTER TABLE entities
  ADD COLUMN next_invoice_number bigint NOT NULL DEFAULT 1001,
  ADD COLUMN next_bill_number    bigint NOT NULL DEFAULT 1;

-- --------------------------------------------------------------- contacts

CREATE TABLE contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  entity_id   uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('customer', 'vendor', 'both')),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  email       text CHECK (email IS NULL OR email LIKE '%_@_%'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  UNIQUE (org_id, entity_id, id)
);
CREATE UNIQUE INDEX contacts_name ON contacts (entity_id, lower(name));

-- -------------------------------------------------------------- documents

CREATE TABLE documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  entity_id       uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('invoice', 'bill')),
  number          text NOT NULL,
  -- The vendor's own invoice number, for bills.
  reference       text,
  contact_id      uuid NOT NULL,
  issue_date      date NOT NULL,
  due_date        date NOT NULL,
  memo            text NOT NULL DEFAULT '',
  currency        currency_code NOT NULL,
  -- Rate in basis points (725 = 7.25%). Entered by the user; not looked up.
  tax_rate_bps    integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  subtotal_minor  money_minor NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor       money_minor NOT NULL CHECK (tax_minor >= 0),
  total_minor     money_minor NOT NULL CHECK (total_minor > 0),
  status          text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  entry_id        uuid,
  void_entry_id   uuid,
  void_date       date,
  void_reason     text,
  -- A retried request with the same key gets the original document back.
  idempotency_key text NOT NULL,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date >= issue_date),
  CHECK (total_minor = subtotal_minor + tax_minor),
  -- Tax on purchases is part of the expense here; only invoices charge it.
  CHECK (kind = 'invoice' OR (tax_rate_bps = 0 AND tax_minor = 0)),
  CHECK ((status = 'void') = (void_entry_id IS NOT NULL AND void_date IS NOT NULL AND void_reason IS NOT NULL)),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, contact_id) REFERENCES contacts(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, entry_id) REFERENCES journal_entries(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, void_entry_id) REFERENCES journal_entries(org_id, entity_id, id),
  UNIQUE (entity_id, kind, number),
  UNIQUE (entity_id, idempotency_key),
  UNIQUE (entry_id),
  UNIQUE (org_id, entity_id, id)
);
CREATE INDEX documents_open ON documents (entity_id, kind, due_date) WHERE status = 'issued';

CREATE TABLE document_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  entity_id         uuid NOT NULL,
  document_id       uuid NOT NULL,
  line_no           integer NOT NULL CHECK (line_no > 0),
  description       text NOT NULL DEFAULT '',
  account_id        uuid NOT NULL,
  quantity          numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit_price_minor  money_minor NOT NULL CHECK (unit_price_minor >= 0),
  amount_minor      money_minor NOT NULL,
  taxable           boolean NOT NULL DEFAULT false,
  tax_rate_bps      integer NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_minor         money_minor NOT NULL,
  -- round() on numeric rounds half away from zero, which is half-up for these non-negative values.
  CHECK (amount_minor = round(quantity * unit_price_minor)),
  CHECK (tax_minor = CASE WHEN taxable THEN round(amount_minor * tax_rate_bps / 10000.0) ELSE 0 END),
  FOREIGN KEY (org_id, entity_id, document_id) REFERENCES documents(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, account_id) REFERENCES accounts(org_id, entity_id, id),
  UNIQUE (document_id, line_no)
);

CREATE TABLE document_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  entity_id        uuid NOT NULL,
  document_id      uuid NOT NULL,
  payment_date     date NOT NULL,
  amount_minor     money_minor NOT NULL CHECK (amount_minor > 0),
  bank_account_id  uuid NOT NULL,
  entry_id         uuid NOT NULL UNIQUE,
  idempotency_key  text NOT NULL,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id, document_id) REFERENCES documents(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, bank_account_id) REFERENCES accounts(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, entry_id) REFERENCES journal_entries(org_id, entity_id, id),
  UNIQUE (entity_id, idempotency_key)
);
CREATE INDEX document_payments_doc ON document_payments (document_id);

-- ----------------------------------------------------------------- checks

-- A new document must name a contact of the right kind.
CREATE OR REPLACE FUNCTION documents_check_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ck text;
BEGIN
  SELECT kind INTO ck FROM contacts WHERE id = NEW.contact_id;
  IF NEW.kind = 'invoice' AND ck = 'vendor' THEN
    RAISE EXCEPTION 'INVALID: an invoice needs a customer, not a vendor' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.kind = 'bill' AND ck = 'customer' THEN
    RAISE EXCEPTION 'INVALID: a bill needs a vendor, not a customer' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> 'issued' OR NEW.void_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID: a document starts out issued' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_check_insert BEFORE INSERT ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_check_insert();

-- After issue, the only changes are linking the posting entry once and voiding.
CREATE OR REPLACE FUNCTION documents_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fixed text[] := ARRAY['entry_id', 'status', 'void_entry_id', 'void_date', 'void_reason'];
BEGIN
  IF (to_jsonb(NEW) - fixed) IS DISTINCT FROM (to_jsonb(OLD) - fixed) THEN
    RAISE EXCEPTION 'IMMUTABLE: an issued % cannot be edited; void it and issue a new one', OLD.kind
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.entry_id IS NOT NULL AND NEW.entry_id IS DISTINCT FROM OLD.entry_id THEN
    RAISE EXCEPTION 'IMMUTABLE: a document''s posting entry cannot change' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'void' AND (NEW.status, NEW.void_entry_id, NEW.void_date, NEW.void_reason)
       IS DISTINCT FROM (OLD.status, OLD.void_entry_id, OLD.void_date, OLD.void_reason) THEN
    RAISE EXCEPTION 'IMMUTABLE: a void document stays void' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'issued' AND NEW.status = 'void' THEN
    IF EXISTS (SELECT 1 FROM document_payments WHERE document_id = OLD.id) THEN
      RAISE EXCEPTION 'INVALID: a % with payments cannot be voided', OLD.kind USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM journal_entries
                   WHERE id = NEW.void_entry_id AND reverses_entry_id = OLD.entry_id) THEN
      RAISE EXCEPTION 'INVALID: a void must point at the reversal of the document''s entry'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_guard_update BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_guard_update();
CREATE TRIGGER documents_no_delete BEFORE DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER documents_no_truncate BEFORE TRUNCATE ON documents
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- Lines go in only with their document, and must use a sensible account:
-- invoices credit revenue (or deferred revenue), bills debit expenses or assets.
CREATE OR REPLACE FUNCTION document_lines_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d documents%ROWTYPE;
  a accounts%ROWTYPE;
BEGIN
  SELECT * INTO d FROM documents WHERE id = NEW.document_id;
  IF d.entry_id IS NOT NULL
     OR d.xmin::text <> (pg_current_xact_id()::text::bigint % 4294967296)::text THEN
    RAISE EXCEPTION 'IMMUTABLE: lines can only be added when the document is issued' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.tax_rate_bps <> d.tax_rate_bps THEN
    RAISE EXCEPTION 'INVALID: line tax rate must match the document' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO a FROM accounts WHERE id = NEW.account_id;
  IF NOT a.is_active THEN
    RAISE EXCEPTION 'INVALID: account % is inactive', a.code USING ERRCODE = 'P0001';
  END IF;
  IF a.system_key IN ('accounts_receivable', 'accounts_payable') OR a.subtype = 'bank' THEN
    RAISE EXCEPTION 'INVALID: account % cannot be used on a document line', a.code USING ERRCODE = 'P0001';
  END IF;
  IF d.kind = 'invoice' AND a.type NOT IN ('revenue', 'liability') THEN
    RAISE EXCEPTION 'INVALID: invoice lines need a revenue account; % is %', a.code, a.type USING ERRCODE = 'P0001';
  END IF;
  IF d.kind = 'bill' AND a.type NOT IN ('expense', 'asset') THEN
    RAISE EXCEPTION 'INVALID: bill lines need an expense or asset account; % is %', a.code, a.type USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_lines_check BEFORE INSERT ON document_lines
  FOR EACH ROW EXECUTE FUNCTION document_lines_check();
CREATE TRIGGER document_lines_immutable BEFORE UPDATE OR DELETE ON document_lines
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER document_lines_no_truncate BEFORE TRUNCATE ON document_lines
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- At commit: totals match the lines, and the document is in the books.
CREATE OR REPLACE FUNCTION document_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  doc_id uuid := CASE WHEN TG_TABLE_NAME = 'documents'
                      THEN (to_jsonb(NEW) ->> 'id')::uuid
                      ELSE (to_jsonb(NEW) ->> 'document_id')::uuid END;
  d documents%ROWTYPE;
  n integer;
  sub bigint;
  tax bigint;
  control_key text;
  control bigint;
BEGIN
  SELECT * INTO d FROM documents WHERE id = doc_id;
  SELECT count(*), coalesce(sum(amount_minor), 0), coalesce(sum(tax_minor), 0)
    INTO n, sub, tax FROM document_lines WHERE document_id = doc_id;
  IF n = 0 THEN
    RAISE EXCEPTION 'INVALID: % % has no lines', d.kind, d.number USING ERRCODE = 'P0001';
  END IF;
  IF sub <> d.subtotal_minor OR tax <> d.tax_minor THEN
    RAISE EXCEPTION 'INVALID: % % totals do not match its lines', d.kind, d.number USING ERRCODE = 'P0001';
  END IF;
  IF d.entry_id IS NULL THEN
    RAISE EXCEPTION 'INVALID: % % was not posted to the books', d.kind, d.number USING ERRCODE = 'P0001';
  END IF;
  control_key := CASE d.kind WHEN 'invoice' THEN 'accounts_receivable' ELSE 'accounts_payable' END;
  SELECT coalesce(sum(CASE d.kind WHEN 'invoice' THEN l.debit_minor - l.credit_minor
                                  ELSE l.credit_minor - l.debit_minor END), 0)
    INTO control
    FROM journal_entries e
    JOIN journal_lines l ON l.entry_id = e.id
    JOIN accounts a ON a.id = l.account_id
   WHERE e.id = d.entry_id AND e.source_type = d.kind AND e.source_id = d.id::text
     AND a.system_key = control_key;
  IF control <> d.total_minor THEN
    RAISE EXCEPTION 'INVALID: % % entry does not carry its total to %', d.kind, d.number, control_key
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER documents_complete AFTER INSERT ON documents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION document_complete();
CREATE CONSTRAINT TRIGGER document_lines_complete AFTER INSERT ON document_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION document_complete();

-- A payment fits within what is still due and is backed by its own entry.
CREATE OR REPLACE FUNCTION document_payments_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d documents%ROWTYPE;
  a accounts%ROWTYPE;
  paid bigint;
  control_key text;
  moved bigint;
BEGIN
  -- Lock the document so two payments at once can't both pass the check.
  SELECT * INTO d FROM documents WHERE id = NEW.document_id FOR UPDATE;
  IF d.status <> 'issued' THEN
    RAISE EXCEPTION 'INVALID: % % is void', d.kind, d.number USING ERRCODE = 'P0001';
  END IF;
  IF NEW.payment_date < d.issue_date THEN
    RAISE EXCEPTION 'INVALID: payment date is before the % date', d.kind USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO paid FROM document_payments WHERE document_id = d.id;
  IF paid + NEW.amount_minor > d.total_minor THEN
    RAISE EXCEPTION 'OVERPAID: % % has % minor units due; payment of % is too much',
      d.kind, d.number, d.total_minor - paid, NEW.amount_minor USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO a FROM accounts WHERE id = NEW.bank_account_id;
  IF a.subtype <> 'bank' THEN
    RAISE EXCEPTION 'INVALID: payments go through a bank account; % is not one', a.code USING ERRCODE = 'P0001';
  END IF;
  control_key := CASE d.kind WHEN 'invoice' THEN 'accounts_receivable' ELSE 'accounts_payable' END;
  SELECT coalesce(sum(CASE d.kind WHEN 'invoice' THEN l.credit_minor - l.debit_minor
                                  ELSE l.debit_minor - l.credit_minor END), 0)
    INTO moved
    FROM journal_entries e
    JOIN journal_lines l ON l.entry_id = e.id
    JOIN accounts x ON x.id = l.account_id
   WHERE e.id = NEW.entry_id AND e.source_type = 'payment' AND e.source_id = NEW.id::text
     AND x.system_key = control_key;
  IF moved <> NEW.amount_minor THEN
    RAISE EXCEPTION 'INVALID: payment entry does not clear % from %', NEW.amount_minor, control_key
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_payments_check BEFORE INSERT ON document_payments
  FOR EACH ROW EXECUTE FUNCTION document_payments_check();
CREATE TRIGGER document_payments_immutable BEFORE UPDATE OR DELETE ON document_payments
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER document_payments_no_truncate BEFORE TRUNCATE ON document_payments
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------- row-level security

ALTER TABLE contacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant ON contacts          TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON documents         TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON document_lines    TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON document_payments TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());

GRANT SELECT, INSERT, UPDATE ON contacts, documents TO altqbo_app;
GRANT SELECT, INSERT ON document_lines, document_payments TO altqbo_app;
