-- Deposit kinds may carry the report's number, like tx_c3 or ak_tq01c.
ALTER TABLE tax_deposit_payments DROP CONSTRAINT IF EXISTS tax_deposit_payments_kind_check;
ALTER TABLE tax_deposit_payments ADD CONSTRAINT tax_deposit_payments_kind_check
  CHECK (kind IN ('federal_941', 'federal_940') OR kind ~ '^[a-z]{2}_[a-z0-9_]{2,20}$');
