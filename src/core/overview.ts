import type { Tx } from "../db/pool.js";
import { appendAudit } from "./audit.js";
import { aging } from "./documents.js";
import { LedgerError } from "./errors.js";
import { setPeriodStatus, type Actor, type PeriodStatus } from "./ledger.js";
import { fiscalYearStart, profitAndLoss } from "./statements.js";

// The owner's first screen, ported from Ledgerline's dashboard: the money
// figures someone running a service business checks every day, what needs
// doing, and the latest activity. Plus the single "books closed through"
// date that stands in for month-by-month period management.

export interface MoneyAtAGlance {
  asOf: string;
  fiscalYearFrom: string;
  cashMinor: bigint;
  owedToYouMinor: bigint;
  youOweMinor: bigint;
  profitThisYearMinor: bigint;
  /** Sales tax collected on invoices and not yet paid over to the CDTFA. */
  salesTaxHeldMinor: bigint;
  recent: { entryId: string; date: string; entryNumber: bigint; sourceType: string; memo: string; amountMinor: bigint }[];
}

export async function moneyAtAGlance(tx: Tx, entityId: string, asOf: string): Promise<MoneyAtAGlance> {
  const ent = (await tx.query("SELECT fiscal_year_start_month FROM entities WHERE id = $1", [entityId])).rows[0];
  if (!ent) throw new LedgerError("INVALID", "entity not found");
  const from = fiscalYearStart(asOf, ent.fiscal_year_start_month);
  const bal = (await tx.query(
    `SELECT coalesce(sum(l.debit_minor - l.credit_minor) FILTER (WHERE a.subtype = 'bank'), 0)::bigint AS cash,
            coalesce(sum(l.credit_minor - l.debit_minor) FILTER (WHERE a.system_key = 'sales_tax_payable'), 0)::bigint AS tax
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.entity_id = $1 AND e.entry_date <= $2`,
    [entityId, asOf],
  )).rows[0];
  const [ar, ap, pl] = [await aging(tx, entityId, "invoice", asOf), await aging(tx, entityId, "bill", asOf), await profitAndLoss(tx, entityId, from, asOf)];
  const recent = (await tx.query(
    `SELECT e.id, e.entry_date, e.entry_number, e.source_type, e.memo, sum(l.debit_minor)::bigint AS amount
       FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
      WHERE e.entity_id = $1 GROUP BY e.id ORDER BY e.entry_date DESC, e.entry_number DESC LIMIT 8`,
    [entityId],
  )).rows.map((r) => ({ entryId: r.id, date: r.entry_date, entryNumber: r.entry_number, sourceType: r.source_type, memo: r.memo, amountMinor: r.amount }));
  return {
    asOf, fiscalYearFrom: from, cashMinor: bal.cash, owedToYouMinor: ar.totalMinor, youOweMinor: ap.totalMinor,
    profitThisYearMinor: pl.netIncomeMinor, salesTaxHeldMinor: bal.tax, recent,
  };
}

export interface Attention {
  bankToReview: number;
  overdueInvoices: number;
  /** Unpaid bills due within a week, or already late. */
  billsDueSoon: number;
  payRunsToApprove: number;
}

/** Counts behind the menu badges. Cheap enough to fetch on every screen. */
export async function attention(tx: Tx, entityId: string, asOf: string): Promise<Attention> {
  const r = (await tx.query(
    `WITH open_docs AS (
       SELECT d.kind, d.due_date FROM documents d
        WHERE d.entity_id = $1 AND d.status = 'issued'
          AND d.total_minor > coalesce((SELECT sum(amount_minor) FROM document_payments p WHERE p.document_id = d.id), 0))
     SELECT (SELECT count(*) FROM bank_lines WHERE entity_id = $1 AND status = 'new')::int AS bank,
            (SELECT count(*) FROM open_docs WHERE kind = 'invoice' AND due_date < $2)::int AS overdue,
            (SELECT count(*) FROM open_docs WHERE kind = 'bill' AND due_date <= $2::date + 7)::int AS bills,
            (SELECT count(*) FROM pay_runs WHERE entity_id = $1 AND status = 'prepared')::int AS runs`,
    [entityId, asOf],
  )).rows[0];
  return { bankToReview: r.bank, overdueInvoices: r.overdue, billsDueSoon: r.bills, payRunsToApprove: r.runs };
}

/** The last day of the unbroken run of closed months from the start of the books, or null if the first month is open. */
export async function closedThrough(tx: Tx, entityId: string): Promise<string | null> {
  const { rows } = await tx.query("SELECT end_date, status FROM periods WHERE entity_id = $1 ORDER BY start_date", [entityId]);
  let through: string | null = null;
  for (const p of rows) {
    if (p.status === "open") break;
    through = p.end_date;
  }
  return through;
}

/**
 * Closes every month that ends on or before `through`, oldest first, so
 * nothing dated then can change. "locked" shuts everyone out; "soft_closed"
 * still lets an accountant post adjustments. Months already closed further
 * are left as they are; reopening stays a month-by-month step with a reason.
 */
export async function closeBooksThrough(
  tx: Tx,
  input: { orgId: string; entityId: string; through: string; status: Exclude<PeriodStatus, "open">; actor: Actor },
): Promise<{ closed: number; closedThrough: string | null }> {
  const { rows } = await tx.query(
    "SELECT id, end_date, status FROM periods WHERE entity_id = $1 AND end_date <= $2 ORDER BY start_date",
    [input.entityId, input.through],
  );
  if (!rows.length) throw new LedgerError("INVALID", `no month of these books ends on or before ${input.through}`);
  const rank = { open: 0, soft_closed: 1, locked: 2 } as const;
  let closed = 0;
  for (const p of rows) {
    if (rank[p.status as PeriodStatus] >= rank[input.status]) continue;
    await setPeriodStatus(tx, { orgId: input.orgId, periodId: p.id, status: input.status, actor: input.actor });
    closed++;
  }
  if (closed) {
    await appendAudit(tx, {
      orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "books.closed_through",
      objectType: "entity", objectId: input.entityId, after: { through: input.through, status: input.status, months: closed },
      context: { role: input.actor.role },
    });
  }
  return { closed, closedThrough: await closedThrough(tx, input.entityId) };
}
