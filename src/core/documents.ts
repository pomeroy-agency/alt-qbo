import { createHash, randomUUID } from "node:crypto";
import type { Tx } from "../db/pool.js";
import { appendAudit, canonicalJson } from "./audit.js";
import { LedgerError, translateDbError } from "./errors.js";
import { getEntry, postJournal, reverseEntry, type Actor, type LineInput, type Role } from "./ledger.js";
import { D, parseMoney } from "./money.js";

// Invoices (receivables) and bills (payables). Each document posts its own
// journal entry in the same transaction it is issued in; the database checks
// at commit that the totals match the lines and that the entry carries the
// total to accounts receivable or payable.

export type DocumentKind = "invoice" | "bill";
export type ContactKind = "customer" | "vendor" | "both";
export type DocumentStatus = "open" | "partial" | "overdue" | "paid" | "void";

const CAN_WRITE: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];
const CONTROL = { invoice: "accounts_receivable", bill: "accounts_payable" } as const;

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

// --------------------------------------------------------------- contacts

export interface Contact {
  id: string;
  kind: ContactKind;
  name: string;
  email: string | null;
}

export async function createContact(
  tx: Tx,
  input: { orgId: string; entityId: string; kind: ContactKind; name: string; email?: string; actor: Actor },
): Promise<Contact> {
  requireWriter(input.actor, "add contacts");
  const name = input.name.trim();
  if (!name) throw new LedgerError("INVALID", "a contact needs a name");
  const dup = await tx.query("SELECT 1 FROM contacts WHERE entity_id = $1 AND lower(name) = lower($2)", [input.entityId, name]);
  if (dup.rows[0]) throw new LedgerError("INVALID", `there is already a contact named ${name}`);
  const { rows } = await run(() => tx.query(
    `INSERT INTO contacts (org_id, entity_id, kind, name, email) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, kind, name, email`,
    [input.orgId, input.entityId, input.kind, name, input.email?.trim().toLowerCase() || null],
  ));
  const contact = rows[0] as Contact;
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "contact.created",
    objectType: "contact", objectId: contact.id, after: contact,
  });
  return contact;
}

export async function listContacts(tx: Tx, entityId: string): Promise<Contact[]> {
  const { rows } = await tx.query("SELECT id, kind, name, email FROM contacts WHERE entity_id = $1 ORDER BY lower(name)", [entityId]);
  return rows;
}

// -------------------------------------------------------------- documents

export interface DocumentLineInput {
  /** Account code or system key: revenue for invoices, expense or asset for bills. */
  account: string;
  description?: string;
  /** Decimal string, up to four places ("1", "2.5"). */
  quantity: string;
  /** Major units ("125.00"). */
  unitPrice: string;
  taxable?: boolean;
}

export interface IssueDocumentInput {
  orgId: string;
  entityId: string;
  kind: DocumentKind;
  contactId: string;
  issueDate: string;
  dueDate?: string;
  memo?: string;
  /** Vendor's invoice number, for bills. */
  reference?: string;
  /** Invoices only. Basis points, entered by the user (725 = 7.25%). */
  taxRateBps?: number;
  lines: DocumentLineInput[];
  idempotencyKey: string;
  actor: Actor;
}

interface PricedLine {
  accountId: string;
  accountCode: string;
  description: string;
  quantity: string;
  unitPriceMinor: bigint;
  amountMinor: bigint;
  taxable: boolean;
  taxMinor: bigint;
}

/** Line amount = quantity x unit price; tax = rate on each taxable line. Both rounded half-up to the cent. */
export function priceLine(quantity: string, unitPriceMinor: bigint, taxable: boolean, taxRateBps: number) {
  const amountMinor = BigInt(new D(quantity).mul(unitPriceMinor.toString()).toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0));
  const taxMinor = taxable
    ? BigInt(new D(amountMinor.toString()).mul(taxRateBps).div(10000).toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0))
    : 0n;
  return { amountMinor, taxMinor };
}

function requestHash(input: IssueDocumentInput): string {
  return createHash("sha256").update(canonicalJson({
    kind: input.kind, contactId: input.contactId, issueDate: input.issueDate, dueDate: input.dueDate ?? null,
    memo: input.memo ?? "", reference: input.reference ?? null, taxRateBps: input.taxRateBps ?? 0, lines: input.lines,
  })).digest("hex");
}

/**
 * Issues an invoice or records a bill, and posts it: an invoice debits
 * receivables and credits revenue and sales tax; a bill debits its expense
 * or asset lines and credits payables.
 */
export async function issueDocument(tx: Tx, input: IssueDocumentInput): Promise<DocumentDetail> {
  requireWriter(input.actor, `create ${input.kind}s`);
  if (!input.idempotencyKey) throw new LedgerError("INVALID", "idempotencyKey is required");
  const key = `${input.kind}:${input.idempotencyKey}`;
  const hash = requestHash(input);
  const prior = await tx.query("SELECT id, memo FROM documents WHERE entity_id = $1 AND idempotency_key = $2", [input.entityId, key]);
  if (prior.rows[0]) {
    const doc = await getDocument(tx, prior.rows[0].id);
    if (doc.requestHash !== hash) {
      throw new LedgerError("IDEMPOTENCY_CONFLICT", `idempotency key ${input.idempotencyKey} was already used for a different ${input.kind}`);
    }
    return { ...doc, replayed: true };
  }

  const taxRateBps = input.kind === "invoice" ? input.taxRateBps ?? 0 : 0;
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10000) {
    throw new LedgerError("INVALID", "the tax rate must be between 0% and 100%");
  }
  if (!input.lines.length) throw new LedgerError("INVALID", `a ${input.kind} needs at least one line`);
  if (input.lines.length > 200) throw new LedgerError("INVALID", `a ${input.kind} can have at most 200 lines`);
  const dueDate = input.dueDate || input.issueDate;
  if (dueDate < input.issueDate) throw new LedgerError("INVALID", "the due date is before the issue date");

  const ent = await tx.query("SELECT functional_currency FROM entities WHERE id = $1", [input.entityId]);
  if (!ent.rows[0]) throw new LedgerError("INVALID", `entity ${input.entityId} not found`);
  const currency: string = ent.rows[0].functional_currency.trim();
  const contact = await tx.query("SELECT id, name, kind FROM contacts WHERE id = $1 AND entity_id = $2", [input.contactId, input.entityId]);
  if (!contact.rows[0]) throw new LedgerError("INVALID", `choose a ${input.kind === "invoice" ? "customer" : "vendor"}`);

  const accts = await tx.query("SELECT id, code, system_key FROM accounts WHERE entity_id = $1", [input.entityId]);
  const byKey = new Map<string, { id: string; code: string }>();
  for (const r of accts.rows) {
    byKey.set(r.code, r);
    if (r.system_key) byKey.set(r.system_key, r);
  }

  const lines: PricedLine[] = input.lines.map((l, i) => {
    const a = byKey.get(l.account);
    if (!a) throw new LedgerError("UNKNOWN_ACCOUNT", `line ${i + 1}: no account ${l.account} in this entity`);
    if (!/^\d+(\.\d{1,4})?$/.test(l.quantity) || new D(l.quantity).lte(0)) {
      throw new LedgerError("INVALID", `line ${i + 1}: quantity must be more than zero, up to four decimals`);
    }
    let unitPriceMinor: bigint;
    try {
      unitPriceMinor = parseMoney(l.unitPrice, currency).minor;
    } catch {
      throw new LedgerError("INVALID", `line ${i + 1}: price must be an amount like 125.00`);
    }
    if (unitPriceMinor < 0n) throw new LedgerError("INVALID", `line ${i + 1}: price cannot be negative`);
    const taxable = input.kind === "invoice" && Boolean(l.taxable);
    return {
      accountId: a.id, accountCode: a.code, description: (l.description ?? "").slice(0, 300),
      quantity: new D(l.quantity).toFixed(4), unitPriceMinor, taxable,
      ...priceLine(l.quantity, unitPriceMinor, taxable, taxRateBps),
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.amountMinor, 0n);
  const tax = lines.reduce((s, l) => s + l.taxMinor, 0n);
  if (subtotal + tax <= 0n) throw new LedgerError("INVALID", `the ${input.kind} total must be more than zero`);

  const counter = input.kind === "invoice" ? "next_invoice_number" : "next_bill_number";
  const num = await tx.query(`UPDATE entities SET ${counter} = ${counter} + 1 WHERE id = $1 RETURNING ${counter} - 1 AS n`, [input.entityId]);
  const number = `${input.kind === "invoice" ? "INV" : "BILL"}-${num.rows[0].n}`;

  const docId = randomUUID();
  await run(() => tx.query(
    `INSERT INTO documents (id, org_id, entity_id, kind, number, reference, contact_id, issue_date, due_date, memo,
        currency, tax_rate_bps, subtotal_minor, tax_minor, total_minor, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [docId, input.orgId, input.entityId, input.kind, number, input.reference?.trim() || null, input.contactId,
     input.issueDate, dueDate, (input.memo ?? "").slice(0, 300), currency, taxRateBps, subtotal, tax, subtotal + tax,
     key, input.actor.id],
  ));
  for (const [i, l] of lines.entries()) {
    await run(() => tx.query(
      `INSERT INTO document_lines (org_id, entity_id, document_id, line_no, description, account_id, quantity,
          unit_price_minor, amount_minor, taxable, tax_rate_bps, tax_minor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [input.orgId, input.entityId, docId, i + 1, l.description, l.accountId, l.quantity, l.unitPriceMinor,
       l.amountMinor, l.taxable, taxRateBps, l.taxMinor],
    ));
  }

  // One journal line per account, so the entry reads like the document.
  const perAccount = new Map<string, bigint>();
  for (const l of lines) perAccount.set(l.accountCode, (perAccount.get(l.accountCode) ?? 0n) + l.amountMinor);
  const side = input.kind === "invoice" ? "credit" : "debit";
  const jl: LineInput[] = [...perAccount].filter(([, v]) => v > 0n).map(([account, v]) => ({ account, [side]: v, description: number }));
  if (tax > 0n) jl.push({ account: "sales_tax_payable", credit: tax, description: `${number} sales tax` });
  if (input.kind === "invoice") jl.unshift({ account: CONTROL.invoice, debit: subtotal + tax, description: number });
  else jl.push({ account: CONTROL.bill, credit: subtotal + tax, description: number });

  const entry = await postJournal(tx, {
    orgId: input.orgId, entityId: input.entityId, date: input.issueDate,
    memo: `${number} · ${contact.rows[0].name}${input.memo ? ` · ${input.memo}` : ""}`.slice(0, 300),
    sourceType: input.kind, sourceId: docId, idempotencyKey: `document:${docId}`, actor: input.actor, lines: jl,
  });
  await run(() => tx.query("UPDATE documents SET entry_id = $2 WHERE id = $1", [docId, entry.id]));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id,
    action: input.kind === "invoice" ? "invoice.issued" : "bill.recorded",
    objectType: input.kind, objectId: docId,
    after: { number, contactId: input.contactId, issueDate: input.issueDate, dueDate, subtotal, tax, total: subtotal + tax, taxRateBps, entryId: entry.id },
    context: { role: input.actor.role, requestHash: hash, ...(taxRateBps ? { taxRateSource: "user_entered" } : {}) },
  });
  return getDocument(tx, docId, hash);
}

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  number: string;
  reference: string | null;
  contactId: string;
  contactName: string;
  issueDate: string;
  dueDate: string;
  memo: string;
  currency: string;
  taxRateBps: number;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  paidMinor: bigint;
  dueMinor: bigint;
  status: DocumentStatus;
  entryId: string;
  voidEntryId: string | null;
}

export interface DocumentDetail extends DocumentSummary {
  voidDate: string | null;
  voidReason: string | null;
  createdBy: string;
  lines: { lineNo: number; description: string; accountCode: string; accountName: string; quantity: string;
    unitPriceMinor: bigint; amountMinor: bigint; taxable: boolean; taxMinor: bigint }[];
  payments: { id: string; date: string; amountMinor: bigint; bankAccountCode: string; entryId: string; createdBy: string }[];
  requestHash?: string;
  replayed: boolean;
}

const SUMMARY_SQL = `
  SELECT d.id, d.kind, d.number, d.reference, d.contact_id, c.name AS contact_name, d.issue_date, d.due_date, d.memo,
         d.currency, d.tax_rate_bps, d.subtotal_minor, d.tax_minor, d.total_minor, d.status, d.entry_id, d.void_entry_id,
         d.void_date, d.void_reason, d.created_by,
         coalesce((SELECT sum(p.amount_minor) FROM document_payments p
                    WHERE p.document_id = d.id AND p.payment_date <= $2::date), 0)::bigint AS paid
    FROM documents d JOIN contacts c ON c.id = d.contact_id`;

function statusOf(r: any, asOf: string): DocumentStatus {
  if (r.status === "void" && r.void_date <= asOf) return "void";
  const due = (r.total_minor as bigint) - (r.paid as bigint);
  if (due <= 0n) return "paid";
  if (r.due_date < asOf) return "overdue";
  return r.paid > 0n ? "partial" : "open";
}

function summary(r: any, asOf: string): DocumentSummary {
  return {
    id: r.id, kind: r.kind, number: r.number, reference: r.reference, contactId: r.contact_id, contactName: r.contact_name,
    issueDate: r.issue_date, dueDate: r.due_date, memo: r.memo, currency: r.currency.trim(), taxRateBps: r.tax_rate_bps,
    subtotalMinor: r.subtotal_minor, taxMinor: r.tax_minor, totalMinor: r.total_minor, paidMinor: r.paid,
    dueMinor: r.status === "void" && r.void_date <= asOf ? 0n : (r.total_minor as bigint) - (r.paid as bigint),
    status: statusOf(r, asOf), entryId: r.entry_id, voidEntryId: r.void_entry_id,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

export async function listDocuments(tx: Tx, entityId: string, kind: DocumentKind, asOf = today()): Promise<DocumentSummary[]> {
  const { rows } = await tx.query(
    `${SUMMARY_SQL} WHERE d.entity_id = $1 AND d.kind = $3 AND d.issue_date <= $2::date
      ORDER BY d.issue_date DESC, d.number DESC LIMIT 500`,
    [entityId, asOf, kind],
  );
  return rows.map((r) => summary(r, asOf));
}

export async function getDocument(tx: Tx, documentId: string, requestHashHint?: string): Promise<DocumentDetail> {
  const asOf = "9999-12-31";
  const { rows } = await tx.query(`${SUMMARY_SQL} WHERE d.id = $1`, [documentId, asOf]);
  const r = rows[0];
  if (!r) throw new LedgerError("INVALID", `document ${documentId} not found`);
  const lines = await tx.query(
    `SELECT l.line_no, l.description, a.code, a.name, l.quantity::text AS quantity, l.unit_price_minor, l.amount_minor,
            l.taxable, l.tax_minor
       FROM document_lines l JOIN accounts a ON a.id = l.account_id WHERE l.document_id = $1 ORDER BY l.line_no`,
    [documentId],
  );
  const pays = await tx.query(
    `SELECT p.id, p.payment_date, p.amount_minor, a.code, p.entry_id, p.created_by
       FROM document_payments p JOIN accounts a ON a.id = p.bank_account_id WHERE p.document_id = $1 ORDER BY p.payment_date, p.created_at`,
    [documentId],
  );
  let requestHash = requestHashHint;
  if (!requestHash) {
    const ev = await tx.query(
      "SELECT context->>'requestHash' AS h FROM audit_events WHERE object_type = $1 AND object_id = $2 ORDER BY seq LIMIT 1",
      [r.kind, documentId],
    );
    requestHash = ev.rows[0]?.h;
  }
  return {
    ...summary(r, today()),
    voidDate: r.void_date, voidReason: r.void_reason, createdBy: r.created_by,
    lines: lines.rows.map((l) => ({
      lineNo: l.line_no, description: l.description, accountCode: l.code, accountName: l.name,
      quantity: new D(l.quantity).toString(), unitPriceMinor: l.unit_price_minor, amountMinor: l.amount_minor,
      taxable: l.taxable, taxMinor: l.tax_minor,
    })),
    payments: pays.rows.map((p) => ({
      id: p.id, date: p.payment_date, amountMinor: p.amount_minor, bankAccountCode: p.code, entryId: p.entry_id, createdBy: p.created_by,
    })),
    requestHash,
    replayed: false,
  };
}

// --------------------------------------------------------------- payments

/**
 * Records money received against an invoice or paid against a bill, posting
 * bank against receivables or payables. The database refuses a payment
 * above the amount still due.
 */
export async function recordPayment(
  tx: Tx,
  input: {
    orgId: string; entityId: string; documentId: string; date: string; amount: string | bigint;
    /** Bank account code; defaults to the operating account. */
    bankAccount?: string; idempotencyKey: string; actor: Actor;
  },
): Promise<DocumentDetail> {
  requireWriter(input.actor, "record payments");
  if (!input.idempotencyKey) throw new LedgerError("INVALID", "idempotencyKey is required");
  const key = `payment:${input.idempotencyKey}`;
  const prior = await tx.query("SELECT document_id FROM document_payments WHERE entity_id = $1 AND idempotency_key = $2", [input.entityId, key]);
  if (prior.rows[0]) {
    if (prior.rows[0].document_id !== input.documentId) {
      throw new LedgerError("IDEMPOTENCY_CONFLICT", `idempotency key ${input.idempotencyKey} was already used for another payment`);
    }
    return { ...(await getDocument(tx, input.documentId)), replayed: true };
  }

  const d = await tx.query(
    "SELECT id, kind, number, status, currency, total_minor, issue_date FROM documents WHERE id = $1 AND entity_id = $2 FOR UPDATE",
    [input.documentId, input.entityId],
  );
  const doc = d.rows[0];
  if (!doc) throw new LedgerError("INVALID", "document not found");
  if (doc.status === "void") throw new LedgerError("INVALID", `${doc.number} is void`);
  if (input.date < doc.issue_date) throw new LedgerError("INVALID", `the payment date is before the ${doc.kind} date`);
  const currency = doc.currency.trim();
  let amount: bigint;
  try {
    amount = typeof input.amount === "bigint" ? input.amount : parseMoney(input.amount, currency).minor;
  } catch {
    throw new LedgerError("INVALID", "the payment must be an amount like 125.00");
  }
  if (amount <= 0n) throw new LedgerError("INVALID", "enter a payment amount");
  const paid = (await tx.query("SELECT coalesce(sum(amount_minor), 0)::bigint AS s FROM document_payments WHERE document_id = $1", [doc.id])).rows[0].s as bigint;
  const due = (doc.total_minor as bigint) - paid;
  if (amount > due) throw new LedgerError("OVERPAID", `the payment is more than the ${new D(due.toString()).div(100).toFixed(2)} still due on ${doc.number}`);

  const bankKey = input.bankAccount || "cash_operating";
  const bank = await tx.query(
    "SELECT id, code, subtype FROM accounts WHERE entity_id = $1 AND (code = $2 OR system_key = $2)",
    [input.entityId, bankKey],
  );
  if (!bank.rows[0] || bank.rows[0].subtype !== "bank") throw new LedgerError("INVALID", `${bankKey} is not a bank account`);

  const paymentId = randomUUID();
  const control = CONTROL[doc.kind as DocumentKind];
  const lines: LineInput[] = doc.kind === "invoice"
    ? [{ account: bank.rows[0].code, debit: amount, description: doc.number }, { account: control, credit: amount, description: doc.number }]
    : [{ account: control, debit: amount, description: doc.number }, { account: bank.rows[0].code, credit: amount, description: doc.number }];
  const entry = await postJournal(tx, {
    orgId: input.orgId, entityId: input.entityId, date: input.date,
    memo: `Payment ${doc.kind === "invoice" ? "received" : "made"} · ${doc.number}`,
    sourceType: "payment", sourceId: paymentId, idempotencyKey: `payment:${paymentId}`, actor: input.actor, lines,
  });
  await run(() => tx.query(
    `INSERT INTO document_payments (id, org_id, entity_id, document_id, payment_date, amount_minor, bank_account_id,
        entry_id, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [paymentId, input.orgId, input.entityId, doc.id, input.date, amount, bank.rows[0].id, entry.id, key, input.actor.id],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "payment.recorded",
    objectType: "payment", objectId: paymentId,
    after: { documentId: doc.id, number: doc.number, date: input.date, amount, bankAccount: bank.rows[0].code, entryId: entry.id },
    context: { role: input.actor.role },
  });
  return getDocument(tx, doc.id);
}

// ------------------------------------------------------------------- void

/** Voids an unpaid document by reversing its entry. The document and its lines stay on file. */
export async function voidDocument(
  tx: Tx,
  input: { orgId: string; entityId: string; documentId: string; date: string; reason: string; actor: Actor },
): Promise<DocumentDetail> {
  requireWriter(input.actor, "void documents");
  if (!input.reason.trim()) throw new LedgerError("INVALID", "a void needs a reason");
  const d = await tx.query(
    "SELECT id, kind, number, status, entry_id, issue_date FROM documents WHERE id = $1 AND entity_id = $2 FOR UPDATE",
    [input.documentId, input.entityId],
  );
  const doc = d.rows[0];
  if (!doc) throw new LedgerError("INVALID", "document not found");
  if (doc.status === "void") throw new LedgerError("INVALID", `${doc.number} is already void`);
  if (input.date < doc.issue_date) throw new LedgerError("INVALID", `the void date is before the ${doc.kind} date`);
  const pays = await tx.query("SELECT 1 FROM document_payments WHERE document_id = $1 LIMIT 1", [doc.id]);
  if (pays.rows[0]) throw new LedgerError("INVALID", `${doc.number} has payments recorded, so it cannot be voided`);
  const original = await getEntry(tx, doc.entry_id);
  const reversal = await reverseEntry(tx, {
    orgId: input.orgId, entryId: original.id, date: input.date, reason: `${doc.number} voided: ${input.reason.trim()}`, actor: input.actor,
  });
  await run(() => tx.query(
    "UPDATE documents SET status = 'void', void_entry_id = $2, void_date = $3, void_reason = $4 WHERE id = $1",
    [doc.id, reversal.id, input.date, input.reason.trim().slice(0, 300)],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: `${doc.kind}.voided`,
    objectType: doc.kind, objectId: doc.id, before: { status: "issued" }, after: { status: "void", reversalEntryId: reversal.id },
    context: { role: input.actor.role, reason: input.reason.trim() },
  });
  return getDocument(tx, doc.id);
}

// ------------------------------------------------------------------ aging

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "over_90";

export interface Aging {
  kind: DocumentKind;
  asOf: string;
  buckets: Record<AgingBucket, bigint>;
  totalMinor: bigint;
  rows: (DocumentSummary & { daysPastDue: number; bucket: AgingBucket })[];
}

/** Receivables or payables still open on a date, by days past due. */
export async function aging(tx: Tx, entityId: string, kind: DocumentKind, asOf = today()): Promise<Aging> {
  const docs = await listDocuments(tx, entityId, kind, asOf);
  const buckets: Record<AgingBucket, bigint> = { current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, over_90: 0n };
  const rows: Aging["rows"] = [];
  for (const d of docs) {
    if (d.dueMinor <= 0n) continue;
    const days = Math.round((Date.parse(asOf) - Date.parse(d.dueDate)) / 86_400_000);
    const bucket: AgingBucket = days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "over_90";
    buckets[bucket] += d.dueMinor;
    rows.push({ ...d, daysPastDue: Math.max(0, days), bucket });
  }
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { kind, asOf, buckets, totalMinor: Object.values(buckets).reduce((s, v) => s + v, 0n), rows };
}
