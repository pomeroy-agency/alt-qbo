-- Contractors' year-end forms: 1099-NEC (US) and T4A box 048 (Canada).
-- One row per vendor who gets a form. The taxpayer number is sealed with
-- PII_KEY like employees' numbers; only its last four digits are readable
-- without the key.

CREATE TABLE contractor_tax_info (
  contact_id      uuid PRIMARY KEY,
  org_id          uuid NOT NULL,
  entity_id       uuid NOT NULL,
  form            text NOT NULL CHECK (form IN ('1099_nec', 't4a')),
  -- 1099: individuals, partnerships and most LLCs get one; corporations don't, except for legal services.
  recipient_type  text NOT NULL CHECK (recipient_type IN ('individual', 'partnership', 'llc', 'corporation', 'attorney', 'other')),
  tin_kind        text CHECK (tin_kind IN ('ssn', 'ein', 'sin', 'bn')),
  tin_sealed      text,
  tin_last4       text CHECK (tin_last4 IS NULL OR tin_last4 ~ '^\d{4}$'),
  -- The name on the vendor's W-9 (or for the T4A), when it differs from the contact name.
  legal_name      text,
  updated_by      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((tin_sealed IS NULL) = (tin_last4 IS NULL) AND (tin_sealed IS NULL) = (tin_kind IS NULL)),
  CHECK (form <> '1099_nec' OR tin_kind IS NULL OR tin_kind IN ('ssn', 'ein')),
  CHECK (form <> 't4a' OR tin_kind IS NULL OR tin_kind IN ('sin', 'bn')),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, contact_id) REFERENCES contacts(org_id, entity_id, id)
);

ALTER TABLE contractor_tax_info ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON contractor_tax_info TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON contractor_tax_info TO altqbo_app;
