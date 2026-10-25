-- Bank reconciliations: ledger lines on a bank account ticked off against a
-- statement.
--
-- Rules the database enforces on its own, whatever the application does:
--   * reconciliations of one account go forward in time, each starting from
--     the previous statement's ending balance;
--   * a reconciliation only commits when its beginning balance plus the
--     cleared lines equals the statement balance (zero difference);
--   * a ledger line is cleared at most once, only on its own bank account
--     and only if it is dated on or before the statement date;
--   * completed reconciliations and their cleared lines never change.

CREATE TABLE reconciliations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL,
  entity_id                uuid NOT NULL,
  bank_account_id          uuid NOT NULL,
  statement_date           date NOT NULL,
  beginning_balance_minor  money_minor NOT NULL,
  cleared_total_minor      money_minor NOT NULL,
  statement_balance_minor  money_minor NOT NULL,
  completed_by             text NOT NULL,
  completed_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (beginning_balance_minor + cleared_total_minor = statement_balance_minor),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, bank_account_id) REFERENCES accounts(org_id, entity_id, id),
  UNIQUE (bank_account_id, statement_date),
  UNIQUE (org_id, entity_id, id)
);

CREATE TABLE reconciliation_lines (
  reconciliation_id  uuid NOT NULL,
  org_id             uuid NOT NULL,
  entity_id          uuid NOT NULL,
  journal_line_id    uuid NOT NULL UNIQUE REFERENCES journal_lines(id),
  PRIMARY KEY (reconciliation_id, journal_line_id),
  FOREIGN KEY (org_id, entity_id, reconciliation_id) REFERENCES reconciliations(org_id, entity_id, id)
);

CREATE OR REPLACE FUNCTION reconciliations_check_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev reconciliations%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.bank_account_id AND subtype = 'bank') THEN
    RAISE EXCEPTION 'INVALID: only bank accounts are reconciled' USING ERRCODE = 'P0001';
  END IF;
  -- Serialise reconciliations of one account.
  PERFORM 1 FROM accounts WHERE id = NEW.bank_account_id FOR UPDATE;
  SELECT * INTO prev FROM reconciliations
   WHERE bank_account_id = NEW.bank_account_id ORDER BY statement_date DESC LIMIT 1;
  IF FOUND AND NEW.statement_date <= prev.statement_date THEN
    RAISE EXCEPTION 'INVALID: this account is already reconciled through %', prev.statement_date
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.beginning_balance_minor <> coalesce(prev.statement_balance_minor, 0) THEN
    RAISE EXCEPTION 'INVALID: the beginning balance must be the last statement''s ending balance (%)',
      coalesce(prev.statement_balance_minor, 0) USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliations_check_insert BEFORE INSERT ON reconciliations
  FOR EACH ROW EXECUTE FUNCTION reconciliations_check_insert();
CREATE TRIGGER reconciliations_immutable BEFORE UPDATE OR DELETE ON reconciliations
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER reconciliations_no_truncate BEFORE TRUNCATE ON reconciliations
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE OR REPLACE FUNCTION reconciliation_lines_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r reconciliations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM reconciliations WHERE id = NEW.reconciliation_id;
  IF r.xmin::text <> (pg_current_xact_id()::text::bigint % 4294967296)::text THEN
    RAISE EXCEPTION 'IMMUTABLE: lines can only be cleared when the reconciliation is completed' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.id = NEW.journal_line_id AND l.account_id = r.bank_account_id AND e.entry_date <= r.statement_date
  ) THEN
    RAISE EXCEPTION 'INVALID: a cleared line must be on the reconciled account and dated on or before %', r.statement_date
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_lines_check BEFORE INSERT ON reconciliation_lines
  FOR EACH ROW EXECUTE FUNCTION reconciliation_lines_check();
CREATE TRIGGER reconciliation_lines_immutable BEFORE UPDATE OR DELETE ON reconciliation_lines
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER reconciliation_lines_no_truncate BEFORE TRUNCATE ON reconciliation_lines
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- At commit, the cleared lines add up to what the reconciliation says.
CREATE OR REPLACE FUNCTION reconciliation_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r reconciliations%ROWTYPE;
  cleared bigint;
BEGIN
  SELECT * INTO r FROM reconciliations WHERE id = NEW.id;
  SELECT coalesce(sum(l.debit_minor - l.credit_minor), 0) INTO cleared
    FROM reconciliation_lines x JOIN journal_lines l ON l.id = x.journal_line_id
   WHERE x.reconciliation_id = r.id;
  IF cleared <> r.cleared_total_minor THEN
    RAISE EXCEPTION 'UNBALANCED: cleared lines total %, but the reconciliation records %', cleared, r.cleared_total_minor
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER reconciliations_balanced AFTER INSERT ON reconciliations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reconciliation_balanced();

ALTER TABLE reconciliations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON reconciliations      TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON reconciliation_lines TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT ON reconciliations, reconciliation_lines TO altqbo_app;
