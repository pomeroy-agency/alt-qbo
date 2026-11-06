-- Canadian remittances and year-end slips. How often the business remits
-- source deductions to the CRA and (in Quebec) Revenu Québec, as each agency
-- has told it; and the T4 box 45 code for employer-offered dental benefits.

ALTER TABLE entities
  ADD COLUMN cra_remitter_type text NOT NULL DEFAULT 'regular'
    CHECK (cra_remitter_type IN ('quarterly', 'regular', 'threshold1', 'threshold2')),
  ADD COLUMN rq_remitter_type text NOT NULL DEFAULT 'regular'
    CHECK (rq_remitter_type IN ('quarterly', 'regular', 'threshold1', 'threshold2')),
  ADD COLUMN t4_dental_code smallint CHECK (t4_dental_code IS NULL OR t4_dental_code BETWEEN 1 AND 5);
