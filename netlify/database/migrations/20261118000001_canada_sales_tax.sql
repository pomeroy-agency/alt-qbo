-- Canadian sales taxes: GST/HST, provincial sales tax (BC, Manitoba,
-- Saskatchewan) and QST.
--
--   * An invoice can carry several taxes, each at its own rate, and a line
--     can attract GST but not PST. Such invoices have tax_source 'canada':
--     documents.ca_tax holds each tax's base and amount, and each line's
--     ca_tax holds its share. The line's tax_minor is the sum of its taxes,
--     and its tax_rate is its own combined rate instead of the invoice's.
--   * GST/HST and QST paid on purchases are claimed back as input tax credits
--     (QST: input tax refunds). Bills put them on their own lines, posted to
--     two new asset accounts; PST paid is part of the cost.
--   * Each Canadian business records its registrations and filing periods.

ALTER TABLE documents DROP CONSTRAINT documents_tax_source_check;
ALTER TABLE documents ADD CONSTRAINT documents_tax_source_check
  CHECK (tax_source IN ('none', 'user_entered', 'not_taxable', 'resale', 'out_of_state', 'lookup', 'manual', 'direct_pay', 'canada'));
ALTER TABLE documents ADD COLUMN ca_tax jsonb;
ALTER TABLE documents ADD CONSTRAINT documents_ca_tax_check
  CHECK ((tax_source = 'canada') = (ca_tax IS NOT NULL) AND (ca_tax IS NULL OR kind = 'invoice'));

ALTER TABLE document_lines ADD COLUMN ca_tax jsonb;

-- The line's tax follows its own rate unless it carries Canadian taxes,
-- which are each rounded on their own.
ALTER TABLE document_lines DROP CONSTRAINT document_lines_tax_check;
ALTER TABLE document_lines ADD CONSTRAINT document_lines_tax_check
  CHECK (CASE WHEN ca_tax IS NULL THEN tax_minor = CASE WHEN taxable THEN round(coalesce(taxable_minor, amount_minor) * tax_rate) ELSE 0 END
              ELSE tax_minor >= 0 AND (taxable OR tax_minor = 0) END);

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
  IF (d.tax_source = 'canada') <> (NEW.ca_tax IS NOT NULL) THEN
    RAISE EXCEPTION 'INVALID: line Canadian taxes must match the document' USING ERRCODE = 'P0001';
  END IF;
  IF d.tax_source <> 'canada' AND NEW.tax_rate <> d.tax_rate THEN
    RAISE EXCEPTION 'INVALID: line tax rate must match the document' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.use_tax_rate <> d.use_tax_rate THEN
    RAISE EXCEPTION 'INVALID: line use tax rate must match the bill' USING ERRCODE = 'P0001';
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

CREATE TABLE ca_sales_tax_settings (
  entity_id      uuid PRIMARY KEY,
  org_id         uuid NOT NULL,
  -- GST/HST: the business number's RT program account, like 123456789 RT0001.
  gst_registered boolean NOT NULL DEFAULT false,
  gst_account    text CHECK (gst_account IS NULL OR gst_account ~ '^\d{9}RT\d{4}$'),
  gst_frequency  text CHECK (gst_frequency IS NULL OR gst_frequency IN ('monthly', 'quarterly', 'annual')),
  -- QST: Revenu Québec's 10-digit file number with TQ, like 1234567890TQ0001.
  qst_account    text CHECK (qst_account IS NULL OR qst_account ~ '^\d{10}TQ\d{4}$'),
  qst_frequency  text CHECK (qst_frequency IS NULL OR qst_frequency IN ('monthly', 'quarterly', 'annual')),
  -- PST registrations: {"BC": {"account": "PST-1234-5678", "frequency": "monthly"}, ...}
  pst            jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);
ALTER TABLE ca_sales_tax_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON ca_sales_tax_settings TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON ca_sales_tax_settings TO altqbo_app;

-- Accounts for Canadian businesses set up before this: QST and PST payable,
-- and the input tax credits and refunds. A code already taken moves up by one.
DO $$
DECLARE
  e record;
  acct record;
  c integer;
BEGIN
  FOR e IN SELECT id, org_id, tax_return_type FROM entities WHERE country = 'CA' LOOP
    FOR acct IN SELECT * FROM (VALUES
        (1310, 'GST/HST paid on purchases (input tax credits)', 'asset', 'other_current_asset', 'BS.CurrentAssets.Other', '1066', 'gst_itc'),
        (1320, 'QST paid on purchases (input tax refunds)', 'asset', 'other_current_asset', 'BS.CurrentAssets.Other', '1066', 'qst_itr'),
        (2210, 'QST payable', 'liability', 'tax_payable', 'BS.CurrentLiabilities.Taxes', '2680', 'qst_payable'),
        (2220, 'PST payable', 'liability', 'tax_payable', 'BS.CurrentLiabilities.Taxes', '2680', 'pst_payable')
      ) AS t(code, name, type, subtype, line, gifi, key) LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM accounts WHERE entity_id = e.id AND system_key = acct.key);
      c := acct.code;
      WHILE EXISTS (SELECT 1 FROM accounts WHERE entity_id = e.id AND code = c::text) LOOP c := c + 1; END LOOP;
      INSERT INTO accounts (org_id, entity_id, code, name, type, subtype, statement_line, cash_flow_class, tax_line, system_key)
      VALUES (e.org_id, e.id, c::text, acct.name, acct.type, acct.subtype, acct.line, 'operating',
              CASE WHEN e.tax_return_type = 't2125' THEN 'T2125.NotReported' ELSE 'GIFI.' || acct.gifi END, acct.key);
    END LOOP;
  END LOOP;
END;
$$;
