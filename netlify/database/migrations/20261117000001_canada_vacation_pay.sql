-- Canadian vacation pay. Each employee either gets vacation pay with every
-- paycheck ("each_pay") or earns it into a balance that is paid when they
-- take time off or leave ("accrue", the default). The rate comes from the
-- province's or territory's law for their years of service; an employer may
-- set a higher one. Statutory holiday pay needs no new columns: it's worked
-- out in each pay run from the pay before the holiday.

ALTER TABLE employees
  ADD COLUMN vacation_method text NOT NULL DEFAULT 'accrue' CHECK (vacation_method IN ('accrue', 'each_pay')),
  ADD COLUMN vacation_balance numeric(14, 2) NOT NULL DEFAULT 0 CHECK (vacation_balance >= 0),
  ADD COLUMN vacation_rate numeric(6, 4) CHECK (vacation_rate IS NULL OR (vacation_rate > 0 AND vacation_rate < 1));
