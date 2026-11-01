import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import { withSystem, withTenant, type Tx } from "../db/pool.js";
import type { Mailer, MailMessage } from "../app/mail.js";
import { appendAudit } from "./audit.js";
import { LedgerError, translateDbError } from "./errors.js";
import type { Actor, Role } from "./ledger.js";
import { D, parseMoney } from "./money.js";
import { getDocument, priceLine, type DocumentDetail, type DocumentKind } from "./documents.js";
import { decideSalesTax, issueInvoice, recordBill, resolveLines, type InvoiceLineInput, type RateLookup } from "./sales-tax.js";

// Getting paid: estimates, recurring invoices and bills, invoices emailed to
// customers with a link to view them, and automatic overdue reminders.
// TrailBook never collects the money: the customer pays the business the way
// the business already takes payments, and the payment is recorded as before.

const CAN_WRITE: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];
const CAN_SET: Role[] = ["owner", "admin", "accountant"];
const SYSTEM: Actor = { id: "system:recurring", role: "system" };

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

const todayPacific = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Formats minor units as money a customer reads: "$1,307.24", "CA$1,307.24". */
export function formatAmount(minor: bigint, currency = "USD"): string {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const major = `${abs / 100n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = `${abs % 100n}`.padStart(2, "0");
  return `${sign}${currency === "CAD" ? "CA$" : "$"}${major}.${cents}`;
}

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// --------------------------------------------------------------- estimates

export interface EstimateLine {
  itemId?: string;
  account?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxCategory?: string;
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  amountMinor: bigint;
  taxable: boolean;
}

export type EstimateStatus = "open" | "accepted" | "declined" | "expired";

export interface Estimate {
  id: string;
  number: string;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  issueDate: string;
  expiryDate: string;
  memo: string;
  currency: string;
  lines: EstimateLine[];
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  /** Expired is worked out: an open estimate past its expiry date. */
  status: EstimateStatus;
  invoiceId: string | null;
  invoiceNumber: string | null;
  createdBy: string;
  emails: { sentTo: string; sentAt: string }[];
}

export interface CreateEstimateInput {
  orgId: string;
  entityId: string;
  contactId: string;
  issueDate: string;
  expiryDate?: string;
  memo?: string;
  lines: InvoiceLineInput[];
  lookup?: RateLookup;
  actor: Actor;
}

/**
 * Saves an estimate (a quote). It never posts to the books. Its sales tax is
 * worked out the way an invoice's would be on the same date, as a guide; the
 * invoice works it out again on its own date. When the tax can't be worked
 * out yet (no address, or a state TrailBook doesn't rate), the estimate shows
 * none and says so.
 */
export async function createEstimate(tx: Tx, input: CreateEstimateInput): Promise<Estimate> {
  requireWriter(input.actor, "create estimates");
  if (!input.lines.length) throw new LedgerError("INVALID", "an estimate needs at least one line");
  if (input.lines.length > 200) throw new LedgerError("INVALID", "an estimate can have at most 200 lines");
  const expiry = input.expiryDate || addDays(input.issueDate, 30);
  if (expiry < input.issueDate) throw new LedgerError("INVALID", "the estimate expires before its date");
  const ent = (await tx.query("SELECT functional_currency FROM entities WHERE id = $1", [input.entityId])).rows[0];
  if (!ent) throw new LedgerError("INVALID", "entity not found");
  const currency: string = ent.functional_currency.trim();
  const contact = (await tx.query("SELECT kind FROM contacts WHERE id = $1 AND entity_id = $2", [input.contactId, input.entityId])).rows[0];
  if (!contact) throw new LedgerError("INVALID", "choose a customer");
  if (contact.kind === "vendor") throw new LedgerError("INVALID", "an estimate needs a customer, not a vendor");

  const resolved = await resolveLines(tx, input.entityId, input.lines);
  let rate = "0";
  let taxable = resolved.map(() => false);
  let shares: (string | null)[] = resolved.map(() => null);
  try {
    const d = await decideSalesTax(tx, {
      entityId: input.entityId, contactId: input.contactId, date: input.issueDate,
      categories: resolved.map((l) => l.taxCategory ?? ""),
      lines: resolved.map((l) => ({ periodStart: l.servicePeriodStart, periodEnd: l.servicePeriodEnd })),
      lookup: input.lookup,
    });
    rate = d.rate;
    taxable = d.taxable;
    shares = d.taxShare;
  } catch (err) {
    if (!(err instanceof LedgerError)) throw err;
    // No tax on the estimate; the invoice will work it out.
  }

  const lines: (EstimateLine & { taxMinor: bigint })[] = resolved.map((l, i) => {
    if (!/^\d+(\.\d{1,4})?$/.test(l.quantity) || new D(l.quantity).lte(0)) {
      throw new LedgerError("INVALID", `line ${i + 1}: quantity must be more than zero, up to four decimals`);
    }
    let unit: bigint;
    try {
      unit = parseMoney(l.unitPrice, currency as "USD").minor;
    } catch {
      throw new LedgerError("INVALID", `line ${i + 1}: price must be an amount like 125.00`);
    }
    if (unit < 0n) throw new LedgerError("INVALID", `line ${i + 1}: price cannot be negative`);
    const priced = priceLine(l.quantity, unit, Boolean(taxable[i]), new D(rate).toFixed(5), taxable[i] ? shares[i] ?? undefined : undefined);
    return {
      ...(input.lines[i]!.itemId ? { itemId: input.lines[i]!.itemId } : {}),
      ...(input.lines[i]!.account ? { account: input.lines[i]!.account } : {}),
      description: (l.description ?? "").slice(0, 300), quantity: new D(l.quantity).toString(), unitPrice: new D(unit.toString()).div(100).toFixed(2),
      ...(l.taxCategory ? { taxCategory: l.taxCategory } : {}),
      ...(l.servicePeriodStart ? { servicePeriodStart: l.servicePeriodStart } : {}),
      ...(l.servicePeriodEnd ? { servicePeriodEnd: l.servicePeriodEnd } : {}),
      amountMinor: priced.amountMinor, taxable: Boolean(taxable[i]), taxMinor: priced.taxMinor,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.amountMinor, 0n);
  const tax = lines.reduce((s, l) => s + l.taxMinor, 0n);
  if (subtotal + tax <= 0n) throw new LedgerError("INVALID", "the estimate total must be more than zero");

  const n = (await tx.query("UPDATE entities SET next_estimate_number = next_estimate_number + 1 WHERE id = $1 RETURNING next_estimate_number - 1 AS n", [input.entityId])).rows[0].n;
  const number = `EST-${n}`;
  const stored = lines.map(({ amountMinor, taxMinor, ...l }) => ({ ...l, amountMinor: amountMinor.toString(), taxMinor: taxMinor.toString() }));
  const row = (await run(() => tx.query(
    `INSERT INTO estimates (org_id, entity_id, number, contact_id, issue_date, expiry_date, memo, currency, lines, subtotal_minor, tax_minor, total_minor, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [input.orgId, input.entityId, number, input.contactId, input.issueDate, expiry, (input.memo ?? "").slice(0, 300), currency,
     JSON.stringify(stored), subtotal, tax, subtotal + tax, input.actor.id],
  ))).rows[0];
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "estimate.created", objectType: "estimate", objectId: row.id,
    after: { number, contactId: input.contactId, issueDate: input.issueDate, expiryDate: expiry, total: subtotal + tax }, context: { role: input.actor.role },
  });
  return getEstimate(tx, row.id);
}

function estimateOf(r: any, emails: { sentTo: string; sentAt: string }[], asOf: string): Estimate {
  const status: EstimateStatus = r.status === "open" && r.expiry_date < asOf ? "expired" : r.status;
  return {
    id: r.id, number: r.number, contactId: r.contact_id, contactName: r.contact_name, contactEmail: r.contact_email,
    issueDate: r.issue_date, expiryDate: r.expiry_date, memo: r.memo, currency: r.currency.trim(),
    lines: (r.lines as any[]).map(({ taxMinor: _t, ...l }) => ({ ...l, amountMinor: BigInt(l.amountMinor) })),
    subtotalMinor: r.subtotal_minor, taxMinor: r.tax_minor, totalMinor: r.total_minor, status,
    invoiceId: r.invoice_id, invoiceNumber: r.invoice_number, createdBy: r.created_by, emails,
  };
}

const ESTIMATE_SQL = `
  SELECT s.*, c.name AS contact_name, c.email AS contact_email, d.number AS invoice_number
    FROM estimates s JOIN contacts c ON c.id = s.contact_id LEFT JOIN documents d ON d.id = s.invoice_id`;

export async function getEstimate(tx: Tx, estimateId: string): Promise<Estimate> {
  const r = (await tx.query(`${ESTIMATE_SQL} WHERE s.id = $1`, [estimateId])).rows[0];
  if (!r) throw new LedgerError("INVALID", "estimate not found");
  const emails = (await tx.query("SELECT sent_to, sent_at FROM customer_emails WHERE estimate_id = $1 ORDER BY sent_at", [estimateId])).rows;
  return estimateOf(r, emails.map((e) => ({ sentTo: e.sent_to, sentAt: e.sent_at.toISOString() })), todayPacific());
}

export async function listEstimates(tx: Tx, entityId: string, asOf = todayPacific()): Promise<Estimate[]> {
  const rows = (await tx.query(`${ESTIMATE_SQL} WHERE s.entity_id = $1 ORDER BY s.issue_date DESC, s.number DESC LIMIT 500`, [entityId])).rows;
  const emails = (await tx.query(
    "SELECT estimate_id, sent_to, sent_at FROM customer_emails WHERE entity_id = $1 AND estimate_id IS NOT NULL ORDER BY sent_at", [entityId],
  )).rows;
  return rows.map((r) => estimateOf(r, emails.filter((e) => e.estimate_id === r.id).map((e) => ({ sentTo: e.sent_to, sentAt: e.sent_at.toISOString() })), asOf));
}

/** The customer said yes: issue the invoice (taxed on its own date) and link it to the estimate. */
export async function acceptEstimate(
  tx: Tx,
  input: { orgId: string; entityId: string; estimateId: string; issueDate: string; dueDate?: string; lookup?: RateLookup; manual?: { ratePercent: string; reason: string }; actor: Actor },
): Promise<{ estimate: Estimate; invoice: DocumentDetail }> {
  requireWriter(input.actor, "turn estimates into invoices");
  const est = (await tx.query("SELECT * FROM estimates WHERE id = $1 AND entity_id = $2 FOR UPDATE", [input.estimateId, input.entityId])).rows[0];
  if (!est) throw new LedgerError("INVALID", "estimate not found");
  if (est.status !== "open") throw new LedgerError("INVALID", `estimate ${est.number} was already ${est.status}`);
  if (input.issueDate < est.issue_date) throw new LedgerError("INVALID", "the invoice date is before the estimate's date");
  const lines: InvoiceLineInput[] = (est.lines as any[]).map((l) => ({
    ...(l.itemId ? { itemId: l.itemId } : {}), ...(l.account ? { account: l.account } : {}),
    description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
    ...(l.taxCategory ? { taxCategory: l.taxCategory } : {}),
    ...(l.servicePeriodStart ? { servicePeriodStart: l.servicePeriodStart } : {}),
    ...(l.servicePeriodEnd ? { servicePeriodEnd: l.servicePeriodEnd } : {}),
  }));
  const invoice = await issueInvoice(tx, {
    orgId: input.orgId, entityId: input.entityId, contactId: est.contact_id, issueDate: input.issueDate,
    dueDate: input.dueDate || addDays(input.issueDate, 30), memo: est.memo || `From estimate ${est.number}`,
    lines, lookup: input.lookup, manual: input.manual, idempotencyKey: `estimate:${est.id}`, actor: input.actor,
  });
  await run(() => tx.query(
    "UPDATE estimates SET status = 'accepted', invoice_id = $2, decided_at = now(), decided_by = $3 WHERE id = $1",
    [est.id, invoice.id, input.actor.id],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "estimate.accepted", objectType: "estimate", objectId: est.id,
    after: { invoiceId: invoice.id, invoiceNumber: invoice.number }, context: { role: input.actor.role },
  });
  return { estimate: await getEstimate(tx, est.id), invoice };
}

export async function declineEstimate(tx: Tx, input: { orgId: string; entityId: string; estimateId: string; actor: Actor }): Promise<Estimate> {
  requireWriter(input.actor, "decline estimates");
  const est = (await tx.query("SELECT number, status FROM estimates WHERE id = $1 AND entity_id = $2", [input.estimateId, input.entityId])).rows[0];
  if (!est) throw new LedgerError("INVALID", "estimate not found");
  await run(() => tx.query("UPDATE estimates SET status = 'declined', decided_at = now(), decided_by = $2 WHERE id = $1", [input.estimateId, input.actor.id]));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "estimate.declined", objectType: "estimate", objectId: input.estimateId,
    after: { number: est.number }, context: { role: input.actor.role },
  });
  return getEstimate(tx, input.estimateId);
}

// --------------------------------------------------------------- recurring

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";
export const FREQUENCIES: Frequency[] = ["weekly", "monthly", "quarterly", "yearly"];

/**
 * The next date in a schedule. Months keep to the anchor day, so a schedule
 * started on the 31st lands on the last day of shorter months and returns to
 * the 31st after them.
 */
export function nextDate(date: string, frequency: Frequency, anchorDay: number): string {
  if (frequency === "weekly") return addDays(date, 7);
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[frequency];
  const [y, m] = date.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(anchorDay, last)).padStart(2, "0")}`;
}

export interface RecurringTemplate {
  id: string;
  kind: DocumentKind;
  contactId: string;
  contactName: string;
  lines: InvoiceLineInput[];
  memo: string;
  reference: string | null;
  dueDays: number;
  frequency: Frequency;
  nextDate: string;
  endDate: string | null;
  email: boolean;
  useTax: boolean;
  active: boolean;
  issuedCount: number;
  lastDocumentId: string | null;
  lastDocumentNumber: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdBy: string;
}

export interface CreateRecurringInput {
  orgId: string;
  entityId: string;
  kind: DocumentKind;
  contactId: string;
  lines: InvoiceLineInput[];
  memo?: string;
  reference?: string;
  dueDays?: number;
  frequency: Frequency;
  /** The first date to issue on. */
  startDate: string;
  endDate?: string;
  email?: boolean;
  useTax?: boolean;
  actor: Actor;
}

export async function createRecurring(tx: Tx, input: CreateRecurringInput): Promise<RecurringTemplate> {
  requireWriter(input.actor, `set up recurring ${input.kind}s`);
  if (!FREQUENCIES.includes(input.frequency)) throw new LedgerError("INVALID", "choose how often it repeats");
  if (!input.lines.length) throw new LedgerError("INVALID", `a recurring ${input.kind} needs at least one line`);
  if (input.lines.length > 200) throw new LedgerError("INVALID", "at most 200 lines");
  if (input.endDate && input.endDate < input.startDate) throw new LedgerError("INVALID", "the schedule ends before it starts");
  const dueDays = input.dueDays ?? 30;
  if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) throw new LedgerError("INVALID", "due days must be 0 to 365");
  const contact = (await tx.query("SELECT kind FROM contacts WHERE id = $1 AND entity_id = $2", [input.contactId, input.entityId])).rows[0];
  if (!contact) throw new LedgerError("INVALID", `choose a ${input.kind === "invoice" ? "customer" : "vendor"}`);
  if (input.kind === "invoice" && contact.kind === "vendor") throw new LedgerError("INVALID", "an invoice needs a customer, not a vendor");
  if (input.kind === "bill" && contact.kind === "customer") throw new LedgerError("INVALID", "a bill needs a vendor, not a customer");
  for (const [i, l] of input.lines.entries()) {
    if (input.kind === "bill" && (!l.account || !l.unitPrice)) throw new LedgerError("INVALID", `line ${i + 1}: choose an account and enter a price`);
    if (!l.itemId && !l.unitPrice) throw new LedgerError("INVALID", `line ${i + 1}: enter a price`);
  }
  const lines = input.lines.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined && v !== "")));
  const row = (await run(() => tx.query(
    `INSERT INTO recurring_templates (org_id, entity_id, kind, contact_id, lines, memo, reference, due_days, frequency, anchor_day, next_date, end_date, email, use_tax, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
    [input.orgId, input.entityId, input.kind, input.contactId, JSON.stringify(lines), (input.memo ?? "").slice(0, 300),
     input.reference?.trim().slice(0, 60) || null, dueDays, input.frequency, Number(input.startDate.slice(8, 10)), input.startDate,
     input.endDate ?? null, input.kind === "invoice" && Boolean(input.email), input.kind === "bill" && Boolean(input.useTax), input.actor.id],
  ))).rows[0];
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: `recurring_${input.kind}.created`, objectType: "recurring_template", objectId: row.id,
    after: { contactId: input.contactId, frequency: input.frequency, startDate: input.startDate, endDate: input.endDate ?? null, email: Boolean(input.email) },
    context: { role: input.actor.role },
  });
  return (await listRecurring(tx, input.entityId, row.id))[0]!;
}

export async function listRecurring(tx: Tx, entityId: string, id?: string): Promise<RecurringTemplate[]> {
  const rows = (await tx.query(
    `SELECT t.*, c.name AS contact_name, d.number AS last_number FROM recurring_templates t
       JOIN contacts c ON c.id = t.contact_id LEFT JOIN documents d ON d.id = t.last_document_id
      WHERE t.entity_id = $1 AND ($2::uuid IS NULL OR t.id = $2) ORDER BY t.active DESC, t.next_date, t.created_at`,
    [entityId, id ?? null],
  )).rows;
  return rows.map((r) => ({
    id: r.id, kind: r.kind, contactId: r.contact_id, contactName: r.contact_name, lines: r.lines, memo: r.memo, reference: r.reference,
    dueDays: r.due_days, frequency: r.frequency, nextDate: r.next_date, endDate: r.end_date, email: r.email, useTax: r.use_tax,
    active: r.active, issuedCount: r.issued_count, lastDocumentId: r.last_document_id, lastDocumentNumber: r.last_number,
    lastError: r.last_error, lastErrorAt: r.last_error_at?.toISOString() ?? null, createdBy: r.created_by,
  }));
}

export async function stopRecurring(tx: Tx, input: { orgId: string; entityId: string; templateId: string; actor: Actor }): Promise<RecurringTemplate> {
  requireWriter(input.actor, "stop recurring documents");
  const r = await tx.query(
    "UPDATE recurring_templates SET active = false, stopped_by = $3, stopped_at = now() WHERE id = $1 AND entity_id = $2 AND active RETURNING kind",
    [input.templateId, input.entityId, input.actor.id],
  );
  if (!r.rows[0]) throw new LedgerError("INVALID", "that schedule isn't running");
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: `recurring_${r.rows[0].kind}.stopped`,
    objectType: "recurring_template", objectId: input.templateId, after: { active: false }, context: { role: input.actor.role },
  });
  return (await listRecurring(tx, input.entityId, input.templateId))[0]!;
}

/** Issues one recurring template's document for one date. Idempotent per template and date. */
async function issueFromTemplate(tx: Tx, t: any, date: string, lookup?: RateLookup): Promise<DocumentDetail> {
  const common = {
    orgId: t.org_id, entityId: t.entity_id, contactId: t.contact_id, issueDate: date, dueDate: addDays(date, t.due_days),
    memo: t.memo, reference: t.reference ?? undefined, idempotencyKey: `recurring:${t.id}:${date}`, actor: SYSTEM,
  };
  if (t.kind === "invoice") return issueInvoice(tx, { ...common, lines: t.lines, lookup });
  return recordBill(tx, { ...common, lines: t.lines, useTax: t.use_tax, lookup });
}

export interface RecurringRunResult {
  issued: number;
  failed: number;
  emailed: number;
}

/**
 * Issues every recurring invoice and bill due on or before today. A template
 * that fell behind catches up one date at a time (at most twelve in a run).
 * A failure (a locked month, a tax rate that can't be looked up) is kept on
 * the template, tried again the next day, and emailed to the business once.
 */
export async function runRecurring(
  pool: pg.Pool,
  opts: { today: string; lookup?: RateLookup; mailer?: Mailer; appUrl?: string; excludeOrg?: string },
): Promise<RecurringRunResult> {
  const result = { issued: 0, failed: 0, emailed: 0 };
  const due = await withSystem(pool, async (tx) => (await tx.query(
    `SELECT t.id, t.org_id FROM recurring_templates t JOIN organizations o ON o.id = t.org_id
      WHERE t.active AND t.next_date <= $1 AND ($2::text IS NULL OR o.name <> $2) ORDER BY t.next_date`,
    [opts.today, opts.excludeOrg ?? null],
  )).rows);
  for (const { id, org_id } of due) {
    for (let step = 0; step < 12; step++) {
      let issued: DocumentDetail | undefined;
      let stop = false;
      try {
        issued = await withTenant(pool, org_id, async (tx) => {
          const t = (await tx.query("SELECT * FROM recurring_templates WHERE id = $1 FOR UPDATE", [id])).rows[0];
          if (!t || !t.active || t.next_date > opts.today) { stop = true; return undefined; }
          if (t.end_date && t.next_date > t.end_date) {
            await tx.query("UPDATE recurring_templates SET active = false, stopped_by = 'system:recurring', stopped_at = now() WHERE id = $1", [id]);
            stop = true;
            return undefined;
          }
          const doc = await issueFromTemplate(tx, t, t.next_date, opts.lookup);
          const next = nextDate(t.next_date, t.frequency, t.anchor_day);
          const ended = Boolean(t.end_date && next > t.end_date);
          await tx.query(
            `UPDATE recurring_templates SET next_date = $2, issued_count = issued_count + 1, last_document_id = $3, last_error = NULL, last_error_at = NULL,
                    active = $4, stopped_by = CASE WHEN $4 THEN NULL ELSE 'system:recurring' END, stopped_at = CASE WHEN $4 THEN NULL ELSE now() END
              WHERE id = $1`,
            [id, next, doc.id, !ended],
          );
          return { ...doc, emailIt: t.email } as DocumentDetail & { emailIt: boolean };
        });
      } catch (err) {
        result.failed++;
        const message = err instanceof Error ? err.message : String(err);
        const first = await withTenant(pool, org_id, async (tx) => (await tx.query(
          `UPDATE recurring_templates t SET last_error = $2, last_error_at = now()
             FROM (SELECT last_error FROM recurring_templates WHERE id = $1) old WHERE t.id = $1
           RETURNING old.last_error IS NULL AS first, t.kind, t.entity_id, (SELECT name FROM contacts WHERE id = t.contact_id) AS contact`,
          [id, message.slice(0, 500)],
        )).rows[0]);
        if (first?.first && opts.mailer) await notifyRecurringFailure(pool, opts.mailer, org_id, first, message, opts.appUrl).catch(() => undefined);
        break;
      }
      if (stop || !issued) break;
      result.issued++;
      if ((issued as any).emailIt && opts.mailer) {
        try {
          await emailDocument(pool, { orgId: org_id, documentId: issued.id, mailer: opts.mailer, appUrl: opts.appUrl, actor: SYSTEM });
          result.emailed++;
        } catch {
          // The invoice stands; the business can send it from its page.
        }
      }
    }
  }
  return result;
}

async function notifyRecurringFailure(pool: pg.Pool, mailer: Mailer, orgId: string, t: any, message: string, appUrl?: string) {
  const people = await staffEmails(pool, orgId);
  const ent = await withSystem(pool, async (tx) => (await tx.query("SELECT legal_name FROM entities WHERE id = $1", [t.entity_id])).rows[0]);
  for (const to of people) {
    await mailer({
      to,
      subject: `A recurring ${t.kind} for ${t.contact} couldn't be ${t.kind === "invoice" ? "issued" : "recorded"}`,
      text: [
        `TrailBook tried to ${t.kind === "invoice" ? "issue" : "record"} today's recurring ${t.kind} for ${t.contact} in ${ent?.legal_name ?? "your books"} and couldn't:`,
        "", message, "",
        "It will try again tomorrow. Fix the cause, or stop the schedule on the Invoices or Bills page.",
        ...(appUrl ? ["", `${appUrl.replace(/\/$/, "")}/#/e/${t.entity_id}/${t.kind}s`] : []),
      ].join("\n"),
    });
  }
}

async function staffEmails(pool: pg.Pool, orgId: string): Promise<string[]> {
  return withSystem(pool, async (tx) => (await tx.query(
    "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.role IN ('owner', 'admin', 'accountant') ORDER BY u.email",
    [orgId],
  )).rows.map((r) => r.email as string));
}

// ------------------------------------------------------------------ emails

export interface CustomerEmailSettings {
  reminders: boolean;
  /** Where customers' replies go; null means the organisation's first owner. */
  replyTo: string | null;
  /** What replies use when replyTo is blank. */
  defaultReplyTo: string | null;
}

export async function customerEmailSettings(tx: Tx, entityId: string, defaultReplyTo: string | null = null): Promise<CustomerEmailSettings> {
  const r = (await tx.query("SELECT invoice_reminders, invoice_reply_to FROM entities WHERE id = $1", [entityId])).rows[0];
  if (!r) throw new LedgerError("INVALID", "entity not found");
  return { reminders: r.invoice_reminders, replyTo: r.invoice_reply_to, defaultReplyTo };
}

/** The organisation's first owner, who gets customers' replies unless the business names another address. */
export async function firstOwnerEmail(pool: pg.Pool, orgId: string): Promise<string | null> {
  return withSystem(pool, async (tx) => (await tx.query(
    "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.role = 'owner' ORDER BY m.created_at, u.email LIMIT 1",
    [orgId],
  )).rows[0]?.email ?? null);
}

export async function setCustomerEmailSettings(
  tx: Tx,
  input: { orgId: string; entityId: string; reminders?: boolean; replyTo?: string | null; actor: Actor },
): Promise<CustomerEmailSettings> {
  if (!CAN_SET.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot change invoice emails`);
  const replyTo = input.replyTo === undefined ? undefined : input.replyTo?.trim() || null;
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) throw new LedgerError("INVALID", "the reply-to address doesn't look like an email address");
  await run(() => tx.query(
    `UPDATE entities SET invoice_reminders = coalesce($2, invoice_reminders),
            invoice_reply_to = CASE WHEN $3 THEN $4 ELSE invoice_reply_to END WHERE id = $1`,
    [input.entityId, input.reminders ?? null, replyTo !== undefined, replyTo ?? null],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "invoice_emails.settings", objectType: "entity", objectId: input.entityId,
    after: { ...(input.reminders !== undefined ? { reminders: input.reminders } : {}), ...(replyTo !== undefined ? { replyTo } : {}) },
    context: { role: input.actor.role },
  });
  return customerEmailSettings(tx, input.entityId);
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** A new link a customer can open without signing in. Only its hash is kept. */
async function newViewLink(tx: Tx, orgId: string, entityId: string, ref: { documentId?: string; estimateId?: string }): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await tx.query(
    "INSERT INTO view_links (token_hash, org_id, entity_id, document_id, estimate_id) VALUES ($1, $2, $3, $4, $5)",
    [hashToken(token), orgId, entityId, ref.documentId ?? null, ref.estimateId ?? null],
  );
  return token;
}

const viewUrl = (appUrl: string | undefined, token: string) => (appUrl ? `${appUrl.replace(/\/$/, "")}/view.html#${token}` : undefined);

/** Reminder stages, by days past the due date (negative: before it). */
export const REMINDER_STAGES: { stage: string; day: number }[] = [
  { stage: "due-3", day: -3 }, { stage: "over-1", day: 1 }, { stage: "over-7", day: 7 }, { stage: "over-14", day: 14 }, { stage: "over-30", day: 30 },
];

/** The reminder an invoice is at today, if any: the latest stage reached. A business that turns reminders on late sends one, not a backlog. */
export function reminderStage(dueDate: string, today: string): string | null {
  const days = daysBetween(dueDate, today);
  let found: string | null = null;
  for (const s of REMINDER_STAGES) if (days >= s.day) found = s.stage;
  return found;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

interface Composed {
  message: MailMessage;
  log: { kind: "invoice" | "estimate" | "reminder"; stage?: string; documentId?: string; estimateId?: string; entityId: string; to: string };
}

/** Builds an invoice email (or a reminder) with a new view link. */
async function composeInvoice(tx: Tx, orgId: string, doc: DocumentDetail, opts: { appUrl?: string; stage?: string; to?: string; fallbackReplyTo?: string | null; today?: string }): Promise<Composed> {
  if (doc.kind !== "invoice") throw new LedgerError("INVALID", "only invoices are emailed to customers");
  if (doc.status === "void") throw new LedgerError("INVALID", `${doc.number} is void`);
  const head = (await tx.query(
    `SELECT e.id AS entity_id, e.legal_name, e.invoice_reply_to, c.email FROM documents d JOIN entities e ON e.id = d.entity_id JOIN contacts c ON c.id = d.contact_id WHERE d.id = $1`,
    [doc.id],
  )).rows[0];
  const to = opts.to?.trim() || head.email;
  if (!to) throw new LedgerError("INVALID", `add an email address for ${doc.contactName} first`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new LedgerError("INVALID", "that email address doesn't look right");
  const replyTo = head.invoice_reply_to || opts.fallbackReplyTo || undefined;
  const link = viewUrl(opts.appUrl, await newViewLink(tx, orgId, head.entity_id, { documentId: doc.id }));
  const money = (m: bigint) => formatAmount(m, doc.currency);
  const reminder = Boolean(opts.stage);
  const overdue = doc.dueDate < (opts.today ?? todayPacific());
  const subject = reminder
    ? overdue
      ? `Reminder: invoice ${doc.number} from ${head.legal_name} was due ${longDate(doc.dueDate)}`
      : `Reminder: invoice ${doc.number} from ${head.legal_name} is due ${longDate(doc.dueDate)}`
    : `Invoice ${doc.number} from ${head.legal_name}: ${money(doc.dueMinor)} due ${longDate(doc.dueDate)}`;
  const opener = reminder
    ? overdue
      ? `This is a friendly reminder that invoice ${doc.number} was due on ${longDate(doc.dueDate)} and ${money(doc.dueMinor)} is still open.`
      : `This is a friendly reminder that invoice ${doc.number} is due on ${longDate(doc.dueDate)}.`
    : `Here is invoice ${doc.number} from ${head.legal_name}.`;
  const lines = doc.lines.map((l) => `- ${l.description || l.accountName}: ${l.quantity} × ${money(l.unitPriceMinor)} = ${money(l.amountMinor)}`);
  const text = [
    `Hello ${doc.contactName},`, "", opener, "",
    ...lines, "",
    `Subtotal: ${money(doc.subtotalMinor)}`,
    ...(doc.taxMinor ? [`Sales tax: ${money(doc.taxMinor)}`] : []),
    `Total: ${money(doc.totalMinor)}`,
    ...(doc.paidMinor ? [`Paid: ${money(doc.paidMinor)}`] : []),
    `Balance due: ${money(doc.dueMinor)} by ${longDate(doc.dueDate)}`,
    ...(doc.memo ? ["", doc.memo] : []),
    ...(link ? ["", `View or print the invoice: ${link}`] : []),
    "", `Questions? Just reply to this email to reach ${head.legal_name}.`, ...(reminder ? ["If you've already paid, thank you, and please ignore this reminder."] : []),
  ].join("\n");
  const row = (l: string, v: string, strong = false) => `<tr><td style="padding:4px 12px 4px 0;color:#555">${esc(l)}</td><td style="padding:4px 0;text-align:right">${strong ? `<strong>${esc(v)}</strong>` : esc(v)}</td></tr>`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1d2a24;max-width:560px">
    <p>Hello ${esc(doc.contactName)},</p><p>${esc(opener)}</p>
    <table style="border-collapse:collapse;width:100%;margin:12px 0">
      ${doc.lines.map((l) => row(`${l.description || l.accountName} (${l.quantity} × ${money(l.unitPriceMinor)})`, money(l.amountMinor))).join("")}
      ${row("Subtotal", money(doc.subtotalMinor))}${doc.taxMinor ? row("Sales tax", money(doc.taxMinor)) : ""}${row("Total", money(doc.totalMinor))}
      ${doc.paidMinor ? row("Paid", money(doc.paidMinor)) : ""}${row(`Balance due by ${longDate(doc.dueDate)}`, money(doc.dueMinor), true)}
    </table>
    ${doc.memo ? `<p>${esc(doc.memo)}</p>` : ""}
    ${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#2f5d50;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">View or print invoice ${esc(doc.number)}</a></p>` : ""}
    <p style="color:#555">Questions? Just reply to this email to reach ${esc(head.legal_name)}.${reminder ? " If you've already paid, thank you, and please ignore this reminder." : ""}</p>
  </div>`;
  return {
    message: { to, subject, text, html, fromName: head.legal_name, replyTo },
    log: { kind: reminder ? "reminder" : "invoice", stage: opts.stage, documentId: doc.id, entityId: head.entity_id, to },
  };
}

async function composeEstimate(tx: Tx, orgId: string, est: Estimate, opts: { appUrl?: string; to?: string; fallbackReplyTo?: string | null }): Promise<Composed> {
  if (est.status === "accepted" || est.status === "declined") throw new LedgerError("INVALID", `estimate ${est.number} was already ${est.status}`);
  const head = (await tx.query("SELECT e.id AS entity_id, e.legal_name, e.invoice_reply_to FROM estimates s JOIN entities e ON e.id = s.entity_id WHERE s.id = $1", [est.id])).rows[0];
  const to = opts.to?.trim() || est.contactEmail;
  if (!to) throw new LedgerError("INVALID", `add an email address for ${est.contactName} first`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new LedgerError("INVALID", "that email address doesn't look right");
  const replyTo = head.invoice_reply_to || opts.fallbackReplyTo || undefined;
  const link = viewUrl(opts.appUrl, await newViewLink(tx, orgId, head.entity_id, { estimateId: est.id }));
  const money = (m: bigint) => formatAmount(m, est.currency);
  const text = [
    `Hello ${est.contactName},`, "", `Here is estimate ${est.number} from ${head.legal_name}, good until ${longDate(est.expiryDate)}.`, "",
    ...est.lines.map((l) => `- ${l.description}: ${l.quantity} × ${money(parseMoney(l.unitPrice).minor)} = ${money(l.amountMinor)}`), "",
    `Subtotal: ${money(est.subtotalMinor)}`, ...(est.taxMinor ? [`Estimated sales tax: ${money(est.taxMinor)}`] : []), `Total: ${money(est.totalMinor)}`,
    ...(est.memo ? ["", est.memo] : []),
    ...(link ? ["", `View or print the estimate: ${link}`] : []),
    "", `To go ahead, or with any questions, just reply to this email to reach ${head.legal_name}.`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1d2a24;max-width:560px">
    <p>Hello ${esc(est.contactName)},</p><p>Here is estimate ${esc(est.number)} from ${esc(head.legal_name)}, good until ${esc(longDate(est.expiryDate))}, for <strong>${esc(money(est.totalMinor))}</strong>.</p>
    ${est.memo ? `<p>${esc(est.memo)}</p>` : ""}
    ${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#2f5d50;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">View estimate ${esc(est.number)}</a></p>` : ""}
    <p style="color:#555">To go ahead, or with any questions, just reply to this email to reach ${esc(head.legal_name)}.</p>
  </div>`;
  return {
    message: { to, subject: `Estimate ${est.number} from ${head.legal_name}: ${money(est.totalMinor)}`, text, html, fromName: head.legal_name, replyTo },
    log: { kind: "estimate", estimateId: est.id, entityId: head.entity_id, to },
  };
}

async function logEmail(tx: Tx, orgId: string, c: Composed["log"], actor: Actor): Promise<boolean> {
  const r = await tx.query(
    `INSERT INTO customer_emails (org_id, entity_id, document_id, estimate_id, kind, stage, sent_to, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING RETURNING id`,
    [orgId, c.entityId, c.documentId ?? null, c.estimateId ?? null, c.kind, c.stage ?? null, c.to, actor.id],
  );
  if (r.rows[0]) {
    await appendAudit(tx, {
      orgId, entityId: c.entityId, actor: actor.id, action: `${c.kind}.emailed`, objectType: c.estimateId ? "estimate" : "invoice",
      objectId: (c.documentId ?? c.estimateId)!, after: { to: c.to, ...(c.stage ? { stage: c.stage } : {}) }, context: { role: actor.role },
    });
  }
  return Boolean(r.rows[0]);
}

/** Emails an invoice to its customer (or another address), with a link to view it, and logs it. */
export async function emailDocument(
  pool: pg.Pool,
  input: { orgId: string; documentId: string; mailer?: Mailer; appUrl?: string; to?: string; actor: Actor },
): Promise<{ sentTo: string }> {
  requireWriter(input.actor, "email invoices");
  if (!input.mailer) throw new LedgerError("INVALID", "email isn't set up on this site yet");
  const fallbackReplyTo = await firstOwnerEmail(pool, input.orgId);
  const c = await withTenant(pool, input.orgId, async (tx) => composeInvoice(tx, input.orgId, await getDocument(tx, input.documentId), { ...input, fallbackReplyTo }));
  await input.mailer(c.message);
  await withTenant(pool, input.orgId, (tx) => logEmail(tx, input.orgId, c.log, input.actor));
  return { sentTo: c.log.to };
}

export async function emailEstimate(
  pool: pg.Pool,
  input: { orgId: string; estimateId: string; mailer?: Mailer; appUrl?: string; to?: string; actor: Actor },
): Promise<{ sentTo: string }> {
  requireWriter(input.actor, "email estimates");
  if (!input.mailer) throw new LedgerError("INVALID", "email isn't set up on this site yet");
  const fallbackReplyTo = await firstOwnerEmail(pool, input.orgId);
  const c = await withTenant(pool, input.orgId, async (tx) => composeEstimate(tx, input.orgId, await getEstimate(tx, input.estimateId), { ...input, fallbackReplyTo }));
  await input.mailer(c.message);
  await withTenant(pool, input.orgId, (tx) => logEmail(tx, input.orgId, c.log, input.actor));
  return { sentTo: c.log.to };
}

/** The emails sent about one invoice, oldest first. */
export async function documentEmails(tx: Tx, documentId: string) {
  const rows = (await tx.query("SELECT kind, stage, sent_to, sent_by, sent_at FROM customer_emails WHERE document_id = $1 ORDER BY sent_at", [documentId])).rows;
  return rows.map((r) => ({ kind: r.kind, stage: r.stage, sentTo: r.sent_to, sentBy: r.sent_by, sentAt: r.sent_at.toISOString() }));
}

export interface ReminderRunResult {
  sent: number;
  failed: number;
}

/**
 * Sends today's reminders for open invoices, in every business that turned
 * them on: three days before the due date, then 1, 7, 14 and 30 days after.
 * Each stage goes once per invoice; a failed send is tried the next day.
 * Only invoices with an amount still due and a customer email.
 */
export async function sendInvoiceReminders(
  pool: pg.Pool,
  opts: { today: string; mailer?: Mailer; appUrl?: string; excludeOrg?: string },
): Promise<ReminderRunResult> {
  const result = { sent: 0, failed: 0 };
  if (!opts.mailer) return result;
  const candidates = await withSystem(pool, async (tx) => (await tx.query(
    `SELECT d.id, d.org_id, d.due_date FROM documents d
       JOIN entities e ON e.id = d.entity_id JOIN organizations o ON o.id = d.org_id JOIN contacts c ON c.id = d.contact_id
      WHERE d.kind = 'invoice' AND d.status = 'issued' AND e.invoice_reminders AND c.email IS NOT NULL
        AND d.due_date <= $1::date + 3 AND ($2::text IS NULL OR o.name <> $2)
        AND d.total_minor > coalesce((SELECT sum(amount_minor) FROM document_payments p WHERE p.document_id = d.id), 0)`,
    [opts.today, opts.excludeOrg ?? null],
  )).rows);
  for (const c of candidates) {
    const stage = reminderStage(c.due_date, opts.today);
    if (!stage) continue;
    try {
      const fallbackReplyTo = await firstOwnerEmail(pool, c.org_id);
      const composed = await withTenant(pool, c.org_id, async (tx) => {
        const already = (await tx.query("SELECT 1 FROM customer_emails WHERE document_id = $1 AND kind = 'reminder' AND stage = $2", [c.id, stage])).rows[0];
        if (already) return undefined;
        return composeInvoice(tx, c.org_id, await getDocument(tx, c.id), { appUrl: opts.appUrl, stage, fallbackReplyTo, today: opts.today });
      });
      if (!composed) continue;
      await opts.mailer(composed.message);
      await withTenant(pool, c.org_id, (tx) => logEmail(tx, c.org_id, composed.log, { id: "system:reminders", role: "system" }));
      result.sent++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

// ------------------------------------------------------------- view links

export interface PublicView {
  kind: "invoice" | "estimate";
  business: { name: string; address: { line1: string; city: string; state: string; zip: string } | null };
  number: string;
  customer: string;
  issueDate: string;
  /** Invoices: due date. Estimates: good until. */
  dueDate: string;
  currency: string;
  lines: { description: string; quantity: string; unitPriceMinor: bigint; amountMinor: bigint }[];
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  paidMinor: bigint;
  dueMinor: bigint;
  status: string;
  memo: string;
}

/** Which business and document a customer's link opens, or null for a bad link. */
export async function viewLinkFor(pool: pg.Pool, token: string): Promise<{ orgId: string; entityId: string; documentId: string | null; estimateId: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const link = await withSystem(pool, async (tx) => (await tx.query("SELECT * FROM view_links WHERE token_hash = $1", [hashToken(token)])).rows[0]);
  return link ? { orgId: link.org_id, entityId: link.entity_id, documentId: link.document_id, estimateId: link.estimate_id } : null;
}

/** What a customer's link shows: the document, the business's name and address, nothing else from the books. */
export async function viewByToken(pool: pg.Pool, token: string): Promise<PublicView | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const link = await withSystem(pool, async (tx) => (await tx.query("SELECT * FROM view_links WHERE token_hash = $1", [hashToken(token)])).rows[0]);
  if (!link) return null;
  return withTenant(pool, link.org_id, async (tx) => {
    const ent = (await tx.query("SELECT legal_name, address_line1, address_city, address_state, address_zip FROM entities WHERE id = $1", [link.entity_id])).rows[0];
    const business = {
      name: ent.legal_name,
      address: ent.address_line1 ? { line1: ent.address_line1, city: ent.address_city, state: ent.address_state, zip: ent.address_zip } : null,
    };
    if (link.document_id) {
      const d = await getDocument(tx, link.document_id);
      return {
        kind: "invoice", business, number: d.number, customer: d.contactName, issueDate: d.issueDate, dueDate: d.dueDate, currency: d.currency,
        lines: d.lines.map((l) => ({ description: l.description || l.accountName, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, amountMinor: l.amountMinor })),
        subtotalMinor: d.subtotalMinor, taxMinor: d.taxMinor, totalMinor: d.totalMinor, paidMinor: d.paidMinor, dueMinor: d.dueMinor, status: d.status, memo: d.memo,
      };
    }
    const e = await getEstimate(tx, link.estimate_id);
    return {
      kind: "estimate", business, number: e.number, customer: e.contactName, issueDate: e.issueDate, dueDate: e.expiryDate, currency: e.currency,
      lines: e.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceMinor: parseMoney(l.unitPrice).minor, amountMinor: l.amountMinor })),
      subtotalMinor: e.subtotalMinor, taxMinor: e.taxMinor, totalMinor: e.totalMinor, paidMinor: 0n, dueMinor: e.totalMinor, status: e.status, memo: e.memo,
    };
  });
}
