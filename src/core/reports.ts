import type { Tx } from "../db/pool.js";
import { LedgerError } from "./errors.js";
import { toMajor } from "./money.js";

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  statementLine: string;
  taxLine: string | null;
  currency: string;
  debitMinor: bigint;
  creditMinor: bigint;
  /** Debit-positive net balance. */
  balanceMinor: bigint;
}

export interface TrialBalance {
  entityId: string;
  asOf: string;
  rows: TrialBalanceRow[];
  totalDebitMinor: bigint;
  totalCreditMinor: bigint;
}

/** Trial balance through a date, per account and currency, built straight from posted lines. */
export async function trialBalance(tx: Tx, entityId: string, asOf: string): Promise<TrialBalance> {
  const { rows } = await tx.query(
    `SELECT a.id, a.code, a.name, a.type, a.statement_line, a.tax_line, l.currency,
            sum(l.debit_minor)::bigint AS dr, sum(l.credit_minor)::bigint AS cr
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.entity_id = $1 AND e.entry_date <= $2
      GROUP BY a.id, a.code, a.name, a.type, a.statement_line, a.tax_line, l.currency
      ORDER BY a.code, l.currency`,
    [entityId, asOf],
  );
  const out: TrialBalanceRow[] = rows.map((r) => ({
    accountId: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    statementLine: r.statement_line,
    taxLine: r.tax_line,
    currency: r.currency.trim(),
    debitMinor: r.dr,
    creditMinor: r.cr,
    balanceMinor: (r.dr as bigint) - (r.cr as bigint),
  }));
  const totalDebitMinor = out.reduce((s, r) => s + r.debitMinor, 0n);
  const totalCreditMinor = out.reduce((s, r) => s + r.creditMinor, 0n);
  return { entityId, asOf, rows: out, totalDebitMinor, totalCreditMinor };
}

export async function accountBalance(tx: Tx, entityId: string, accountKey: string, asOf: string): Promise<bigint> {
  const { rows } = await tx.query(
    `SELECT coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint AS bal
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.entity_id = $1 AND e.entry_date <= $3 AND (a.code = $2 OR a.system_key = $2)`,
    [entityId, accountKey, asOf],
  );
  return rows[0].bal;
}

/**
 * Trial balance grouped by tax-line code, as CSV for import into tax
 * software. Any account with a balance and no tax-line code blocks the export.
 */
export async function taxLineExportCsv(tx: Tx, entityId: string, asOf: string): Promise<string> {
  const tb = await trialBalance(tx, entityId, asOf);
  const unmapped = tb.rows.filter((r) => r.balanceMinor !== 0n && !r.taxLine);
  if (unmapped.length) {
    throw new LedgerError("INVALID",
      `tax export blocked: accounts without a tax-line code: ${unmapped.map((r) => r.code).join(", ")}`);
  }
  const lines = ["account_number,account_name,tax_line,debit,credit"];
  for (const r of tb.rows) {
    if (r.balanceMinor === 0n) continue;
    const dr = r.balanceMinor > 0n ? toMajor(r.balanceMinor).toFixed(2) : "";
    const cr = r.balanceMinor < 0n ? toMajor(-r.balanceMinor).toFixed(2) : "";
    lines.push([r.code, csv(r.name), r.taxLine, dr, cr].join(","));
  }
  return lines.join("\n") + "\n";
}

function csv(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
