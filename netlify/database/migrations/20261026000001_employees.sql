-- Saved employees, so a pay run is built from people on file rather than
-- typed in each time.
--
--   * Pay, W-4 and DE 4 choices, and per-period deductions live on the
--     employee. A pay run copies them when it is prepared, so changing an
--     employee later never changes a run already prepared.
--   * Year-to-date wages come from posted pay runs, plus whatever was paid
--     earlier in the year before the business started using Alt-QBO, so
--     Social Security, FUTA and UI stop at their wage bases.
--   * The Social Security number is sealed with a key held outside the
--     database (AES-256-GCM); only its last four digits are readable here.

CREATE TABLE employees (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  entity_id           uuid NOT NULL,
  name                text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  email               text CHECK (email IS NULL OR (email = lower(email) AND email LIKE '%_@_%')),
  address_line1       text,
  address_city        text,
  address_state       text CHECK (address_state IS NULL OR address_state ~ '^[A-Z]{2}$'),
  address_zip         text CHECK (address_zip IS NULL OR address_zip ~ '^\d{5}(-\d{4})?$'),
  hire_date           date NOT NULL,
  termination_date    date CHECK (termination_date IS NULL OR termination_date >= hire_date),
  pay_type            text NOT NULL CHECK (pay_type IN ('salary', 'hourly')),
  pay_frequency       text NOT NULL CHECK (pay_frequency IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  -- Annual salary for salaried staff, the hourly rate for hourly staff.
  pay_rate            numeric(12, 4) NOT NULL CHECK (pay_rate > 0),
  -- Usual hours each pay period for hourly staff, filled in on a new pay run.
  usual_hours         numeric(6, 2) CHECK (usual_hours IS NULL OR usual_hours >= 0),
  overtime_exempt     boolean NOT NULL DEFAULT false,
  w4                  jsonb NOT NULL,
  de4                 jsonb NOT NULL,
  -- [{ kind, amount, description }] taken every pay period.
  deductions          jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(deductions) = 'array'),
  sick_balance_hours  numeric(8, 4) NOT NULL DEFAULT 0 CHECK (sick_balance_hours >= 0),
  ssn_last4           text CHECK (ssn_last4 IS NULL OR ssn_last4 ~ '^\d{4}$'),
  ssn_sealed          text,
  -- { year, wages, federalIncomeTax, socialSecurityTax, medicareTax, caIncomeTax, caSdi }
  -- paid this year before the business used Alt-QBO.
  opening_ytd         jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((ssn_last4 IS NULL) = (ssn_sealed IS NULL)),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  UNIQUE (org_id, id)
);

CREATE INDEX employees_entity ON employees (entity_id, lower(name));

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON employees TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON employees TO altqbo_app;

-- The employer's California UI rate from its EDD notice (new employers: 3.4%).
ALTER TABLE entities
  ADD COLUMN ca_ui_rate numeric(6, 5) CHECK (ca_ui_rate IS NULL OR (ca_ui_rate >= 0 AND ca_ui_rate <= 0.2));

-- Lets year-to-date sums find posted runs by pay date without unpacking every result.
ALTER TABLE pay_runs ADD COLUMN pay_date date;
UPDATE pay_runs SET pay_date = (result->>'payDate')::date;
CREATE INDEX pay_runs_entity_date ON pay_runs (entity_id, pay_date) WHERE status = 'posted';
