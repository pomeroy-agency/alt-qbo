-- Chart-of-accounts editing, ported from Ledgerline: add accounts, rename,
-- remap tax lines, deactivate and reactivate. Ledgerline checked these in the
-- browser; here the database holds the line.
--
--   * an account's statement line must suit its type, so reports can't put
--     an expense on the balance sheet;
--   * code, type, subtype and system key never change once created, so past
--     entries keep meaning what they meant;
--   * system accounts (the ones payroll, invoices and the bank feed post to)
--     can't be deactivated, and no account can be while it carries a balance;
--   * accounts are never deleted.

CREATE FUNCTION accounts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bal bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE: accounts are never deleted; deactivate instead' USING ERRCODE = 'P0001';
  END IF;
  IF NOT coalesce(CASE NEW.type
      WHEN 'asset'     THEN NEW.statement_line LIKE 'BS.CurrentAssets%' OR NEW.statement_line LIKE 'BS.NoncurrentAssets%'
      WHEN 'liability' THEN NEW.statement_line LIKE 'BS.CurrentLiabilities%' OR NEW.statement_line LIKE 'BS.NoncurrentLiabilities%'
      WHEN 'equity'    THEN NEW.statement_line LIKE 'BS.Equity%'
      WHEN 'revenue'   THEN NEW.statement_line LIKE 'IS.Revenue%' OR NEW.statement_line LIKE 'IS.OtherIncome%'
      WHEN 'expense'   THEN NEW.statement_line LIKE 'IS.CostOfRevenue%' OR NEW.statement_line LIKE 'IS.OperatingExpenses%' OR NEW.statement_line LIKE 'IS.OtherExpense%'
    END, false) THEN
    RAISE EXCEPTION 'INVALID: statement line % does not suit a % account', NEW.statement_line, NEW.type USING ERRCODE = 'P0001';
  END IF;
  IF NEW.code !~ '^[0-9]{3,6}$' THEN
    RAISE EXCEPTION 'INVALID: account codes are 3 to 6 digits' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.org_id, NEW.entity_id, NEW.code, NEW.type, NEW.subtype, NEW.system_key, NEW.created_at)
       IS DISTINCT FROM (OLD.org_id, OLD.entity_id, OLD.code, OLD.type, OLD.subtype, OLD.system_key, OLD.created_at) THEN
      RAISE EXCEPTION 'IMMUTABLE: an account''s code, type and kind never change; add a new account instead' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_active AND NOT NEW.is_active THEN
      IF OLD.system_key IS NOT NULL THEN
        RAISE EXCEPTION 'INVALID: account % is used by the system and stays active', OLD.code USING ERRCODE = 'P0001';
      END IF;
      SELECT coalesce(sum(debit_minor - credit_minor), 0) INTO bal FROM journal_lines WHERE account_id = OLD.id;
      IF bal <> 0 THEN
        RAISE EXCEPTION 'INVALID: account % has a balance; move it to another account before deactivating', OLD.code USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER accounts_guard BEFORE INSERT OR UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION accounts_guard();

-- Nothing posts to an inactive account. The row lock also orders a posting
-- and a concurrent deactivation, so an account can't be switched off while a
-- line is landing on it.
CREATE FUNCTION journal_lines_active_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  a accounts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM accounts WHERE id = NEW.account_id FOR SHARE;
  IF NOT a.is_active THEN
    RAISE EXCEPTION 'INACTIVE_ACCOUNT: account % is inactive', a.code USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER journal_lines_active_account BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_active_account();
