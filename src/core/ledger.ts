import { createHash } from "node:crypto";
import type { Tx } from "../db/pool.js";
import { appendAudit, canonicalJson } from "./audit.js";
import { LedgerError, translateDbError } from "./errors.js";
import { parseMoney } from "./money.js";

export type Role = "owner" | "admin" | "bookkeeper" | "approver" | "accountant" | "read_only" | "system";

export interface Actor {
  id: string;
  role: Role;
}

const CAN_POST: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];
const CAN_CLOSE: Role[] = ["owner", "admin", "accountant"];
const CAN_REOPEN: Role[] = ["owner", "accountant"];

export type SourceType =
  | "journal_voucher" | "invoice" | "bill" | "bank_line" | "payment" | "pay_run" | "reversal" | "opening_balance";

export interface LineInput {
  /** Account code ("1000") or system key ("cash_operating"). */
  account: string;
  /** Major units as a decimal string ("125.00"), or minor units as a bigint. */
  debit?: string | bigint;
  credit?: string | bigint;
  currency?: string;
  description?: string;
  dimensions?: { class?: string; location?: string; project?: string };
}

export interface PostInput {
  orgId: string;
  entityId: string;
  date: string;
  memo?: string;
  sourceType: SourceType;
  sourceId?: string;
  /** Unique per entity and origin record; a replay with the same key returns the original entry. */
  idempotencyKey: string;
  lines: LineInput[];
  actor: Actor;
  /** Internal: set by reverseEntry. */
  reversesEntryId?: string;
}

export interface PostedLine {
  lineNo: number;
  accountId: string;
  accountCode: string;
  currency: string;
  debitMinor: bigint;
  creditMinor: bigint;
  description: string;
  dimensions: Record<string, string>;
}

export interface PostedEntry {
  id: string;
  entityId: string;
  entryNumber: bigint;
  date: string;
  periodId: string;
  memo: string;
  sourceType: SourceType;
  sourceId: string | null;
  idempotencyKey: string;
  reversesEntryId: string | null;
  postedBy: string;
  lines: PostedLine[];
  /** True when this call found an existing entry for the idempotency key instead of posting. */
  replayed: boolean;
}

function requireRole(actor: Actor, allowed: Role[], what: string): void {
  if (!allowed.includes(actor.role)) {
    throw new LedgerError("FORBIDDEN", `role ${actor.role} cannot ${what}`);
  }
}

function toMinorAmount(v: string | bigint | undefined, currency: string): bigint {
  if (v === undefined) return 0n;
  if (typeof v === "bigint") return v;
  return parseMoney(v, currency).minor;
}

interface NormalisedLine {
  accountId: string;
  accountCode: string;
  currency: string;
  debitMinor: bigint;
  creditMinor: bigint;
  description: string;
  dimensions: Record<string, string>;
}

async function normaliseLines(tx: Tx, entityId: string, lines: LineInput[], defaultCurrency: string) {
  if (lines.length < 2) throw new LedgerError("UNBALANCED", "an entry needs at least two lines");
  const { rows } = await tx.query(
    "SELECT id, code, system_key, is_active FROM accounts WHERE entity_id = $1",
    [entityId],
  );
  const byKey = new Map<string, { id: string; code: string; is_active: boolean }>();
  for (const r of rows) {
    byKey.set(r.code, r);
    if (r.system_key) byKey.set(r.system_key, r);
  }
  const out: NormalisedLine[] = [];
  const totals = new Map<string, bigint>();
  for (const [i, l] of lines.entries()) {
    const acct = byKey.get(l.account);
    if (!acct) throw new LedgerError("UNKNOWN_ACCOUNT", `line ${i + 1}: no account ${l.account} in this entity`);
    if (!acct.is_active) throw new LedgerError("INACTIVE_ACCOUNT", `line ${i + 1}: account ${acct.code} is inactive`);
    const currency = l.currency ?? defaultCurrency;
    const debitMinor = toMinorAmount(l.debit, currency);
    const creditMinor = toMinorAmount(l.credit, currency);
    if (debitMinor < 0n || creditMinor < 0n || (debitMinor === 0n) === (creditMinor === 0n)) {
      throw new LedgerError("INVALID", `line ${i + 1}: give a positive debit or a positive credit, not both`);
    }
    totals.set(currency, (totals.get(currency) ?? 0n) + debitMinor - creditMinor);
    const dimensions: Record<string, string> = {};
    for (const [k, v] of Object.entries(l.dimensions ?? {})) if (v) dimensions[k] = v;
    out.push({ accountId: acct.id, accountCode: acct.code, currency, debitMinor, creditMinor,
      description: l.description ?? "", dimensions });
  }
  for (const [currency, net] of totals) {
    if (net !== 0n) throw new LedgerError("UNBALANCED", `debits and credits differ by ${net} minor units in ${currency}`);
  }
  return out;
}

function contentHash(input: PostInput, lines: NormalisedLine[]): string {
  return createHash("sha256")
    .update(canonicalJson({
      date: input.date,
      memo: input.memo ?? "",
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      reversesEntryId: input.reversesEntryId ?? null,
      lines: lines.map((l) => ({ a: l.accountId, c: l.currency, d: l.debitMinor, k: l.creditMinor,
        t: l.description, x: l.dimensions })),
    }))
    .digest("hex");
}

/**
 * The only way anything writes to the ledger. Validates, assigns the next
 * gapless entry number, posts, and records the audit event, all in the
 * caller's transaction. The database re-checks balance, period and
 * immutability rules at commit.
 */
export async function postJournal(tx: Tx, input: PostInput): Promise<PostedEntry> {
  requireRole(input.actor, CAN_POST, "post journal entries");
  if (!input.idempotencyKey) throw new LedgerError("INVALID", "idempotencyKey is required");

  const ent = await tx.query("SELECT functional_currency FROM entities WHERE id = $1", [input.entityId]);
  if (!ent.rows[0]) throw new LedgerError("INVALID", `entity ${input.entityId} not found`);
  const lines = await normaliseLines(tx, input.entityId, input.lines, ent.rows[0].functional_currency.trim());
  const hash = contentHash(input, lines);

  const existing = await tx.query(
    "SELECT id, content_hash FROM journal_entries WHERE entity_id = $1 AND idempotency_key = $2",
    [input.entityId, input.idempotencyKey],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].content_hash !== hash) {
      throw new LedgerError("IDEMPOTENCY_CONFLICT",
        `idempotency key ${input.idempotencyKey} was already used for a different entry`);
    }
    return { ...(await getEntry(tx, existing.rows[0].id)), replayed: true };
  }

  const period = await tx.query(
    "SELECT id, status FROM periods WHERE entity_id = $1 AND $2::date BETWEEN start_date AND end_date",
    [input.entityId, input.date],
  );
  const p = period.rows[0];
  if (!p) throw new LedgerError("NO_PERIOD", `no accounting period covers ${input.date}`);
  if (p.status === "locked") throw new LedgerError("PERIOD_LOCKED", `the period covering ${input.date} is locked`);
  if (p.status === "soft_closed") requireRole(input.actor, CAN_CLOSE, "post into a soft-closed period");

  try {
    const num = await tx.query(
      "UPDATE entities SET next_entry_number = next_entry_number + 1 WHERE id = $1 RETURNING next_entry_number - 1 AS n",
      [input.entityId],
    );
    const entryNumber: bigint = num.rows[0].n;
    const { rows } = await tx.query(
      `INSERT INTO journal_entries (org_id, entity_id, entry_number, entry_date, period_id, memo,
          source_type, source_id, idempotency_key, content_hash, reverses_entry_id, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [input.orgId, input.entityId, entryNumber, input.date, p.id, input.memo ?? "", input.sourceType,
       input.sourceId ?? null, input.idempotencyKey, hash, input.reversesEntryId ?? null, input.actor.id],
    );
    const entryId: string = rows[0].id;
    for (const [i, l] of lines.entries()) {
      await tx.query(
        `INSERT INTO journal_lines (org_id, entity_id, entry_id, line_no, account_id, currency,
            debit_minor, credit_minor, description, dimensions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [input.orgId, input.entityId, entryId, i + 1, l.accountId, l.currency, l.debitMinor,
         l.creditMinor, l.description, JSON.stringify(l.dimensions)],
      );
    }
    const entry = await getEntry(tx, entryId);
    await appendAudit(tx, {
      orgId: input.orgId,
      entityId: input.entityId,
      actor: input.actor.id,
      action: input.reversesEntryId ? "journal.reversed" : "journal.posted",
      objectType: "journal_entry",
      objectId: entryId,
      after: { ...entry, replayed: undefined },
      context: { role: input.actor.role, contentHash: hash },
    });
    return entry;
  } catch (err) {
    translateDbError(err);
  }
}

export async function getEntry(tx: Tx, entryId: string): Promise<PostedEntry> {
  const e = await tx.query(
    `SELECT id, entity_id, entry_number, entry_date, period_id, memo, source_type, source_id,
            idempotency_key, reverses_entry_id, posted_by
       FROM journal_entries WHERE id = $1`,
    [entryId],
  );
  const r = e.rows[0];
  if (!r) throw new LedgerError("INVALID", `journal entry ${entryId} not found`);
  const l = await tx.query(
    `SELECT l.line_no, l.account_id, a.code, l.currency, l.debit_minor, l.credit_minor, l.description, l.dimensions
       FROM journal_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.entry_id = $1 ORDER BY l.line_no`,
    [entryId],
  );
  return {
    id: r.id,
    entityId: r.entity_id,
    entryNumber: r.entry_number,
    date: r.entry_date,
    periodId: r.period_id,
    memo: r.memo,
    sourceType: r.source_type,
    sourceId: r.source_id,
    idempotencyKey: r.idempotency_key,
    reversesEntryId: r.reverses_entry_id,
    postedBy: r.posted_by,
    replayed: false,
    lines: l.rows.map((x) => ({
      lineNo: x.line_no,
      accountId: x.account_id,
      accountCode: x.code,
      currency: x.currency.trim(),
      debitMinor: x.debit_minor,
      creditMinor: x.credit_minor,
      description: x.description,
      dimensions: x.dimensions,
    })),
  };
}

/**
 * Corrects a posted entry the only way the ledger allows: a new entry that
 * swaps every debit and credit and points back at the original.
 */
export async function reverseEntry(
  tx: Tx,
  input: { orgId: string; entryId: string; date: string; reason: string; actor: Actor },
): Promise<PostedEntry> {
  if (!input.reason.trim()) throw new LedgerError("INVALID", "a reversal needs a reason");
  const original = await getEntry(tx, input.entryId);
  if (original.sourceType === "reversal") throw new LedgerError("INVALID", "a reversal cannot itself be reversed; post a new entry");
  const already = await tx.query("SELECT 1 FROM journal_entries WHERE reverses_entry_id = $1", [input.entryId]);
  if (already.rows[0]) throw new LedgerError("ALREADY_REVERSED", `entry ${original.entryNumber} has already been reversed`);
  return postJournal(tx, {
    orgId: input.orgId,
    entityId: original.entityId,
    date: input.date,
    memo: `Reversal of entry ${original.entryNumber}: ${input.reason}`,
    sourceType: "reversal",
    sourceId: original.id,
    idempotencyKey: `reversal:${original.id}`,
    reversesEntryId: original.id,
    actor: input.actor,
    lines: original.lines.map((l) => ({
      account: l.accountCode,
      currency: l.currency,
      debit: l.creditMinor > 0n ? l.creditMinor : undefined,
      credit: l.debitMinor > 0n ? l.debitMinor : undefined,
      description: l.description,
      dimensions: l.dimensions,
    })),
  });
}

export type PeriodStatus = "open" | "soft_closed" | "locked";

/**
 * Moves a period through open -> soft_closed -> locked. Going backwards is a
 * reopen: it needs an owner or accountant and a reason, and is flagged in
 * the audit log so reports issued from the old figures can be identified.
 */
export async function setPeriodStatus(
  tx: Tx,
  input: { orgId: string; periodId: string; status: PeriodStatus; actor: Actor; reason?: string },
): Promise<void> {
  const { rows } = await tx.query(
    "SELECT id, entity_id, start_date, end_date, status FROM periods WHERE id = $1 FOR UPDATE",
    [input.periodId],
  );
  const p = rows[0];
  if (!p) throw new LedgerError("INVALID", `period ${input.periodId} not found`);
  const order: Record<PeriodStatus, number> = { open: 0, soft_closed: 1, locked: 2 };
  const from = p.status as PeriodStatus;
  if (from === input.status) return;
  const reopening = order[input.status] < order[from];
  if (reopening) {
    requireRole(input.actor, CAN_REOPEN, "reopen a period");
    if (!input.reason?.trim()) throw new LedgerError("INVALID", "reopening a period needs a reason");
  } else {
    requireRole(input.actor, CAN_CLOSE, "close or lock a period");
  }
  await tx.query("UPDATE periods SET status = $2 WHERE id = $1", [input.periodId, input.status]);
  await appendAudit(tx, {
    orgId: input.orgId,
    entityId: p.entity_id,
    actor: input.actor.id,
    action: reopening ? "period.reopened" : `period.${input.status}`,
    objectType: "period",
    objectId: p.id,
    before: { status: from },
    after: { status: input.status },
    context: {
      role: input.actor.role,
      range: `${p.start_date}..${p.end_date}`,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(reopening ? { flagIssuedReports: true } : {}),
    },
  });
}

export async function findPeriod(tx: Tx, entityId: string, date: string): Promise<{ id: string; status: PeriodStatus }> {
  const { rows } = await tx.query(
    "SELECT id, status FROM periods WHERE entity_id = $1 AND $2::date BETWEEN start_date AND end_date",
    [entityId, date],
  );
  if (!rows[0]) throw new LedgerError("NO_PERIOD", `no accounting period covers ${date}`);
  return rows[0];
}
