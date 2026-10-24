-- Alt-QBO Phase 0 core schema: tenancy, chart of accounts, periods,
-- journal entries, and the hash-chained audit log.
--
-- Rules the database enforces on its own, whatever the application does:
--   * every row carries org_id and row-level security limits a session to
--     the organisation in app.org_id (tenant boundary);
--   * a journal entry balances per currency before its transaction commits;
--   * posted entries, their lines, and audit events can never be updated
--     or deleted (corrections are reversing entries);
--   * an entry can only post into an open period of its own entity
--     (soft-closed periods need app.allow_soft_closed = 'on');
--   * every line's account belongs to the entry's entity.

-- Roles are cluster-wide, so another database may already have created it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'altqbo_app') THEN
    CREATE ROLE altqbo_app NOLOGIN;
  END IF;
END
$$;

-- Money is stored as integer minor units (cents) with a currency code.
CREATE DOMAIN money_minor AS bigint;
CREATE DOMAIN currency_code AS char(3) CHECK (VALUE ~ '^[A-Z]{3}$');

CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE: % rows cannot be %d', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'P0001';
END;
$$;

-- ---------------------------------------------------------------- tenancy

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  kind        text NOT NULL DEFAULT 'business'
              CHECK (kind IN ('business', 'accounting_firm', 'hr_firm')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entities (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations(id),
  legal_name              text NOT NULL CHECK (length(trim(legal_name)) > 0),
  entity_type             text NOT NULL
                          CHECK (entity_type IN ('sole_prop', 'llc_single', 'llc_partnership',
                                                 'llc_s_corp', 's_corp', 'c_corp', 'partnership')),
  country                 char(2) NOT NULL,
  region                  text,
  locality                text,
  framework               text NOT NULL CHECK (framework IN ('US_GAAP', 'IFRS', 'IFRS_SME', 'FRS102', 'ASPE')),
  functional_currency     currency_code NOT NULL,
  fiscal_year_start_month smallint NOT NULL CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  coa_template            text NOT NULL,
  tax_return_type         text NOT NULL,
  ledger_retention_years  smallint NOT NULL,
  payroll_retention_years smallint NOT NULL,
  ein                     text,
  state_employer_id       text,
  next_entry_number       bigint NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

-- Many-to-many links from an organisation to outside parties it transacts
-- with (banks, processors, agencies, other Alt-QBO businesses). Credentials
-- are never stored here, only references to tokens held in a vault.
CREATE TABLE connections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  entity_id     uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('bank', 'card_issuer', 'processor', 'agency', 'business')),
  display_name  text NOT NULL,
  external_ref  text,
  scopes        text[] NOT NULL DEFAULT '{}',
  token_ref     text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);

-- ------------------------------------------------------ chart of accounts

CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  entity_id       uuid NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  type            text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  subtype         text NOT NULL,
  -- Framework statement line; an account must be mapped before it can exist.
  statement_line  text NOT NULL,
  cash_flow_class text NOT NULL CHECK (cash_flow_class IN ('cash', 'operating', 'investing', 'financing', 'none')),
  -- Tax-line code for the entity's return; NULL blocks the tax export, not the books.
  tax_line        text,
  system_key      text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  UNIQUE (entity_id, code),
  UNIQUE (entity_id, system_key),
  UNIQUE (org_id, entity_id, id)
);

-- ---------------------------------------------------------------- periods

CREATE TABLE periods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  entity_id   uuid NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'soft_closed', 'locked')),
  CHECK (end_date >= start_date),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  UNIQUE (entity_id, start_date),
  UNIQUE (org_id, entity_id, id)
);

CREATE OR REPLACE FUNCTION periods_no_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM periods p
    WHERE p.entity_id = NEW.entity_id AND p.id <> NEW.id
      AND p.start_date <= NEW.end_date AND NEW.start_date <= p.end_date
  ) THEN
    RAISE EXCEPTION 'PERIOD_OVERLAP: period % to % overlaps an existing period',
      NEW.start_date, NEW.end_date USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.start_date <> OLD.start_date OR NEW.end_date <> OLD.end_date
                           OR NEW.entity_id <> OLD.entity_id) THEN
    RAISE EXCEPTION 'IMMUTABLE: period dates cannot change' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER periods_no_overlap BEFORE INSERT OR UPDATE ON periods
  FOR EACH ROW EXECUTE FUNCTION periods_no_overlap();
CREATE TRIGGER periods_no_delete BEFORE DELETE ON periods
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------- journal

CREATE TABLE journal_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  entity_id         uuid NOT NULL,
  entry_number      bigint NOT NULL,
  entry_date        date NOT NULL,
  period_id         uuid NOT NULL,
  memo              text NOT NULL DEFAULT '',
  source_type       text NOT NULL
                    CHECK (source_type IN ('journal_voucher', 'invoice', 'bill', 'bank_line',
                                           'payment', 'pay_run', 'reversal', 'opening_balance')),
  source_id         text,
  idempotency_key   text NOT NULL,
  -- Hash of the entry's content, so a replayed key with different content is refused.
  content_hash      text NOT NULL,
  reverses_entry_id uuid UNIQUE REFERENCES journal_entries(id),
  posted_by         text NOT NULL,
  posted_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, period_id) REFERENCES periods(org_id, entity_id, id),
  UNIQUE (entity_id, entry_number),
  UNIQUE (entity_id, idempotency_key),
  UNIQUE (org_id, entity_id, id)
);

CREATE TABLE journal_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  entity_id     uuid NOT NULL,
  entry_id      uuid NOT NULL,
  line_no       integer NOT NULL CHECK (line_no > 0),
  account_id    uuid NOT NULL,
  currency      currency_code NOT NULL,
  debit_minor   money_minor NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor  money_minor NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  description   text NOT NULL DEFAULT '',
  dimensions    jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((debit_minor = 0) <> (credit_minor = 0)),
  -- Composite keys tie each line to an entry and an account of the same entity.
  FOREIGN KEY (org_id, entity_id, entry_id) REFERENCES journal_entries(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, account_id) REFERENCES accounts(org_id, entity_id, id),
  UNIQUE (entry_id, line_no)
);

CREATE INDEX journal_lines_account ON journal_lines (account_id);
CREATE INDEX journal_entries_date ON journal_entries (entity_id, entry_date);

-- Entry may only post into an open period that covers its date.
CREATE OR REPLACE FUNCTION journal_entries_check_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p periods%ROWTYPE;
BEGIN
  SELECT * INTO p FROM periods WHERE id = NEW.period_id;
  IF NEW.entry_date < p.start_date OR NEW.entry_date > p.end_date THEN
    RAISE EXCEPTION 'PERIOD_MISMATCH: entry date % is outside period % to %',
      NEW.entry_date, p.start_date, p.end_date USING ERRCODE = 'P0001';
  END IF;
  IF p.status = 'locked' THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: period % to % is locked', p.start_date, p.end_date
      USING ERRCODE = 'P0001';
  END IF;
  IF p.status = 'soft_closed' AND coalesce(current_setting('app.allow_soft_closed', true), '') <> 'on' THEN
    RAISE EXCEPTION 'PERIOD_SOFT_CLOSED: period % to % is soft-closed', p.start_date, p.end_date
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_entries_check_period BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_check_period();
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON journal_lines
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- Lines may only be added in the same transaction that created the entry,
-- so a posted entry can't grow new lines later.
CREATE OR REPLACE FUNCTION journal_lines_same_tx() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- xmin is the 32-bit id of the transaction that inserted the entry row.
  IF NOT EXISTS (
    SELECT 1 FROM journal_entries e
    WHERE e.id = NEW.entry_id
      AND e.xmin::text = (pg_current_xact_id()::text::bigint % 4294967296)::text
  ) THEN
    RAISE EXCEPTION 'IMMUTABLE: lines can only be added when the entry is posted'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_lines_same_tx BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_same_tx();

-- Balance check runs at commit, once all lines are in.
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry uuid := CASE WHEN TG_TABLE_NAME = 'journal_entries'
                     THEN (to_jsonb(NEW) ->> 'id')::uuid
                     ELSE (to_jsonb(NEW) ->> 'entry_id')::uuid END;
  n_lines integer;
  bad record;
BEGIN
  SELECT count(*) INTO n_lines FROM journal_lines WHERE entry_id = entry;
  IF n_lines < 2 THEN
    RAISE EXCEPTION 'UNBALANCED: entry % needs at least two lines', entry USING ERRCODE = 'P0001';
  END IF;
  SELECT currency, sum(debit_minor) AS dr, sum(credit_minor) AS cr INTO bad
  FROM journal_lines WHERE entry_id = entry
  GROUP BY currency HAVING sum(debit_minor) <> sum(credit_minor)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'UNBALANCED: entry % debits % <> credits % in %', entry, bad.dr, bad.cr, bad.currency
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- -------------------------------------------------------------- audit log

-- One hash chain per organisation. audit_heads serialises appends.
CREATE TABLE audit_heads (
  org_id     uuid PRIMARY KEY REFERENCES organizations(id),
  last_seq   bigint NOT NULL DEFAULT 0,
  last_hash  text NOT NULL
);

CREATE TABLE audit_events (
  id           bigserial PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES organizations(id),
  seq          bigint NOT NULL,
  entity_id    uuid,
  occurred_at  timestamptz NOT NULL,
  actor        text NOT NULL,
  action       text NOT NULL,
  object_type  text NOT NULL,
  object_id    text NOT NULL,
  before       jsonb,
  after        jsonb,
  context      jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash    text NOT NULL,
  hash         text NOT NULL,
  UNIQUE (org_id, seq)
);

CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- The head may only move forward, one event at a time.
CREATE OR REPLACE FUNCTION audit_heads_forward_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_seq <> OLD.last_seq + 1 THEN
    RAISE EXCEPTION 'AUDIT_CHAIN: head must advance by one' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_events
                 WHERE org_id = NEW.org_id AND seq = NEW.last_seq AND hash = NEW.last_hash
                   AND prev_hash = OLD.last_hash) THEN
    RAISE EXCEPTION 'AUDIT_CHAIN: head must point at the newest event' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_heads_forward_only BEFORE UPDATE ON audit_heads
  FOR EACH ROW EXECUTE FUNCTION audit_heads_forward_only();
CREATE TRIGGER audit_heads_no_delete BEFORE DELETE ON audit_heads
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------- row-level security

ALTER TABLE organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities        ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE periods         ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_heads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events    ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant ON organizations   TO altqbo_app USING (id = app_org_id()) WITH CHECK (id = app_org_id());
CREATE POLICY tenant ON entities        TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON connections     TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON accounts        TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON periods         TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON journal_entries TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON journal_lines   TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON audit_heads     TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON audit_events    TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());

GRANT SELECT, INSERT ON organizations, audit_events, journal_entries, journal_lines TO altqbo_app;
GRANT SELECT, INSERT, UPDATE ON entities, connections, accounts, periods, audit_heads TO altqbo_app;
GRANT USAGE ON SEQUENCE audit_events_id_seq TO altqbo_app;
