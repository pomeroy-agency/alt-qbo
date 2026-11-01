import { createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { withSystem, withTenant, type Tx } from "../db/pool.js";
import { appendAudit } from "./audit.js";
import { createAccount } from "./accounts.js";
import { getDocument, recordPayment } from "./documents.js";
import { LedgerError } from "./errors.js";
import { viewLinkFor } from "./invoicing.js";
import { postJournal, type Actor, type Role } from "./ledger.js";
import type { InvoicePayments } from "../app/stripe-connect.js";

// Card and bank payments on invoices, through the business's own Stripe
// account. A payment is recorded in the books once Stripe says the money is
// in: debit the "Stripe balance" bank account, credit receivables, then
// Stripe's fee as an expense against the same balance. When Stripe pays out
// to the business's bank, that deposit is a transfer from the Stripe balance.

const CAN_CONNECT: Role[] = ["owner", "admin"];
const STRIPE: Actor = { id: "system:stripe", role: "system" };
const FEE_ACCOUNT = "6100";
const BALANCE_NAME = "Stripe balance";

const todayPacific = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

// ------------------------------------------------------------ sign-in state

function stateKey(env: Record<string, string | undefined> = process.env): Buffer {
  if (!env.PII_KEY) throw new LedgerError("INVALID", "PII_KEY isn't set, so Stripe can't be connected");
  return createHmac("sha256", env.PII_KEY).update("trailbook:stripe-connect-state").digest();
}

/** The state carried through Stripe's sign-in: who started it, for which business, until when. */
export function signConnectState(input: { orgId: string; entityId: string; userId: string; now?: number }, env?: Record<string, string | undefined>): string {
  const body = Buffer.from(JSON.stringify({ o: input.orgId, e: input.entityId, u: input.userId, x: (input.now ?? Date.now()) + 15 * 60_000 })).toString("base64url");
  return `${body}.${createHmac("sha256", stateKey(env)).update(body).digest("base64url")}`;
}

export function readConnectState(state: string, now = Date.now(), env?: Record<string, string | undefined>): { orgId: string; entityId: string; userId: string } | null {
  const [body, sig] = state.split(".");
  if (!body || !sig || state.length > 600) return null;
  const want = createHmac("sha256", stateKey(env)).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p.x !== "number" || p.x < now) return null;
    return { orgId: p.o, entityId: p.e, userId: p.u };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- connections

export interface StripeConnection {
  id: string;
  accountId: string;
  name: string | null;
  livemode: boolean;
  bankAccount: string;
  connectedBy: string;
  connectedAt: string;
}

async function activeConnection(tx: Tx, entityId: string): Promise<(StripeConnection & { bankAccountId: string }) | null> {
  const r = (await tx.query(
    `SELECT c.*, a.code FROM stripe_connections c JOIN accounts a ON a.id = c.bank_account_id
      WHERE c.entity_id = $1 AND c.status = 'active'`,
    [entityId],
  )).rows[0];
  if (!r) return null;
  return {
    id: r.id, accountId: r.stripe_account_id, name: r.display_name, livemode: r.livemode, bankAccount: r.code, bankAccountId: r.bank_account_id,
    connectedBy: r.connected_by, connectedAt: new Date(r.connected_at).toISOString(),
  };
}

/** Whether this business can take payments at all: the switch is on, and (for Canada) the Canadian switch too. */
async function availability(tx: Tx, entityId: string, payments: InvoicePayments | undefined): Promise<{ available: boolean; reason: string | null; currency: string }> {
  const e = (await tx.query("SELECT country, functional_currency FROM entities WHERE id = $1", [entityId])).rows[0];
  const currency = String(e?.functional_currency ?? "USD").trim();
  if (!payments) return { available: false, reason: "Online payments aren't switched on yet.", currency };
  if (String(e?.country).trim() === "CA" && !payments.canada) return { available: false, reason: "Online payments aren't available for Canadian businesses yet.", currency };
  return { available: true, reason: null, currency };
}

export interface PaymentSessionRow {
  id: string;
  documentId: string;
  number: string;
  amountMinor: bigint;
  currency: string;
  status: string;
  paymentMethod: string | null;
  feeMinor: bigint | null;
  note: string | null;
  createdAt: string;
  settledAt: string | null;
}

export async function paymentsStatus(tx: Tx, entityId: string, payments: InvoicePayments | undefined) {
  const a = await availability(tx, entityId, payments);
  const connection = await activeConnection(tx, entityId);
  const recent = (await tx.query(
    `SELECT s.*, d.number FROM invoice_payment_sessions s JOIN documents d ON d.id = s.document_id
      WHERE s.entity_id = $1 AND s.status <> 'open' ORDER BY s.created_at DESC LIMIT 25`,
    [entityId],
  )).rows.map((r): PaymentSessionRow => ({
    id: r.id, documentId: r.document_id, number: r.number, amountMinor: r.amount_minor, currency: r.currency.trim(), status: r.status,
    paymentMethod: r.payment_method, feeMinor: r.fee_minor, note: r.note, createdAt: new Date(r.created_at).toISOString(),
    settledAt: r.settled_at ? new Date(r.settled_at).toISOString() : null,
  }));
  return {
    enabled: Boolean(payments), available: a.available, reason: a.reason, livemode: payments?.livemode ?? null,
    connection: connection ? { ...connection, bankAccountId: undefined } : null, recent,
  };
}

/** Where to send the owner to connect Stripe. */
export async function connectStart(
  tx: Tx, payments: InvoicePayments,
  input: { orgId: string; entityId: string; actor: Actor; userId: string; email?: string; redirectUri: string },
): Promise<string> {
  if (!CAN_CONNECT.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", "only an owner or admin can connect Stripe");
  const a = await availability(tx, input.entityId, payments);
  if (!a.available) throw new LedgerError("INVALID", a.reason!);
  if (await activeConnection(tx, input.entityId)) throw new LedgerError("INVALID", "a Stripe account is already connected; disconnect it first");
  const country = String((await tx.query("SELECT country FROM entities WHERE id = $1", [input.entityId])).rows[0]?.country ?? "").trim();
  return payments.authorizeUrl({
    state: signConnectState({ orgId: input.orgId, entityId: input.entityId, userId: input.userId }),
    redirectUri: input.redirectUri, email: input.email, country: country || undefined,
  });
}

async function balanceAccount(tx: Tx, input: { orgId: string; entityId: string; actor: Actor }): Promise<{ id: string; code: string }> {
  const found = (await tx.query(
    "SELECT id, code FROM accounts WHERE entity_id = $1 AND subtype = 'bank' AND lower(name) = lower($2) ORDER BY code LIMIT 1",
    [input.entityId, BALANCE_NAME],
  )).rows[0];
  if (found) {
    await tx.query("UPDATE accounts SET is_active = true WHERE id = $1 AND NOT is_active", [found.id]);
    return found;
  }
  const used = new Set((await tx.query("SELECT code FROM accounts WHERE entity_id = $1", [input.entityId])).rows.map((r) => r.code));
  let code = "";
  for (let n = 1050; n < 1100 && !code; n++) if (!used.has(String(n))) code = String(n);
  for (let n = 10500; n < 10600 && !code; n++) if (!used.has(String(n))) code = String(n);
  if (!code) throw new LedgerError("INVALID", "add a bank account named \"Stripe balance\" to the chart of accounts, then connect again");
  return createAccount(tx, { orgId: input.orgId, entityId: input.entityId, code, name: BALANCE_NAME, kind: "bank", taxLine: null, actor: input.actor });
}

/** After Stripe's sign-in: keep the connected account and set up its balance account in the books. */
export async function finishConnect(
  tx: Tx, payments: InvoicePayments, input: { orgId: string; entityId: string; code: string; actor: Actor },
): Promise<StripeConnection> {
  if (!CAN_CONNECT.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", "only an owner or admin can connect Stripe");
  const a = await availability(tx, input.entityId, payments);
  if (!a.available) throw new LedgerError("INVALID", a.reason!);
  if (await activeConnection(tx, input.entityId)) throw new LedgerError("INVALID", "a Stripe account is already connected; disconnect it first");
  const { accountId, livemode } = await payments.exchange(input.code);
  const acct = await payments.account(accountId);
  const bank = await balanceAccount(tx, input);
  const { rows } = await tx.query(
    `INSERT INTO stripe_connections (org_id, entity_id, stripe_account_id, livemode, bank_account_id, display_name, connected_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.orgId, input.entityId, accountId, livemode, bank.id, acct.name?.slice(0, 120) ?? null, input.actor.id],
  );
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "stripe.connected", objectType: "stripe_connection", objectId: rows[0].id,
    after: { stripeAccount: accountId, livemode, bankAccount: bank.code, chargesEnabled: acct.chargesEnabled }, context: { role: input.actor.role },
  });
  return (await activeConnection(tx, input.entityId))!;
}

/** Stops taking payments. Payments already recorded stay in the books. */
export async function disconnect(
  tx: Tx, payments: InvoicePayments | undefined, input: { orgId: string; entityId: string; actor: Actor },
): Promise<{ stripeNotified: boolean }> {
  if (!CAN_CONNECT.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", "only an owner or admin can disconnect Stripe");
  const c = await activeConnection(tx, input.entityId);
  if (!c) throw new LedgerError("INVALID", "no Stripe account is connected");
  let stripeNotified = false;
  if (payments) {
    // If Stripe can't be reached (or the owner already removed TrailBook in Stripe), still stop here.
    stripeNotified = await payments.deauthorize(c.accountId).then(() => true, () => false);
  }
  await tx.query("UPDATE stripe_connections SET status = 'removed', removed_at = now() WHERE id = $1", [c.id]);
  await tx.query("UPDATE invoice_payment_sessions SET status = 'expired', note = 'Stripe was disconnected' WHERE connection_id = $1 AND status = 'open'", [c.id]);
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "stripe.disconnected", objectType: "stripe_connection", objectId: c.id,
    after: { stripeAccount: c.accountId, stripeNotified }, context: { role: input.actor.role },
  });
  return { stripeNotified };
}

// ---------------------------------------------------- the customer's side

/** Whether a customer's link shows a Pay button. */
export async function payableByToken(pool: pg.Pool, payments: InvoicePayments | undefined, token: string): Promise<boolean> {
  if (!payments) return false;
  const link = await viewLinkFor(pool, token);
  if (!link?.documentId) return false;
  return withTenant(pool, link.orgId, async (tx) => {
    if (!(await availability(tx, link.entityId, payments)).available) return false;
    if (!(await activeConnection(tx, link.entityId))) return false;
    const d = await getDocument(tx, link.documentId!);
    return d.kind === "invoice" && d.status !== "void" && d.dueMinor > 0n;
  });
}

/** Opens a Stripe payment page for what's still due on the invoice behind a customer's link. */
export async function startCheckout(
  pool: pg.Pool, payments: InvoicePayments, input: { token: string; appUrl: string },
): Promise<{ url: string }> {
  const link = await viewLinkFor(pool, input.token);
  if (!link?.documentId) throw new LedgerError("INVALID", "this link can't take a payment");
  return withTenant(pool, link.orgId, async (tx) => {
    const a = await availability(tx, link.entityId, payments);
    if (!a.available) throw new LedgerError("INVALID", "this business doesn't take online payments");
    const c = await activeConnection(tx, link.entityId);
    if (!c) throw new LedgerError("INVALID", "this business doesn't take online payments");
    const d = await getDocument(tx, link.documentId!);
    if (d.kind !== "invoice" || d.status === "void") throw new LedgerError("INVALID", "this invoice can't be paid online");
    if (d.dueMinor <= 0n) throw new LedgerError("INVALID", "this invoice is already paid");
    if (d.currency !== a.currency) throw new LedgerError("INVALID", "this invoice can't be paid online");
    const pending = (await tx.query("SELECT 1 FROM invoice_payment_sessions WHERE document_id = $1 AND status = 'processing'", [d.id])).rows[0];
    if (pending) throw new LedgerError("INVALID", "a bank payment for this invoice is already on its way; it can take a few business days to clear");
    const business = (await tx.query("SELECT legal_name FROM entities WHERE id = $1", [link.entityId])).rows[0].legal_name as string;
    const base = input.appUrl.replace(/\/+$/, "");
    const session = await payments.createCheckout(c.accountId, {
      amountMinor: d.dueMinor, currency: d.currency, description: `Invoice ${d.number} from ${business}`,
      successUrl: `${base}/view.html?paid={CHECKOUT_SESSION_ID}#${input.token}`, cancelUrl: `${base}/view.html#${input.token}`,
      metadata: { trailbook_org: link.orgId, trailbook_entity: link.entityId, trailbook_document: d.id, invoice: d.number },
      idempotencyKey: `checkout:${d.id}:${d.dueMinor}:${Date.now()}`,
    });
    await tx.query(
      `INSERT INTO invoice_payment_sessions (org_id, entity_id, document_id, connection_id, session_id, amount_minor, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [link.orgId, link.entityId, d.id, c.id, session.id, d.dueMinor, d.currency],
    );
    return { url: session.url };
  });
}

// ------------------------------------------------------------ settlement

type SessionRecord = { id: string; org_id: string; entity_id: string; document_id: string; session_id: string; status: string; stripe_account_id: string; bank_account_id: string };

async function setSession(tx: Tx, id: string, fields: { status: string; note?: string | null; paymentIntentId?: string | null; paymentMethod?: string | null; feeMinor?: bigint | null; settled?: boolean }) {
  await tx.query(
    `UPDATE invoice_payment_sessions SET status = $2, note = coalesce($3, note), payment_intent_id = coalesce($4, payment_intent_id),
        payment_method = coalesce($5, payment_method), fee_minor = coalesce($6, fee_minor), settled_at = CASE WHEN $7 THEN now() ELSE settled_at END
      WHERE id = $1`,
    [id, fields.status, fields.note ?? null, fields.paymentIntentId ?? null, fields.paymentMethod ?? null, fields.feeMinor ?? null, Boolean(fields.settled)],
  );
}

/** Checks one payment page with Stripe and, once paid, records it. Returns the session's status. */
async function settle(tx: Tx, payments: InvoicePayments, s: SessionRecord, today: string): Promise<string> {
  if (s.status !== "open" && s.status !== "processing") return s.status;
  const info = await payments.getSession(s.stripe_account_id, s.session_id);
  const base = { paymentIntentId: info.paymentIntentId, paymentMethod: info.paymentMethod };
  if (info.status === "expired") { await setSession(tx, s.id, { status: "expired", ...base }); return "expired"; }
  if (info.status === "open") return "open";
  if (info.paymentStatus !== "paid") {
    if (info.paymentIntentStatus === "canceled" || info.paymentIntentStatus === "requires_payment_method") {
      await setSession(tx, s.id, { status: "expired", note: "The bank payment didn't go through.", ...base });
      return "expired";
    }
    await setSession(tx, s.id, { status: "processing", ...base });
    return "processing";
  }

  // Paid. Check it still fits the invoice before recording; anything odd is left for the business to look at.
  const review = async (note: string) => { await setSession(tx, s.id, { status: "needs_review", note, ...base }); return "needs_review"; };
  if (info.metadata.trailbook_document && info.metadata.trailbook_document !== s.document_id) return review("Stripe's record names a different invoice.");
  const doc = await getDocument(tx, s.document_id);
  if (info.currency !== doc.currency) return review(`Paid in ${info.currency}, but the invoice is in ${doc.currency}.`);
  if (doc.status === "void") return review(`${doc.number} was voided after the customer paid; refund the payment in Stripe or record it another way.`);
  if (info.amountMinor > doc.dueMinor) return review(`The customer paid more than is still due on ${doc.number}; record it by hand or refund the difference in Stripe.`);
  const period = (await tx.query("SELECT status FROM periods WHERE entity_id = $1 AND $2::date BETWEEN start_date AND end_date", [s.entity_id, today])).rows[0];
  if (period && period.status !== "open") return review(`The period for ${today} is closed; reopen it or record the payment by hand.`);

  const bank = (await tx.query("SELECT code FROM accounts WHERE id = $1", [s.bank_account_id])).rows[0].code as string;
  await recordPayment(tx, {
    orgId: s.org_id, entityId: s.entity_id, documentId: s.document_id, date: today, amount: info.amountMinor,
    bankAccount: bank, idempotencyKey: `stripe:${s.session_id}`, actor: STRIPE,
  });
  let note: string | null = null;
  if (info.feeMinor && info.feeMinor > 0n) {
    const fee = (await tx.query("SELECT 1 FROM accounts WHERE entity_id = $1 AND code = $2 AND type = 'expense'", [s.entity_id, FEE_ACCOUNT])).rows[0];
    if (fee && info.feeCurrency === doc.currency) {
      await postJournal(tx, {
        orgId: s.org_id, entityId: s.entity_id, date: today, memo: `Stripe fee · ${doc.number}`, sourceType: "journal_voucher", sourceId: s.id,
        idempotencyKey: `stripe-fee:${s.session_id}`, actor: STRIPE,
        lines: [{ account: FEE_ACCOUNT, debit: info.feeMinor, description: `Stripe fee · ${doc.number}` }, { account: bank, credit: info.feeMinor, description: `Stripe fee · ${doc.number}` }],
      });
    } else {
      note = "Stripe's fee wasn't recorded automatically; add it when you reconcile the Stripe balance.";
    }
  }
  await setSession(tx, s.id, { status: "paid", note, feeMinor: info.feeMinor, settled: true, ...base });
  await appendAudit(tx, {
    orgId: s.org_id, entityId: s.entity_id, actor: STRIPE.id, action: "invoice.paid_online", objectType: "invoice", objectId: s.document_id,
    after: { session: s.session_id, amountMinor: info.amountMinor.toString(), feeMinor: info.feeMinor?.toString() ?? null, method: info.paymentMethod }, context: { role: "system" },
  });
  return "paid";
}

const SESSION_SQL = `SELECT s.id, s.org_id, s.entity_id, s.document_id, s.session_id, s.status, c.stripe_account_id, c.bank_account_id
  FROM invoice_payment_sessions s JOIN stripe_connections c ON c.id = s.connection_id`;

/** When the customer comes back from Stripe's page: record the payment straight away if it's in. */
export async function confirmFromView(
  pool: pg.Pool, payments: InvoicePayments, input: { token: string; sessionId: string; today?: string },
): Promise<{ status: string }> {
  const link = await viewLinkFor(pool, input.token);
  if (!link?.documentId || !/^cs_[A-Za-z0-9_]+$/.test(input.sessionId)) throw new LedgerError("INVALID", "that payment isn't valid");
  return withTenant(pool, link.orgId, async (tx) => {
    const s = (await tx.query(`${SESSION_SQL} WHERE s.session_id = $1 AND s.document_id = $2 FOR UPDATE OF s`, [input.sessionId, link.documentId])).rows[0] as SessionRecord | undefined;
    if (!s) throw new LedgerError("INVALID", "that payment isn't valid");
    return { status: await settle(tx, payments, s, input.today ?? todayPacific()) };
  });
}

/** Catches up on payments the customer didn't come back from, and bank debits that cleared. */
export async function sweepPayments(
  pool: pg.Pool, payments: InvoicePayments, opts: { today?: string } = {},
): Promise<{ checked: number; paid: number; failed: number }> {
  const rows = await withSystem(pool, async (tx) => (await tx.query(
    `SELECT s.id, s.org_id, s.created_at FROM invoice_payment_sessions s
      WHERE s.status IN ('open', 'processing') AND s.created_at > now() - interval '30 days' ORDER BY s.created_at`,
  )).rows);
  const out = { checked: 0, paid: 0, failed: 0 };
  for (const r of rows) {
    out.checked++;
    try {
      const status = await withTenant(pool, r.org_id, async (tx) => {
        const s = (await tx.query(`${SESSION_SQL} WHERE s.id = $1 FOR UPDATE OF s`, [r.id])).rows[0] as SessionRecord;
        return settle(tx, payments, s, opts.today ?? todayPacific());
      });
      if (status === "paid") out.paid++;
    } catch (err) {
      out.failed++;
      console.error(`invoice payment ${r.id}:`, err instanceof Error ? err.message : err);
    }
  }
  // Older than that and still open: Stripe's page expired long ago.
  await withSystem(pool, (tx) => tx.query("UPDATE invoice_payment_sessions SET status = 'expired' WHERE status = 'open' AND created_at <= now() - interval '30 days'"));
  return out;
}
