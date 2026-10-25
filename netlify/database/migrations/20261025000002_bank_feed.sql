-- Bank statement lines imported from CSV, and how each one reached the books.
--
-- Rules the database enforces on its own, whatever the application does:
--   * a statement line belongs to a bank account and is never imported twice
--     (one dedupe key per account);
--   * a line's date, amount and description never change, and lines are never
--     deleted, so the feed stays a faithful copy of the statement;
--   * a recorded ('posted') line must point at a journal entry that moves
--     exactly the line's amount through that bank account, and goes back to
--     the review queue only after that entry has been reversed.

CREATE TABLE bank_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  entity_id        uuid NOT NULL,
  bank_account_id  uuid NOT NULL,
  file_name        text NOT NULL DEFAULT '',
  added            integer NOT NULL CHECK (added >= 0),
  duplicates       integer NOT NULL CHECK (duplicates >= 0),
  unreadable       integer NOT NULL CHECK (unreadable >= 0),
  imported_by      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, bank_account_id) REFERENCES accounts(org_id, entity_id, id),
  UNIQUE (org_id, entity_id, id)
);

CREATE TABLE bank_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  entity_id            uuid NOT NULL,
  bank_account_id      uuid NOT NULL,
  import_id            uuid NOT NULL,
  txn_date             date NOT NULL,
  description          text NOT NULL,
  -- Signed: deposits positive, withdrawals negative.
  amount_minor         money_minor NOT NULL CHECK (amount_minor <> 0),
  -- Date, amount, description and which repeat of that row it is in the file.
  dedupe_key           text NOT NULL,
  status               text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'posted', 'excluded')),
  entry_id             uuid UNIQUE,
  category_account_id  uuid,
  document_id          uuid,
  decided_by           text,
  decided_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'posted') = (entry_id IS NOT NULL)),
  CHECK (status = 'posted' OR (category_account_id IS NULL AND document_id IS NULL)),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, bank_account_id) REFERENCES accounts(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, import_id) REFERENCES bank_imports(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, entry_id) REFERENCES journal_entries(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, category_account_id) REFERENCES accounts(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, document_id) REFERENCES documents(org_id, entity_id, id),
  UNIQUE (bank_account_id, dedupe_key)
);
CREATE INDEX bank_lines_review ON bank_lines (entity_id, bank_account_id, status, txn_date);

CREATE OR REPLACE FUNCTION bank_account_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.bank_account_id AND subtype = 'bank') THEN
    RAISE EXCEPTION 'INVALID: statements can only be imported into a bank account' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_imports_bank_only BEFORE INSERT ON bank_imports
  FOR EACH ROW EXECUTE FUNCTION bank_account_only();
CREATE TRIGGER bank_imports_immutable BEFORE UPDATE OR DELETE ON bank_imports
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION bank_lines_check_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'new' THEN
    RAISE EXCEPTION 'INVALID: imported lines start out unrecorded' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bank_imports WHERE id = NEW.import_id AND bank_account_id = NEW.bank_account_id) THEN
    RAISE EXCEPTION 'INVALID: line and import are for different bank accounts' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_lines_bank_only BEFORE INSERT ON bank_lines
  FOR EACH ROW EXECUTE FUNCTION bank_account_only();
CREATE TRIGGER bank_lines_check_insert BEFORE INSERT ON bank_lines
  FOR EACH ROW EXECUTE FUNCTION bank_lines_check_insert();

CREATE OR REPLACE FUNCTION bank_lines_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  decision text[] := ARRAY['status', 'entry_id', 'category_account_id', 'document_id', 'decided_by', 'decided_at'];
  moved bigint;
BEGIN
  IF (to_jsonb(NEW) - decision) IS DISTINCT FROM (to_jsonb(OLD) - decision) THEN
    RAISE EXCEPTION 'IMMUTABLE: imported bank lines cannot be edited' USING ERRCODE = 'P0001';
  END IF;
  -- A recorded line goes back to the review queue only once its entry has been reversed.
  IF OLD.status = 'posted' AND NOT (
       NEW.status = 'new' AND OLD.document_id IS NULL
       AND EXISTS (SELECT 1 FROM journal_entries WHERE reverses_entry_id = OLD.entry_id)) THEN
    RAISE EXCEPTION 'IMMUTABLE: this bank line is already recorded; reverse its entry first' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status = 'posted' THEN
    SELECT coalesce(sum(l.debit_minor - l.credit_minor), 0) INTO moved
      FROM journal_lines l WHERE l.entry_id = NEW.entry_id AND l.account_id = NEW.bank_account_id;
    IF moved <> NEW.amount_minor THEN
      RAISE EXCEPTION 'INVALID: the entry moves % through the bank account, but the statement line is %',
        moved, NEW.amount_minor USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_lines_guard_update BEFORE UPDATE ON bank_lines
  FOR EACH ROW EXECUTE FUNCTION bank_lines_guard_update();
CREATE TRIGGER bank_lines_no_delete BEFORE DELETE ON bank_lines
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER bank_lines_no_truncate BEFORE TRUNCATE ON bank_lines
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

ALTER TABLE bank_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_lines   ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON bank_imports TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON bank_lines   TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT ON bank_imports TO altqbo_app;
GRANT SELECT, INSERT, UPDATE ON bank_lines TO altqbo_app;
