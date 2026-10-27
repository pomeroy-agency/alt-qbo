-- Where an employee works, so pay can be checked against a city or county
-- minimum wage that is higher than California's (src/rules/local-minimum-wage.ts).
-- Null means no local check: the state minimum still applies.
ALTER TABLE employees
  ADD COLUMN work_city text CHECK (work_city IS NULL OR length(trim(work_city)) BETWEEN 1 AND 60);
