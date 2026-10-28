import type { Tx } from "../db/pool.js";
import { csvCell } from "./csv.js";
import { LedgerError } from "./errors.js";
import { toMajor } from "./money.js";

// Financial statements and the general ledger, built straight from posted
// lines and each account's statement-line mapping. Accrual basis. Ported
// from Ledgerline's browser reports.

export interface StatementRow {
  accountId: string;
  code: string;
  name: string;
  /** Shown on the account's normal side: revenue, liabilities and equity positive when credit. */
  amountMinor: bigint;
}

export interface StatementSection {
  key: string;
  label: string;
  rows: StatementRow[];
  totalMinor: bigint;
}

const CREDIT_NORMAL = new Set(["liability", "equity", "revenue"]);

async function balancesBetween(tx: Tx, entityId: string, from: string | null, to: string) {
  const { rows } = await tx.query(
    `SELECT a.id, a.code, a.name, a.type, a.statement_line,
            coalesce(sum(l.debit_minor - l.credit_minor) FILTER (WHERE e.id IS NOT NULL), 0)::bigint AS net
       FROM accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
       LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.entry_date <= $3 AND ($2::date IS NULL OR e.entry_date >= $2)
      WHERE a.entity_id = $1
      GROUP BY a.id, a.code, a.name, a.type, a.statement_line
      ORDER BY a.code`,
    [entityId, from, to],
  );
  return rows.map((r) => ({
    accountId: r.id as string, code: r.code as string, name: r.name as string, type: r.type as string,
    statementLine: r.statement_line as string,
    amountMinor: CREDIT_NORMAL.has(r.type) ? -(r.net as bigint) : (r.net as bigint),
  }));
}

function section(key: string, label: string, rows: Awaited<ReturnType<typeof balancesBetween>>, sign = 1n): StatementSection {
  const kept = rows.filter((r) => r.amountMinor !== 0n)
    .map(({ accountId, code, name, amountMinor }) => ({ accountId, code, name, amountMinor: amountMinor * sign }));
  return { key, label, rows: kept, totalMinor: kept.reduce((s, r) => s + r.amountMinor, 0n) };
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  sections: StatementSection[];
  grossProfitMinor: bigint;
  operatingIncomeMinor: bigint;
  netIncomeMinor: bigint;
}

export async function profitAndLoss(tx: Tx, entityId: string, from: string, to: string): Promise<ProfitAndLoss> {
  if (from > to) throw new LedgerError("INVALID", "the start date is after the end date");
  const b = await balancesBetween(tx, entityId, from, to);
  const line = (prefix: string) => b.filter((r) => r.statementLine === prefix || r.statementLine.startsWith(`${prefix}.`));
  const revenue = section("revenue", "Revenue", line("IS.Revenue"));
  const cost = section("cost_of_revenue", "Cost of revenue", line("IS.CostOfRevenue"));
  const opex = section("operating_expenses", "Operating expenses", line("IS.OperatingExpenses"));
  const otherIncome = section("other_income", "Other income", line("IS.OtherIncome"));
  const otherExpense = section("other_expense", "Other expenses", line("IS.OtherExpense"));
  const gross = revenue.totalMinor - cost.totalMinor;
  const operating = gross - opex.totalMinor;
  return {
    from, to,
    sections: [revenue, cost, opex, otherIncome, otherExpense],
    grossProfitMinor: gross,
    operatingIncomeMinor: operating,
    netIncomeMinor: operating + otherIncome.totalMinor - otherExpense.totalMinor,
  };
}

/** Net income across every income-statement account, from any date through `to`. */
async function netIncome(tx: Tx, entityId: string, from: string | null, to: string): Promise<bigint> {
  const { rows } = await tx.query(
    `SELECT coalesce(sum(l.credit_minor - l.debit_minor), 0)::bigint AS ni
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.entity_id = $1 AND a.type IN ('revenue', 'expense') AND e.entry_date <= $3 AND ($2::date IS NULL OR e.entry_date >= $2)`,
    [entityId, from, to],
  );
  return rows[0].ni;
}

export function fiscalYearStart(asOf: string, startMonth: number): string {
  const [y, m] = asOf.split("-").map(Number) as [number, number];
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

function dayBefore(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

export interface BalanceSheet {
  asOf: string;
  sections: StatementSection[];
  totalAssetsMinor: bigint;
  totalLiabilitiesMinor: bigint;
  /** Equity accounts plus earnings not yet closed to retained earnings. */
  totalEquityMinor: bigint;
  priorYearsEarningsMinor: bigint;
  currentYearEarningsMinor: bigint;
  balanced: boolean;
}

export async function balanceSheet(tx: Tx, entityId: string, asOf: string): Promise<BalanceSheet> {
  const ent = await tx.query("SELECT fiscal_year_start_month FROM entities WHERE id = $1", [entityId]);
  if (!ent.rows[0]) throw new LedgerError("INVALID", "entity not found");
  const fy = fiscalYearStart(asOf, ent.rows[0].fiscal_year_start_month);
  const b = await balancesBetween(tx, entityId, null, asOf);
  const line = (prefix: string) => b.filter((r) => r.statementLine.startsWith(prefix));
  const sections = [
    section("current_assets", "Current assets", line("BS.CurrentAssets")),
    section("noncurrent_assets", "Long-term assets", line("BS.NoncurrentAssets")),
    section("current_liabilities", "Current liabilities", line("BS.CurrentLiabilities")),
    section("noncurrent_liabilities", "Long-term liabilities", line("BS.NoncurrentLiabilities")),
    section("equity", "Equity", line("BS.Equity")),
  ];
  const prior = await netIncome(tx, entityId, null, dayBefore(fy));
  const current = await netIncome(tx, entityId, fy, asOf);
  const [ca, nca, cl, ncl, eq] = sections as [StatementSection, StatementSection, StatementSection, StatementSection, StatementSection];
  const assets = ca.totalMinor + nca.totalMinor;
  const liabilities = cl.totalMinor + ncl.totalMinor;
  const equity = eq.totalMinor + prior + current;
  return {
    asOf, sections, totalAssetsMinor: assets, totalLiabilitiesMinor: liabilities, totalEquityMinor: equity,
    priorYearsEarningsMinor: prior, currentYearEarningsMinor: current, balanced: assets === liabilities + equity,
  };
}

export interface LedgerLine {
  date: string;
  entryId: string;
  entryNumber: bigint;
  sourceType: string;
  memo: string;
  description: string;
  debitMinor: bigint;
  creditMinor: bigint;
  /** Running balance on the account's normal side. */
  balanceMinor: bigint;
}

export interface GeneralLedger {
  account: { code: string; name: string; type: string };
  from: string;
  to: string;
  openingMinor: bigint;
  lines: LedgerLine[];
  closingMinor: bigint;
}

export async function generalLedger(tx: Tx, entityId: string, accountKey: string, from: string, to: string): Promise<GeneralLedger> {
  const a = (await tx.query(
    "SELECT id, code, name, type FROM accounts WHERE entity_id = $1 AND (code = $2 OR system_key = $2)",
    [entityId, accountKey],
  )).rows[0];
  if (!a) throw new LedgerError("UNKNOWN_ACCOUNT", `no account ${accountKey} in this entity`);
  const sign = CREDIT_NORMAL.has(a.type) ? -1n : 1n;
  const open = (await tx.query(
    `SELECT coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint AS b
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = $1 AND e.entry_date < $2`,
    [a.id, from],
  )).rows[0].b as bigint;
  const { rows } = await tx.query(
    `SELECT e.entry_date, e.id, e.entry_number, e.source_type, e.memo, l.description, l.debit_minor, l.credit_minor
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.account_id = $1 AND e.entry_date BETWEEN $2 AND $3
      ORDER BY e.entry_date, e.entry_number, l.line_no LIMIT 10000`,
    [a.id, from, to],
  );
  let run = open * sign;
  const lines = rows.map((r) => {
    run += ((r.debit_minor as bigint) - (r.credit_minor as bigint)) * sign;
    return {
      date: r.entry_date, entryId: r.id, entryNumber: r.entry_number, sourceType: r.source_type, memo: r.memo,
      description: r.description, debitMinor: r.debit_minor, creditMinor: r.credit_minor, balanceMinor: run,
    };
  });
  return { account: { code: a.code, name: a.name, type: a.type }, from, to, openingMinor: open * sign, lines, closingMinor: run };
}

/** Every account with an opening balance or activity in the range, one ledger each, in code order. */
export async function generalLedgerAll(tx: Tx, entityId: string, from: string, to: string): Promise<GeneralLedger[]> {
  if (from > to) throw new LedgerError("INVALID", "the start date is after the end date");
  const { rows } = await tx.query(
    `SELECT DISTINCT a.code FROM accounts a
       JOIN journal_lines l ON l.account_id = a.id JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.entity_id = $1 AND e.entry_date <= $2
      ORDER BY a.code`,
    [entityId, to],
  );
  const out: GeneralLedger[] = [];
  for (const r of rows) {
    const gl = await generalLedger(tx, entityId, r.code, from, to);
    if (gl.lines.length || gl.openingMinor !== 0n) out.push(gl);
  }
  return out;
}

// --------------------------------------------------------------------- CSV

const money = (m: bigint) => toMajor(m).toFixed(2);
const cell = csvCell;

export function profitAndLossCsv(pl: ProfitAndLoss): string {
  const out = [`Profit and loss,${pl.from} to ${pl.to}`, "Section,Account,Name,Amount"];
  for (const s of pl.sections) {
    for (const r of s.rows) out.push([cell(s.label), r.code, cell(r.name), money(r.amountMinor)].join(","));
    out.push([cell(`Total ${s.label.toLowerCase()}`), "", "", money(s.totalMinor)].join(","));
  }
  out.push(`Gross profit,,,${money(pl.grossProfitMinor)}`, `Operating income,,,${money(pl.operatingIncomeMinor)}`, `Net income,,,${money(pl.netIncomeMinor)}`);
  return out.join("\n") + "\n";
}

export function balanceSheetCsv(bs: BalanceSheet): string {
  const out = [`Balance sheet,as of ${bs.asOf}`, "Section,Account,Name,Amount"];
  for (const s of bs.sections) {
    for (const r of s.rows) out.push([cell(s.label), r.code, cell(r.name), money(r.amountMinor)].join(","));
    if (s.key === "equity") {
      out.push(`Equity,,Prior years' earnings,${money(bs.priorYearsEarningsMinor)}`, `Equity,,Current year earnings,${money(bs.currentYearEarningsMinor)}`);
    }
  }
  out.push(`Total assets,,,${money(bs.totalAssetsMinor)}`, `Total liabilities,,,${money(bs.totalLiabilitiesMinor)}`, `Total equity,,,${money(bs.totalEquityMinor)}`);
  return out.join("\n") + "\n";
}

export function generalLedgerCsv(gl: GeneralLedger | GeneralLedger[]): string {
  const all = Array.isArray(gl);
  const ledgers = all ? gl : [gl];
  const head = all
    ? [`General ledger,all accounts,${ledgers[0]?.from ?? ""} to ${ledgers[0]?.to ?? ""}`, "Account,Name,Date,Entry,Type,Memo,Description,Debit,Credit,Balance"]
    : [`General ledger,${gl.account.code} ${cell(gl.account.name)},${gl.from} to ${gl.to}`, "Date,Entry,Type,Memo,Description,Debit,Credit,Balance"];
  const out = [...head];
  for (const g of ledgers) {
    const pre = all ? [g.account.code, cell(g.account.name)] : [];
    out.push([...pre, g.from, "", "", "Opening balance", "", "", "", money(g.openingMinor)].join(","));
    for (const l of g.lines) {
      out.push([...pre, l.date, String(l.entryNumber), l.sourceType, cell(l.memo), cell(l.description),
        l.debitMinor ? money(l.debitMinor) : "", l.creditMinor ? money(l.creditMinor) : "", money(l.balanceMinor)].join(","));
    }
  }
  return out.join("\n") + "\n";
}

// ------------------------------------------------------------------ health

export interface HealthCheck {
  key: string;
  ok: boolean;
  /** Warnings are good practice; the rest point at something wrong in the books. */
  warn: boolean;
  title: string;
  detail: string;
  /** Screen that fixes it. */
  go?: string;
}

/** Bookkeeping hygiene checks. Not a compliance determination. */
export async function booksHealth(tx: Tx, entityId: string, today: string): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  const fmt = (m: bigint) => `$${toMajor(m < 0n ? -m : m).toFixed(2)}`;
  const tb = (await tx.query(
    "SELECT coalesce(sum(debit_minor), 0)::bigint AS dr, coalesce(sum(credit_minor), 0)::bigint AS cr FROM journal_lines WHERE entity_id = $1",
    [entityId],
  )).rows[0];
  out.push({ key: "trial_balance", ok: tb.dr === tb.cr, warn: false, title: "Trial balance is in balance",
    detail: tb.dr === tb.cr ? `Debits and credits both total ${fmt(tb.dr)}.` : `Off by ${fmt((tb.dr as bigint) - (tb.cr as bigint))}.`, go: "trial-balance" });
  const bs = await balanceSheet(tx, entityId, today);
  out.push({ key: "balance_sheet", ok: bs.balanced, warn: false, title: "Balance sheet balances", detail: "Assets equal liabilities plus equity.", go: "reports" });

  const review = (await tx.query("SELECT count(*)::int AS n FROM bank_lines WHERE entity_id = $1 AND status = 'new'", [entityId])).rows[0].n;
  out.push({ key: "bank_review", ok: review === 0, warn: false, title: "Bank lines reviewed",
    detail: review ? `${review} imported bank line${review === 1 ? "" : "s"} still need recording.` : "Every imported bank line is recorded or excluded.", go: "bank" });

  const stale = (await tx.query(
    `SELECT a.code, a.name, max(r.statement_date) AS last
       FROM accounts a
       LEFT JOIN reconciliations r ON r.bank_account_id = a.id
      WHERE a.entity_id = $1 AND a.subtype = 'bank' AND a.is_active
        AND EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id = a.id)
      GROUP BY a.code, a.name
     HAVING max(r.statement_date) IS NULL OR max(r.statement_date) < ($2::date - 45)`,
    [entityId, today],
  )).rows;
  out.push({ key: "reconciled", ok: !stale.length, warn: false, title: "Bank accounts reconciled within 45 days",
    detail: stale.length ? `${stale.map((s) => `${s.code} ${s.name}`).join(", ")} need${stale.length === 1 ? "s" : ""} reconciling.` : "Every bank account in use is up to date.", go: "reconcile" });

  const overdue = (await tx.query(
    `SELECT count(*)::int AS n FROM documents d
      WHERE d.entity_id = $1 AND d.kind = 'invoice' AND d.status = 'issued' AND d.due_date < $2
        AND d.total_minor > coalesce((SELECT sum(amount_minor) FROM document_payments p WHERE p.document_id = d.id), 0)`,
    [entityId, today],
  )).rows[0].n;
  out.push({ key: "overdue_invoices", ok: overdue === 0, warn: true, title: "No overdue invoices",
    detail: overdue ? `${overdue} invoice${overdue === 1 ? " is" : "s are"} past due.` : "Customers are paying on time.", go: "invoices" });

  const openOld = (await tx.query(
    "SELECT count(*)::int AS n FROM periods WHERE entity_id = $1 AND status = 'open' AND end_date < date_trunc('month', $2::date) - interval '1 month'",
    [entityId, today],
  )).rows[0].n;
  out.push({ key: "periods_closed", ok: openOld === 0, warn: true, title: "Past months closed",
    detail: openOld ? `${openOld} month${openOld === 1 ? " is" : "s are"} still open more than a month after they ended. Close each month after reconciling so past figures can't change.` : "Past months are closed.", go: "periods" });

  const ein = (await tx.query("SELECT ein FROM entities WHERE id = $1", [entityId])).rows[0]?.ein;
  out.push({ key: "ein", ok: Boolean(ein), warn: true, title: "EIN on file",
    detail: ein ? "Recorded for this business." : "Add the business's EIN so it appears on prepared forms and exports." });
  return out;
}
