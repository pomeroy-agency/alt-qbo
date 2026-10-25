import type { Tx } from "../db/pool.js";
import { appendAudit } from "./audit.js";
import { LedgerError, translateDbError } from "./errors.js";
import type { Actor, Role } from "./ledger.js";
import { parseMoney } from "./money.js";

// Bank reconciliation: tick the ledger lines on a bank account that appear
// on a statement; it completes only when the difference is zero. Ported from
// Ledgerline, with the zero-difference and clear-once rules in the database.

const CAN_RECONCILE: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];

async function bankAccount(tx: Tx, entityId: string, key: string) {
  const { rows } = await tx.query(
    "SELECT id, code, name, subtype FROM accounts WHERE entity_id = $1 AND (code = $2 OR system_key = $2)",
    [entityId, key],
  );
  if (!rows[0] || rows[0].subtype !== "bank") throw new LedgerError("INVALID", `${key} is not a bank account`);
  return rows[0] as { id: string; code: string; name: string };
}

export interface ReconItem {
  lineId: string;
  date: string;
  entryNumber: bigint;
  memo: string;
  description: string;
  /** Debit-positive: money in is positive. */
  amountMinor: bigint;
}

export interface ReconSummary {
  id: string;
  bankAccount: string;
  statementDate: string;
  beginningMinor: bigint;
  clearedMinor: bigint;
  statementMinor: bigint;
  lines: number;
  completedBy: string;
  completedAt: string;
}

export async function listReconciliations(tx: Tx, entityId: string, bankAccountKey?: string): Promise<ReconSummary[]> {
  const acct = bankAccountKey ? await bankAccount(tx, entityId, bankAccountKey) : null;
  const { rows } = await tx.query(
    `SELECT r.id, a.code, r.statement_date, r.beginning_balance_minor, r.cleared_total_minor, r.statement_balance_minor,
            r.completed_by, r.completed_at, (SELECT count(*)::int FROM reconciliation_lines x WHERE x.reconciliation_id = r.id) AS n
       FROM reconciliations r JOIN accounts a ON a.id = r.bank_account_id
      WHERE r.entity_id = $1 AND ($2::uuid IS NULL OR r.bank_account_id = $2)
      ORDER BY r.statement_date DESC`,
    [entityId, acct?.id ?? null],
  );
  return rows.map((r) => ({
    id: r.id, bankAccount: r.code, statementDate: r.statement_date, beginningMinor: r.beginning_balance_minor,
    clearedMinor: r.cleared_total_minor, statementMinor: r.statement_balance_minor, lines: r.n,
    completedBy: r.completed_by, completedAt: r.completed_at.toISOString(),
  }));
}

/** The starting point and the uncleared lines on or before the statement date. */
export async function reconciliationItems(
  tx: Tx,
  input: { entityId: string; bankAccount: string; statementDate: string },
): Promise<{ bankAccount: string; lastStatementDate: string | null; beginningMinor: bigint; items: ReconItem[] }> {
  const acct = await bankAccount(tx, input.entityId, input.bankAccount);
  const last = (await tx.query(
    "SELECT statement_date, statement_balance_minor FROM reconciliations WHERE bank_account_id = $1 ORDER BY statement_date DESC LIMIT 1",
    [acct.id],
  )).rows[0];
  const { rows } = await tx.query(
    `SELECT l.id, e.entry_date, e.entry_number, e.memo, l.description, l.debit_minor - l.credit_minor AS amount
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.account_id = $1 AND e.entry_date <= $2
        AND NOT EXISTS (SELECT 1 FROM reconciliation_lines x WHERE x.journal_line_id = l.id)
      ORDER BY e.entry_date, e.entry_number, l.line_no`,
    [acct.id, input.statementDate],
  );
  return {
    bankAccount: acct.code,
    lastStatementDate: last?.statement_date ?? null,
    beginningMinor: last?.statement_balance_minor ?? 0n,
    items: rows.map((r) => ({
      lineId: r.id, date: r.entry_date, entryNumber: r.entry_number, memo: r.memo, description: r.description, amountMinor: r.amount,
    })),
  };
}

/** Completes a reconciliation. Refused unless beginning balance + ticked lines = statement balance. */
export async function completeReconciliation(
  tx: Tx,
  input: {
    orgId: string; entityId: string; bankAccount: string; statementDate: string;
    /** Statement ending balance in major units ("12345.67", may be negative). */
    statementBalance: string; clearedLineIds: string[]; actor: Actor;
  },
): Promise<ReconSummary> {
  if (!CAN_RECONCILE.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot reconcile accounts`);
  const acct = await bankAccount(tx, input.entityId, input.bankAccount);
  let statement: bigint;
  try {
    statement = parseMoney(input.statementBalance.trim().replace(/,/g, "")).minor;
  } catch {
    throw new LedgerError("INVALID", "the statement balance must be an amount like 12345.67");
  }
  const ids = [...new Set(input.clearedLineIds)];
  const { items, beginningMinor, lastStatementDate } = await reconciliationItems(tx, input);
  if (lastStatementDate && input.statementDate <= lastStatementDate) {
    throw new LedgerError("INVALID", `this account is already reconciled through ${lastStatementDate}`);
  }
  const byId = new Map(items.map((i) => [i.lineId, i]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) throw new LedgerError("INVALID", `${unknown.length} ticked line(s) are not open items on this account`);
  const cleared = ids.reduce((s, id) => s + byId.get(id)!.amountMinor, 0n);
  const difference = statement - (beginningMinor + cleared);
  if (difference !== 0n) {
    throw new LedgerError("UNBALANCED", `the difference is ${(Number(difference) / 100).toFixed(2)}; it must be zero to finish`);
  }
  try {
    const { rows } = await tx.query(
      `INSERT INTO reconciliations (org_id, entity_id, bank_account_id, statement_date, beginning_balance_minor,
          cleared_total_minor, statement_balance_minor, completed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [input.orgId, input.entityId, acct.id, input.statementDate, beginningMinor, cleared, statement, input.actor.id],
    );
    const id: string = rows[0].id;
    if (ids.length) {
      await tx.query(
        `INSERT INTO reconciliation_lines (reconciliation_id, org_id, entity_id, journal_line_id)
         SELECT $1, $2, $3, unnest($4::uuid[])`,
        [id, input.orgId, input.entityId, ids],
      );
    }
    await appendAudit(tx, {
      orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "reconciliation.completed",
      objectType: "reconciliation", objectId: id,
      after: { bankAccount: acct.code, statementDate: input.statementDate, beginning: beginningMinor, cleared, statement, lines: ids.length },
      context: { role: input.actor.role },
    });
    return (await listReconciliations(tx, input.entityId, acct.code)).find((r) => r.id === id)!;
  } catch (err) {
    translateDbError(err);
  }
}
