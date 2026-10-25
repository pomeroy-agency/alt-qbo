-- Payroll tax deposits: when each tax is due, and what's been paid.
--
--   * What's due is worked out from posted pay runs every time (see
--     src/payroll/deposits.ts), so nothing here can drift from the runs.
--   * A payment records the date, the bank account and the confirmation
--     number from EFTPS or the EDD, and posts an entry that pays down the
--     tax liability accounts. Payments are append-only.
--   * Reminders sent are remembered so each one goes out once.

-- The federal schedule from the lookback period: new employers are monthly.
ALTER TABLE entities
  ADD COLUMN federal_deposit_schedule text NOT NULL DEFAULT 'monthly' CHECK (federal_deposit_schedule IN ('monthly', 'semiweekly'));

ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_source_type_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_type_check
  CHECK (source_type IN ('journal_voucher', 'invoice', 'bill', 'bank_line', 'payment', 'pay_run', 'reversal', 'opening_balance', 'tax_deposit'));

CREATE TABLE tax_deposit_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  entity_id       uuid NOT NULL,
  deposit_key     text NOT NULL CHECK (length(deposit_key) BETWEEN 1 AND 200),
  kind            text NOT NULL CHECK (kind IN ('federal_941', 'federal_940', 'ca_pit_sdi', 'ca_ui_ett')),
  due_date        date NOT NULL,
  paid_date       date NOT NULL,
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  -- { taxCode: cents } paid, so a later run in the same period shows only what's left.
  by_tax          jsonb NOT NULL CHECK (jsonb_typeof(by_tax) = 'object'),
  confirmation    text CHECK (confirmation IS NULL OR length(confirmation) <= 60),
  entry_id        uuid NOT NULL,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);

CREATE INDEX tax_deposit_payments_entity ON tax_deposit_payments (entity_id, deposit_key);

-- A payment must be backed by its own entry, which moves exactly its amount out of a bank account.
CREATE OR REPLACE FUNCTION tax_deposit_payments_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  paid bigint;
BEGIN
  SELECT coalesce(sum(l.credit_minor - l.debit_minor), 0)
    INTO paid
    FROM journal_entries e
    JOIN journal_lines l ON l.entry_id = e.id
    JOIN accounts a ON a.id = l.account_id
   WHERE e.id = NEW.entry_id AND e.entity_id = NEW.entity_id AND e.source_type = 'tax_deposit'
     AND e.source_id = NEW.id::text AND a.subtype = 'bank';
  IF paid <> NEW.amount_minor THEN
    RAISE EXCEPTION 'INVALID: the deposit entry does not pay % from a bank account', NEW.amount_minor USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tax_deposit_payments_check BEFORE INSERT ON tax_deposit_payments
  FOR EACH ROW EXECUTE FUNCTION tax_deposit_payments_check();
CREATE TRIGGER tax_deposit_payments_immutable BEFORE UPDATE OR DELETE ON tax_deposit_payments
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

ALTER TABLE tax_deposit_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON tax_deposit_payments TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT ON tax_deposit_payments TO altqbo_app;

CREATE TABLE tax_deposit_reminders (
  org_id       uuid NOT NULL,
  entity_id    uuid NOT NULL,
  deposit_key  text NOT NULL,
  -- 'upcoming' a few days before, 'overdue' the day after.
  reminder     text NOT NULL CHECK (reminder IN ('upcoming', 'overdue')),
  sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, deposit_key, reminder),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);

ALTER TABLE tax_deposit_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON tax_deposit_reminders TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT ON tax_deposit_reminders TO altqbo_app;
