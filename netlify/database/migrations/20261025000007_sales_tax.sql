-- Automatic California sales tax.
--
--   * Products and services: each item has a tax category, and the state's
--     rule pack decides whether that category is taxable.
--   * Customers and the business carry addresses, and customers can hold a
--     resale certificate.
--   * The rate is worked out when an invoice is issued (looked up for the
--     delivery address, or zero when exempt) and frozen on the invoice with
--     where it came from, so a later rate change never alters a past invoice.
--   * Rates move from whole basis points to a fraction with five decimals,
--     because California district rates such as 8.625% need three decimals
--     of a percent.

-- ------------------------------------------------------------ addresses

ALTER TABLE entities
  ADD COLUMN address_line1 text,
  ADD COLUMN address_city  text,
  ADD COLUMN address_state text CHECK (address_state IS NULL OR address_state ~ '^[A-Z]{2}$'),
  ADD COLUMN address_zip   text CHECK (address_zip IS NULL OR address_zip ~ '^\d{5}(-\d{4})?$');

ALTER TABLE contacts
  ADD COLUMN address_line1  text,
  ADD COLUMN address_city   text,
  ADD COLUMN address_state  text CHECK (address_state IS NULL OR address_state ~ '^[A-Z]{2}$'),
  ADD COLUMN address_zip    text CHECK (address_zip IS NULL OR address_zip ~ '^\d{5}(-\d{4})?$'),
  -- The customer's California seller's permit number, from the resale certificate they gave.
  ADD COLUMN resale_permit  text CHECK (resale_permit IS NULL OR length(trim(resale_permit)) > 0);

-- ------------------------------------------------- products and services

CREATE TABLE items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  entity_id         uuid NOT NULL,
  name              text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description       text NOT NULL DEFAULT '',
  -- A category in the state's sales-tax rule pack; the pack decides taxability.
  tax_category      text NOT NULL CHECK (tax_category ~ '^[a-z_]+$'),
  unit_price_minor  money_minor NOT NULL CHECK (unit_price_minor >= 0),
  account_id        uuid NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, account_id) REFERENCES accounts(org_id, entity_id, id),
  UNIQUE (org_id, entity_id, id)
);
CREATE UNIQUE INDEX items_name ON items (entity_id, lower(name));

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON items TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON items TO altqbo_app;

CREATE FUNCTION items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE: items are kept so past invoices still name them; deactivate instead' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id AND type IN ('revenue', 'liability')) THEN
    RAISE EXCEPTION 'INVALID: an item needs an income account' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.org_id, NEW.entity_id, NEW.created_at) IS DISTINCT FROM (OLD.org_id, OLD.entity_id, OLD.created_at) THEN
    RAISE EXCEPTION 'IMMUTABLE: an item can''t move to another business' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER items_guard BEFORE INSERT OR UPDATE OR DELETE ON items FOR EACH ROW EXECUTE FUNCTION items_guard();

-- ----------------------------------------------------- frozen tax on documents

ALTER TABLE documents
  ADD COLUMN tax_rate         numeric(6, 5) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 1),
  -- How the rate was decided: no taxable lines, exempt, looked up, or entered by an accountant.
  ADD COLUMN tax_source       text NOT NULL DEFAULT 'none'
    CHECK (tax_source IN ('none', 'user_entered', 'not_taxable', 'resale', 'out_of_state', 'lookup', 'manual')),
  ADD COLUMN tax_jurisdiction text,
  ADD COLUMN tax_address      text,
  ADD COLUMN tax_note         text,
  ADD CHECK (tax_source <> 'manual' OR length(trim(coalesce(tax_note, ''))) > 0),
  ADD CHECK (tax_source <> 'lookup' OR (tax_address IS NOT NULL AND tax_jurisdiction IS NOT NULL));

ALTER TABLE document_lines
  ADD COLUMN tax_rate     numeric(6, 5) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 1),
  ADD COLUMN tax_category text CHECK (tax_category IS NULL OR tax_category ~ '^[a-z_]+$'),
  ADD COLUMN item_id      uuid,
  ADD FOREIGN KEY (org_id, entity_id, item_id) REFERENCES items(org_id, entity_id, id);

-- Carry existing rates across. This is a change of unit, not of any figure,
-- so the immutability triggers are paused for it alone.
ALTER TABLE documents DISABLE TRIGGER USER;
ALTER TABLE document_lines DISABLE TRIGGER USER;
UPDATE documents SET tax_rate = tax_rate_bps / 10000.0, tax_source = CASE WHEN tax_rate_bps > 0 THEN 'user_entered' ELSE 'none' END;
UPDATE document_lines SET tax_rate = tax_rate_bps / 10000.0;
ALTER TABLE documents ENABLE TRIGGER USER;
ALTER TABLE document_lines ENABLE TRIGGER USER;

ALTER TABLE document_lines DROP CONSTRAINT document_lines_check1;
ALTER TABLE documents DROP CONSTRAINT documents_check2;
ALTER TABLE documents DROP COLUMN tax_rate_bps;
ALTER TABLE document_lines DROP COLUMN tax_rate_bps;
ALTER TABLE document_lines
  ADD CHECK (tax_minor = CASE WHEN taxable THEN round(amount_minor * tax_rate) ELSE 0 END);
ALTER TABLE documents
  -- Tax on purchases is part of the expense here; only invoices charge it.
  ADD CHECK (kind = 'invoice' OR (tax_rate = 0 AND tax_minor = 0 AND tax_source = 'none'));

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
  IF NEW.tax_rate <> d.tax_rate THEN
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
