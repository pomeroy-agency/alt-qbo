import type { Tx } from "../db/pool.js";
import { appendAudit } from "./audit.js";
import { recordPayment, type DocumentKind } from "./documents.js";
import { LedgerError, translateDbError } from "./errors.js";
import { postJournal, reverseEntry, type Actor, type Role } from "./ledger.js";

// Bank statement import (CSV) and review: each imported line is categorised
// to an account, matched to an open invoice or bill, or excluded. Ported from
// Ledgerline, with duplicates and double-recording refused by the database.

const CAN_WRITE: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];
export const MAX_CSV_BYTES = 2_000_000;
export const MAX_CSV_ROWS = 5000;

function requireWriter(actor: Actor, what: string) {
  if (!CAN_WRITE.includes(actor.role)) throw new LedgerError("FORBIDDEN", `role ${actor.role} cannot ${what}`);
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    translateDbError(err);
  }
}

// ------------------------------------------------------------------ parsing

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF or LF. Blank rows dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** "2026-03-01", "3/1/2026" or "3/1/26" (month first for US banks) to YYYY-MM-DD; null if unreadable. */
export function parseStatementDate(s: string, order: "MDY" | "DMY" = "MDY"): string | null {
  s = (s ?? "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  let y: string, mo: string, d: string;
  if (m) [, y, mo, d] = m as unknown as [string, string, string, string];
  else {
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
    if (!m) return null;
    const [, a, b, yy] = m as unknown as [string, string, string, string];
    y = yy.length === 2 ? `20${yy}` : yy;
    [mo, d] = order === "MDY" ? [a, b] : [b, a];
  }
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** "1,234.50", "$45", "(45.00)", "-3", "12.3" to signed cents; null if unreadable. */
export function parseStatementAmount(v: string): bigint | null {
  let s = (v ?? "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1).trim(); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1).trim(); }
  s = s.replace(/^[$€£]/, "").replace(/,/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const cents = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -cents : cents;
}

export interface StatementRow {
  row: number;
  date: string;
  description: string;
  amountMinor: bigint;
}

/**
 * Reads a statement CSV with a header row and either one Amount column or
 * separate Debit/Withdrawal and Credit/Deposit columns. Without a header it
 * assumes Date, Description, Amount.
 */
export function readStatement(text: string, order: "MDY" | "DMY" = "MDY"): { rows: StatementRow[]; unreadable: number[] } {
  const all = parseCsv(text);
  if (!all.length) throw new LedgerError("INVALID", "the file is empty");
  if (all.length > MAX_CSV_ROWS + 1) throw new LedgerError("INVALID", `a statement can have at most ${MAX_CSV_ROWS} rows; split the file`);
  const head = all[0]!.map((h) => h.trim().toLowerCase());
  const find = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  let iDate = find("date");
  let iDesc = find("desc", "memo", "payee", "detail", "narrative", "name");
  let iAmt = find("amount");
  const iOut = find("withdraw", "debit", "paid out", "money out");
  const iIn = find("deposit", "credit", "paid in", "money in");
  let body = all.slice(1), first = 2;
  if (iDate < 0) { iDate = 0; iDesc = 1; iAmt = 2; body = all; first = 1; }
  if (iAmt < 0 && iOut < 0 && iIn < 0) throw new LedgerError("INVALID", "could not find an Amount column, or Debit and Credit columns");
  const rows: StatementRow[] = [], unreadable: number[] = [];
  body.forEach((r, n) => {
    const date = parseStatementDate(r[iDate] ?? "", order);
    let amount: bigint | null;
    if (iAmt >= 0) amount = parseStatementAmount(r[iAmt] ?? "");
    else {
      const out = (r[iOut] ?? "").trim() ? parseStatementAmount(r[iOut]!) : 0n;
      const inn = iIn >= 0 && (r[iIn] ?? "").trim() ? parseStatementAmount(r[iIn]!) : 0n;
      amount = out === null || inn === null ? null : inn - (out < 0n ? -out : out);
    }
    const description = ((iDesc >= 0 ? r[iDesc] : "") ?? "").trim().replace(/\s+/g, " ").slice(0, 300) || "Bank transaction";
    if (!date || amount === null || amount === 0n) { unreadable.push(n + first); return; }
    rows.push({ row: n + first, date, description, amountMinor: amount });
  });
  return { rows, unreadable };
}

// ------------------------------------------------------------------- import

async function bankAccount(tx: Tx, entityId: string, key: string) {
  const { rows } = await tx.query(
    "SELECT id, code, name, subtype, is_active FROM accounts WHERE entity_id = $1 AND (code = $2 OR system_key = $2)",
    [entityId, key],
  );
  const a = rows[0];
  if (!a || a.subtype !== "bank") throw new LedgerError("INVALID", `${key} is not a bank account`);
  if (!a.is_active) throw new LedgerError("INACTIVE_ACCOUNT", `account ${a.code} is inactive`);
  return a as { id: string; code: string; name: string };
}

export interface ImportResult {
  importId: string;
  added: number;
  duplicates: number;
  unreadableRows: number[];
}

/**
 * Imports a statement into a bank account. A row seen before for that
 * account (same date, amount, description and repeat count within the file)
 * is skipped, so overlapping statements can be imported safely.
 */
export async function importBankCsv(
  tx: Tx,
  input: { orgId: string; entityId: string; bankAccount: string; csv: string; fileName?: string; actor: Actor },
): Promise<ImportResult> {
  requireWriter(input.actor, "import bank statements");
  if (Buffer.byteLength(input.csv) > MAX_CSV_BYTES) throw new LedgerError("INVALID", "the file is larger than 2 MB; split it");
  const acct = await bankAccount(tx, input.entityId, input.bankAccount);
  const { rows, unreadable } = readStatement(input.csv, "MDY");

  const seen = new Map<string, number>();
  const keyed = rows.map((r) => {
    const base = `${r.date}|${r.amountMinor}|${r.description.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, key: `${base}|${n}` };
  });
  const existing = new Set<string>(keyed.length
    ? (await tx.query("SELECT dedupe_key FROM bank_lines WHERE bank_account_id = $1 AND dedupe_key = ANY($2)", [acct.id, keyed.map((k) => k.key)])).rows.map((r) => r.dedupe_key)
    : []);
  const fresh = keyed.filter((k) => !existing.has(k.key));

  const imp = await run(() => tx.query(
    `INSERT INTO bank_imports (org_id, entity_id, bank_account_id, file_name, added, duplicates, unreadable, imported_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.orgId, input.entityId, acct.id, (input.fileName ?? "").slice(0, 200), fresh.length, keyed.length - fresh.length, unreadable.length, input.actor.id],
  ));
  const importId: string = imp.rows[0].id;
  for (const r of fresh) {
    await run(() => tx.query(
      `INSERT INTO bank_lines (org_id, entity_id, bank_account_id, import_id, txn_date, description, amount_minor, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.orgId, input.entityId, acct.id, importId, r.date, r.description, r.amountMinor, r.key],
    ));
  }
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "bank.imported",
    objectType: "bank_import", objectId: importId,
    after: { bankAccount: acct.code, fileName: input.fileName ?? "", added: fresh.length, duplicates: keyed.length - fresh.length, unreadableRows: unreadable },
    context: { role: input.actor.role },
  });
  return { importId, added: fresh.length, duplicates: keyed.length - fresh.length, unreadableRows: unreadable };
}

// ------------------------------------------------------------------- review

export type BankLineStatus = "new" | "posted" | "excluded";

export interface Suggestion {
  kind: "invoice" | "bill" | "account";
  documentId?: string;
  account?: string;
  label: string;
}

export interface BankLine {
  id: string;
  bankAccount: string;
  date: string;
  description: string;
  amountMinor: bigint;
  status: BankLineStatus;
  entryId: string | null;
  categoryAccount: string | null;
  documentId: string | null;
  documentNumber: string | null;
  decidedBy: string | null;
  suggestion: Suggestion | null;
}

const firstWord = (s: string) => s.toLowerCase().split(/\s+/)[0] ?? "";

/** Lines for review, newest first, each unrecorded line with a suggested match. */
export async function listBankLines(
  tx: Tx,
  input: { entityId: string; bankAccount?: string; status?: BankLineStatus; limit?: number },
): Promise<BankLine[]> {
  const acct = input.bankAccount ? await bankAccount(tx, input.entityId, input.bankAccount) : null;
  const { rows } = await tx.query(
    `SELECT b.id, a.code AS bank_code, b.txn_date, b.description, b.amount_minor, b.status, b.entry_id,
            c.code AS category_code, b.document_id, d.number AS document_number, b.decided_by
       FROM bank_lines b
       JOIN accounts a ON a.id = b.bank_account_id
       LEFT JOIN accounts c ON c.id = b.category_account_id
       LEFT JOIN documents d ON d.id = b.document_id
      WHERE b.entity_id = $1 AND ($2::uuid IS NULL OR b.bank_account_id = $2) AND ($3::text IS NULL OR b.status = $3)
      ORDER BY b.txn_date DESC, b.created_at DESC LIMIT $4`,
    [input.entityId, acct?.id ?? null, input.status ?? null, Math.min(input.limit ?? 500, 2000)],
  );
  const lines: BankLine[] = rows.map((r) => ({
    id: r.id, bankAccount: r.bank_code, date: r.txn_date, description: r.description, amountMinor: r.amount_minor,
    status: r.status, entryId: r.entry_id, categoryAccount: r.category_code, documentId: r.document_id,
    documentNumber: r.document_number, decidedBy: r.decided_by, suggestion: null,
  }));
  if (!lines.some((l) => l.status === "new")) return lines;

  // Open documents by amount still due, and past categorisations by first word of the description.
  const open = (await tx.query(
    `SELECT d.id, d.kind, d.number, d.issue_date, c.name, d.total_minor - coalesce((SELECT sum(amount_minor) FROM document_payments p WHERE p.document_id = d.id), 0)::bigint AS due
       FROM documents d JOIN contacts c ON c.id = d.contact_id
      WHERE d.entity_id = $1 AND d.status = 'issued' ORDER BY d.due_date`,
    [input.entityId],
  )).rows.filter((d) => d.due > 0n);
  const past = (await tx.query(
    `SELECT b.description, c.code FROM bank_lines b JOIN accounts c ON c.id = b.category_account_id
      WHERE b.entity_id = $1 AND b.status = 'posted' ORDER BY b.decided_at DESC LIMIT 2000`,
    [input.entityId],
  )).rows;
  const byWord = new Map<string, { code: string; description: string }>();
  for (const p of past) if (!byWord.has(firstWord(p.description))) byWord.set(firstWord(p.description), { code: p.code, description: p.description });
  const used = new Set<string>();
  for (const l of lines) {
    if (l.status !== "new") continue;
    const kind: DocumentKind = l.amountMinor > 0n ? "invoice" : "bill";
    const abs = l.amountMinor < 0n ? -l.amountMinor : l.amountMinor;
    const doc = open.find((d) => d.kind === kind && d.due === abs && d.issue_date <= l.date && !used.has(d.id));
    if (doc) {
      used.add(doc.id);
      l.suggestion = { kind, documentId: doc.id, label: `${kind === "invoice" ? "Payment from" : "Payment to"} ${doc.name} for ${doc.number}` };
      continue;
    }
    const prior = byWord.get(firstWord(l.description));
    if (prior) l.suggestion = { kind: "account", account: prior.code, label: `Same as earlier "${prior.description}"` };
  }
  return lines;
}

async function lockLine(tx: Tx, entityId: string, lineId: string) {
  const { rows } = await tx.query(
    `SELECT b.*, a.code AS bank_code FROM bank_lines b JOIN accounts a ON a.id = b.bank_account_id
      WHERE b.id = $1 AND b.entity_id = $2 FOR UPDATE OF b`,
    [lineId, entityId],
  );
  if (!rows[0]) throw new LedgerError("INVALID", "bank line not found");
  return rows[0];
}

/** Records a bank line against an account: bank and category, either way round by sign. */
export async function categorizeBankLine(
  tx: Tx,
  input: { orgId: string; entityId: string; lineId: string; account: string; memo?: string; actor: Actor },
): Promise<BankLine> {
  requireWriter(input.actor, "record bank lines");
  const line = await lockLine(tx, input.entityId, input.lineId);
  if (line.status === "posted") throw new LedgerError("INVALID", "this bank line is already recorded");
  if (line.status === "excluded") throw new LedgerError("INVALID", "this bank line is excluded; restore it first");
  const cat = await tx.query(
    "SELECT id, code, system_key FROM accounts WHERE entity_id = $1 AND (code = $2 OR system_key = $2)",
    [input.entityId, input.account],
  );
  const c = cat.rows[0];
  if (!c) throw new LedgerError("UNKNOWN_ACCOUNT", `no account ${input.account} in this entity`);
  if (c.id === line.bank_account_id) throw new LedgerError("INVALID", "pick an account other than the bank account itself");
  if (["accounts_receivable", "accounts_payable"].includes(c.system_key)) {
    throw new LedgerError("INVALID", "to record a customer or vendor payment, match the line to its invoice or bill");
  }
  const amt: bigint = line.amount_minor < 0n ? -line.amount_minor : line.amount_minor;
  const memo = (input.memo?.trim() || line.description).slice(0, 300);
  // A line can be recorded again after an undo, so each attempt gets its own key.
  const attempt = (await tx.query(
    "SELECT count(*)::int AS n FROM journal_entries WHERE entity_id = $1 AND source_type = 'bank_line' AND source_id = $2",
    [input.entityId, line.id],
  )).rows[0].n;
  const entry = await postJournal(tx, {
    orgId: input.orgId, entityId: input.entityId, date: line.txn_date, memo, sourceType: "bank_line", sourceId: line.id,
    idempotencyKey: `bank_line:${line.id}:${attempt}`,
    actor: input.actor,
    lines: line.amount_minor > 0n
      ? [{ account: line.bank_code, debit: amt, description: line.description }, { account: c.code, credit: amt, description: line.description }]
      : [{ account: c.code, debit: amt, description: line.description }, { account: line.bank_code, credit: amt, description: line.description }],
  });
  await run(() => tx.query(
    "UPDATE bank_lines SET status = 'posted', entry_id = $2, category_account_id = $3, decided_by = $4, decided_at = now() WHERE id = $1",
    [line.id, entry.id, c.id, input.actor.id],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "bank_line.categorized",
    objectType: "bank_line", objectId: line.id, after: { account: c.code, entryId: entry.id, amount: line.amount_minor },
    context: { role: input.actor.role },
  });
  return (await listOne(tx, input.entityId, line.id));
}

/** Records a deposit as payment of an open invoice, or a withdrawal as payment of an open bill. */
export async function matchBankLine(
  tx: Tx,
  input: { orgId: string; entityId: string; lineId: string; documentId: string; actor: Actor },
): Promise<BankLine> {
  requireWriter(input.actor, "record bank lines");
  const line = await lockLine(tx, input.entityId, input.lineId);
  if (line.status !== "new") throw new LedgerError("INVALID", line.status === "posted" ? "this bank line is already recorded" : "this bank line is excluded; restore it first");
  const d = await tx.query("SELECT id, kind, number FROM documents WHERE id = $1 AND entity_id = $2", [input.documentId, input.entityId]);
  const doc = d.rows[0];
  if (!doc) throw new LedgerError("INVALID", "invoice or bill not found");
  if ((line.amount_minor > 0n) !== (doc.kind === "invoice")) {
    throw new LedgerError("INVALID", line.amount_minor > 0n ? "a deposit can only pay an invoice" : "a withdrawal can only pay a bill");
  }
  const amt: bigint = line.amount_minor < 0n ? -line.amount_minor : line.amount_minor;
  await recordPayment(tx, {
    orgId: input.orgId, entityId: input.entityId, documentId: doc.id, date: line.txn_date, amount: amt,
    bankAccount: line.bank_code, idempotencyKey: `bank_line:${line.id}`, actor: input.actor,
  });
  const entryId: string = (await tx.query(
    "SELECT entry_id FROM document_payments WHERE entity_id = $1 AND idempotency_key = $2",
    [input.entityId, `payment:bank_line:${line.id}`],
  )).rows[0].entry_id;
  await run(() => tx.query(
    "UPDATE bank_lines SET status = 'posted', entry_id = $2, document_id = $3, decided_by = $4, decided_at = now() WHERE id = $1",
    [line.id, entryId, doc.id, input.actor.id],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "bank_line.matched",
    objectType: "bank_line", objectId: line.id, after: { documentId: doc.id, number: doc.number, entryId, amount: line.amount_minor },
    context: { role: input.actor.role },
  });
  return listOne(tx, input.entityId, line.id);
}

/** Excludes an unrecorded line (a duplicate, or something kept off the books), or restores it. */
export async function setBankLineExcluded(
  tx: Tx,
  input: { orgId: string; entityId: string; lineId: string; excluded: boolean; actor: Actor },
): Promise<BankLine> {
  requireWriter(input.actor, "review bank lines");
  const line = await lockLine(tx, input.entityId, input.lineId);
  if (line.status === "posted") throw new LedgerError("INVALID", "this bank line is already recorded");
  const to = input.excluded ? "excluded" : "new";
  if (line.status !== to) {
    await run(() => tx.query(
      "UPDATE bank_lines SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1",
      [line.id, to, input.excluded ? input.actor.id : null],
    ));
    await appendAudit(tx, {
      orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: input.excluded ? "bank_line.excluded" : "bank_line.restored",
      objectType: "bank_line", objectId: line.id, before: { status: line.status }, after: { status: to },
      context: { role: input.actor.role },
    });
  }
  return listOne(tx, input.entityId, line.id);
}

/** Undoes a categorised line: reverses its entry and puts it back in the review queue. */
export async function undoBankLine(
  tx: Tx,
  input: { orgId: string; entityId: string; lineId: string; date: string; reason: string; actor: Actor },
): Promise<BankLine> {
  requireWriter(input.actor, "review bank lines");
  const line = await lockLine(tx, input.entityId, input.lineId);
  if (line.status !== "posted") throw new LedgerError("INVALID", "this bank line isn't recorded");
  if (line.document_id) throw new LedgerError("INVALID", "this line paid an invoice or bill; undoing payments isn't supported yet");
  const reversal = await reverseEntry(tx, { orgId: input.orgId, entryId: line.entry_id, date: input.date, reason: input.reason, actor: input.actor });
  await run(() => tx.query(
    "UPDATE bank_lines SET status = 'new', entry_id = NULL, category_account_id = NULL, decided_by = NULL, decided_at = NULL WHERE id = $1",
    [line.id],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "bank_line.undone",
    objectType: "bank_line", objectId: line.id, before: { status: "posted", entryId: line.entry_id }, after: { status: "new", reversalEntryId: reversal.id },
    context: { role: input.actor.role, reason: input.reason },
  });
  return listOne(tx, input.entityId, line.id);
}

async function listOne(tx: Tx, entityId: string, lineId: string): Promise<BankLine> {
  const { rows } = await tx.query(
    `SELECT b.id, a.code AS bank_code, b.txn_date, b.description, b.amount_minor, b.status, b.entry_id,
            c.code AS category_code, b.document_id, d.number AS document_number, b.decided_by
       FROM bank_lines b JOIN accounts a ON a.id = b.bank_account_id
       LEFT JOIN accounts c ON c.id = b.category_account_id LEFT JOIN documents d ON d.id = b.document_id
      WHERE b.id = $1 AND b.entity_id = $2`,
    [lineId, entityId],
  );
  const r = rows[0];
  return {
    id: r.id, bankAccount: r.bank_code, date: r.txn_date, description: r.description, amountMinor: r.amount_minor,
    status: r.status, entryId: r.entry_id, categoryAccount: r.category_code, documentId: r.document_id,
    documentNumber: r.document_number, decidedBy: r.decided_by, suggestion: null,
  };
}
