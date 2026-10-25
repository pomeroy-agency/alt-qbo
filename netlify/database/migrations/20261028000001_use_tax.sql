-- California use tax on purchases (Rev. & Tax. Code §§6201, 6202).
--
-- When a vendor doesn't charge California sales tax on something taxable,
-- such as software or SaaS from 2027 (SB 122) or goods from an out-of-state
-- seller, the business owes use tax on it itself. A bill can accrue it:
--
--   * Vendors can be marked as not charging California tax, so their bills
--     accrue use tax by default.
--   * The rate is the one for the business's own address (where it uses what
--     it bought), looked up or set by an accountant, and frozen on the bill.
--   * The use tax is part of the cost of what was bought and is owed to the
--     state, not the vendor: it is debited with the line's expense or asset
--     and credited to sales tax payable, and never reaches accounts payable.

ALTER TABLE contacts
  ADD COLUMN accrue_use_tax boolean NOT NULL DEFAULT false;

ALTER TABLE documents
  ADD COLUMN use_tax_rate         numeric(6, 5) NOT NULL DEFAULT 0 CHECK (use_tax_rate BETWEEN 0 AND 1),
  ADD COLUMN use_tax_minor        money_minor NOT NULL DEFAULT 0 CHECK (use_tax_minor >= 0),
  ADD COLUMN use_tax_source       text NOT NULL DEFAULT 'none' CHECK (use_tax_source IN ('none', 'not_taxable', 'lookup', 'manual')),
  ADD COLUMN use_tax_jurisdiction text,
  ADD COLUMN use_tax_address      text,
  ADD COLUMN use_tax_note         text,
  ADD CHECK (kind = 'bill' OR (use_tax_rate = 0 AND use_tax_minor = 0 AND use_tax_source = 'none')),
  ADD CHECK (use_tax_source IN ('lookup', 'manual') OR (use_tax_rate = 0 AND use_tax_minor = 0)),
  ADD CHECK (use_tax_source <> 'manual' OR length(trim(coalesce(use_tax_note, ''))) > 0),
  ADD CHECK (use_tax_source <> 'lookup' OR (use_tax_address IS NOT NULL AND use_tax_jurisdiction IS NOT NULL));

ALTER TABLE document_lines
  ADD COLUMN use_taxable  boolean NOT NULL DEFAULT false,
  ADD COLUMN use_tax_rate numeric(6, 5) NOT NULL DEFAULT 0 CHECK (use_tax_rate BETWEEN 0 AND 1),
  ADD COLUMN use_tax_minor money_minor NOT NULL DEFAULT 0,
  ADD CONSTRAINT document_lines_use_tax_check
    CHECK (use_tax_minor = CASE WHEN use_taxable THEN round(amount_minor * use_tax_rate) ELSE 0 END);

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

-- At commit: the lines add up, the entry carries the total to receivables or
-- payables, and a bill's use tax is credited to sales tax payable.
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
  use_tax bigint;
  control_key text;
  control bigint;
  payable bigint;
BEGIN
  SELECT * INTO d FROM documents WHERE id = doc_id;
  SELECT count(*), coalesce(sum(amount_minor), 0), coalesce(sum(tax_minor), 0), coalesce(sum(use_tax_minor), 0)
    INTO n, sub, tax, use_tax FROM document_lines WHERE document_id = doc_id;
  IF n = 0 THEN
    RAISE EXCEPTION 'INVALID: % % has no lines', d.kind, d.number USING ERRCODE = 'P0001';
  END IF;
  IF sub <> d.subtotal_minor OR tax <> d.tax_minor OR use_tax <> d.use_tax_minor THEN
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
  IF d.kind = 'bill' THEN
    SELECT coalesce(sum(l.credit_minor - l.debit_minor), 0)
      INTO payable
      FROM journal_lines l JOIN accounts a ON a.id = l.account_id
     WHERE l.entry_id = d.entry_id AND a.system_key = 'sales_tax_payable';
    IF payable <> d.use_tax_minor THEN
      RAISE EXCEPTION 'INVALID: bill % entry does not credit its use tax to sales tax payable', d.number
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
