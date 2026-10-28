-- Paid sick leave (Labor Code 245-249): each business picks accrual (one
-- hour per 30 worked, exempt employees deemed to work 40 a week) or
-- front-loading (40 hours at the start of each year, no carryover). For
-- front-loading, each employee records the year their hours were last
-- granted, so the grant happens once, on their first pay run of the year.
ALTER TABLE entities
  ADD COLUMN sick_leave_policy text NOT NULL DEFAULT 'accrual' CHECK (sick_leave_policy IN ('accrual', 'front_load'));
ALTER TABLE employees
  ADD COLUMN sick_granted_year int CHECK (sick_granted_year IS NULL OR sick_granted_year BETWEEN 2000 AND 2100);
