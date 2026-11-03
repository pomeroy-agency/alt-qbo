import type pg from "pg";
import { randomInt } from "node:crypto";
import { withSystem, withTenant, type Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { createContact, issueDocument, recordPayment } from "../core/documents.js";
import type { Actor } from "../core/ledger.js";
import type { Mailer } from "../app/mail.js";
import { BillingError, ensureSubscription, type BillingConfig } from "./billing.js";
import { addMonths } from "./plans.js";

// The referral program for accounting and HR firms (see the migration
// 20261120000001_firm_referrals for the model). A firm brings a client with
// its code; the client gets 20% off for as long as it stays, or the firm
// earns 20% of what the client pays, before tax, for the client's first 12
// months. TrailBook works out every fee from the charges actually paid; the
// operator pays the firm outside the app and records each payout here.

export const REFERRAL_PCT = 20;
export const FEE_MONTHS = 12;
/** Balances under this (in minor units) wait for the next month's payout. */
export const MIN_PAYOUT_MINOR = 2500;
/** The version of the program terms at /referral-terms.html. */
export const REFERRAL_TERMS_VERSION = "2026-11-03";

export type Reward = "client_discount" | "firm_fee";
const REWARDS: Reward[] = ["client_discount", "firm_fee"];
const SYSTEM = { id: "system:referrals", role: "system" as const };
// No 0/O or 1/I, so a code read out over the phone is typed right.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const minor = (v: unknown) => BigInt(v as string | number);
const major = (m: bigint) => `${m < 0n ? "-" : ""}${(m < 0n ? -m : m) / 100n}.${String((m < 0n ? -m : m) % 100n).padStart(2, "0")}`;
/** 20% of a charge, rounded half up to the cent. */
export const feeOf = (baseMinor: bigint, pct = REFERRAL_PCT) => (baseMinor * BigInt(pct) + 50n) / 100n;

function newCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export function normaliseCode(v: unknown): string {
  if (typeof v !== "string") throw new BillingError("enter the firm's referral code");
  const code = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new BillingError("that referral code isn't valid");
  return code;
}

// --------------------------------------------------------------- firm side

export interface PartnerSettings {
  reward?: unknown; payoutEmail?: unknown; payoutNote?: unknown; acceptTerms?: unknown;
}

function text(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new BillingError(`${field} must be text`);
  if (v.trim().length > max) throw new BillingError(`${field} is too long`);
  return v.trim() || null;
}

/** Joins the program, or changes the firm's settings. The reward chosen applies to clients linked from now on. */
export async function savePartner(tx: Tx, orgId: string, userId: string, actor: Actor, input: PartnerSettings) {
  const reward = (input.reward ?? "client_discount") as Reward;
  if (!REWARDS.includes(reward)) throw new BillingError("pick 20% off for your clients or a 20% referral fee for your firm");
  const payoutEmail = text(input.payoutEmail, "payout email", 200);
  if (payoutEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payoutEmail)) throw new BillingError("the payout email doesn't look right");
  const payoutNote = text(input.payoutNote, "how you'd like to be paid", 300);
  // Bank details are never kept here: a payout note that looks like an account number is refused.
  if (payoutNote && /\d{7,}/.test(payoutNote.replace(/[\s-]/g, ""))) {
    throw new BillingError("please don't put account numbers here; say how you'd like to be paid and we'll ask for the details separately");
  }
  if (reward === "firm_fee" && !payoutEmail) throw new BillingError("add an email for payout notices to take the referral fee");
  const before = (await tx.query("SELECT * FROM referral_partners WHERE org_id = $1 FOR UPDATE", [orgId])).rows[0];
  if (!before) {
    if (input.acceptTerms !== true) throw new BillingError("to join, agree to the referral program terms");
    let code = newCode();
    while ((await tx.query("SELECT 1 FROM referral_partners WHERE code = $1", [code])).rows[0]) code = newCode();
    await tx.query(
      `INSERT INTO referral_partners (org_id, code, reward, payout_email, payout_note, terms_version, terms_accepted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, code, reward, payoutEmail, payoutNote, REFERRAL_TERMS_VERSION, userId],
    );
  } else {
    await tx.query(
      `UPDATE referral_partners SET reward = $2, payout_email = $3, payout_note = $4, active = true, updated_at = now(),
         terms_version = CASE WHEN $5 THEN $6 ELSE terms_version END,
         terms_accepted_at = CASE WHEN $5 THEN now() ELSE terms_accepted_at END,
         terms_accepted_by = CASE WHEN $5 THEN $7::uuid ELSE terms_accepted_by END
       WHERE org_id = $1`,
      [orgId, reward, payoutEmail, payoutNote, input.acceptTerms === true, REFERRAL_TERMS_VERSION, userId],
    );
  }
  await appendAudit(tx, {
    orgId, actor: actor.id, action: before ? "referrals.settings_changed" : "referrals.joined", objectType: "organization", objectId: orgId,
    before: before ? { reward: before.reward, payoutEmail: before.payout_email } : null, after: { reward, payoutEmail },
  });
}

/** The firm's Referrals page: its code, the clients it brought and what each has earned. */
export async function partnerOverview(tx: Tx, orgId: string) {
  const p = (await tx.query("SELECT * FROM referral_partners WHERE org_id = $1", [orgId])).rows[0];
  if (!p) return { joined: false as const, termsVersion: REFERRAL_TERMS_VERSION, pct: REFERRAL_PCT, months: FEE_MONTHS };
  const clients = (await tx.query(
    `SELECT s.org_id, o.name, s.status, s.partner_reward, s.partner_linked_at,
            (SELECT min(c.period_start) FROM billing_charges c WHERE c.org_id = s.org_id AND c.status = 'paid') AS first_paid,
            coalesce((SELECT sum(f.fee_minor) FROM referral_fees f WHERE f.client_org_id = s.org_id AND f.partner_org_id = $1 AND f.status = 'owed'), 0) AS owed_minor,
            coalesce((SELECT sum(f.fee_minor) FROM referral_fees f WHERE f.client_org_id = s.org_id AND f.partner_org_id = $1 AND f.status = 'paid'), 0) AS paid_minor,
            (SELECT max(f.currency) FROM referral_fees f WHERE f.client_org_id = s.org_id AND f.partner_org_id = $1) AS currency
       FROM subscriptions s JOIN organizations o ON o.id = s.org_id
      WHERE s.partner_org_id = $1 ORDER BY s.partner_linked_at DESC`,
    [orgId],
  )).rows.map((r) => ({
    name: r.name as string, status: r.status as string, reward: r.partner_reward as Reward, linkedAt: r.partner_linked_at,
    firstPaid: r.first_paid as string | null,
    feeUntil: r.partner_reward === "firm_fee" && r.first_paid ? addMonths(r.first_paid, FEE_MONTHS) : null,
    owedMinor: String(r.owed_minor), paidMinor: String(r.paid_minor), currency: (r.currency ?? "USD") as string,
  }));
  const payouts = (await tx.query(
    "SELECT paid_on, currency, total_minor, method, reference FROM referral_payouts WHERE partner_org_id = $1 ORDER BY paid_on DESC, created_at DESC",
    [orgId],
  )).rows.map((r) => ({ paidOn: r.paid_on, currency: r.currency, totalMinor: String(r.total_minor), method: r.method, reference: r.reference }));
  return {
    joined: true as const, code: p.code as string, reward: p.reward as Reward, payoutEmail: p.payout_email, payoutNote: p.payout_note,
    w9Received: p.w9_received as boolean, termsVersion: p.terms_version as string, currentTermsVersion: REFERRAL_TERMS_VERSION,
    pct: REFERRAL_PCT, months: FEE_MONTHS, minPayoutMinor: String(MIN_PAYOUT_MINOR), clients, payouts,
  };
}

// --------------------------------------------------------------- client side

/** Who referred this client, for its Billing page, and whether a code can still be entered. */
export async function clientReferral(tx: Tx, orgId: string, today: string) {
  const sub = await ensureSubscription(tx, orgId, today);
  const paid = Boolean((await tx.query("SELECT 1 FROM billing_charges WHERE org_id = $1 AND status = 'paid' LIMIT 1", [orgId])).rows[0]);
  const s = (await tx.query(
    `SELECT s.partner_reward, s.partner_linked_at, o.name FROM subscriptions s LEFT JOIN organizations o ON o.id = s.partner_org_id WHERE s.org_id = $1`, [orgId],
  )).rows[0];
  return {
    firm: s?.name ? { name: s.name as string, reward: s.partner_reward as Reward, linkedAt: s.partner_linked_at } : null,
    canChange: !paid, pct: REFERRAL_PCT, months: FEE_MONTHS, discountPct: sub.partner_discount_pct,
  };
}

/**
 * Links a client to the firm whose code it entered. Allowed until the client's
 * first payment; after that only the operator changes it, so a fee or
 * discount can't be switched around mid-subscription.
 */
export async function linkReferral(tx: Tx, orgId: string, today: string, codeInput: unknown, actor: Actor, opts: { operator?: boolean } = {}) {
  const code = normaliseCode(codeInput);
  await ensureSubscription(tx, orgId, today);
  const sub = (await tx.query("SELECT * FROM subscriptions WHERE org_id = $1 FOR UPDATE", [orgId])).rows[0];
  const p = (await tx.query("SELECT * FROM referral_partners WHERE code = $1 AND active", [code])).rows[0];
  if (!p) throw new BillingError("that referral code isn't valid");
  if (p.org_id === orgId) throw new BillingError("a firm can't refer itself");
  if (!opts.operator) {
    if ((await tx.query("SELECT 1 FROM billing_charges WHERE org_id = $1 AND status = 'paid' LIMIT 1", [orgId])).rows[0]) {
      throw new BillingError("a referral code can only be added before the first payment; contact us if your firm was missed", 409);
    }
  }
  // A firm's own owners can't collect a fee on their own business.
  if (p.reward === "firm_fee") {
    const shared = await tx.query(
      `SELECT 1 FROM memberships a JOIN memberships b ON a.user_id = b.user_id
        WHERE a.org_id = $1 AND a.role = 'owner' AND b.org_id = $2 AND b.role IN ('owner', 'admin') LIMIT 1`,
      [orgId, p.org_id],
    );
    if (shared.rows[0]) throw new BillingError("this firm's referral fee can't apply to a business its own owners run");
  }
  const discount = p.reward === "client_discount" ? REFERRAL_PCT : 0;
  await tx.query(
    `UPDATE subscriptions SET partner_org_id = $2, partner_reward = $3, partner_discount_pct = $4, partner_linked_at = now(), updated_at = now()
      WHERE org_id = $1`,
    [orgId, p.org_id, p.reward, discount],
  );
  await appendAudit(tx, {
    orgId, actor: actor.id, action: "billing.referral_linked", objectType: "organization", objectId: orgId,
    before: sub.partner_org_id ? { partnerOrgId: sub.partner_org_id, reward: sub.partner_reward } : null,
    after: { partnerOrgId: p.org_id, reward: p.reward, discountPct: discount }, context: opts.operator ? { by: "operator" } : undefined,
  });
  return { reward: p.reward as Reward };
}

/** Removes the firm before the first payment (or by the operator at any time). Fees already earned stay. */
export async function unlinkReferral(tx: Tx, orgId: string, actor: Actor, opts: { operator?: boolean } = {}) {
  const sub = (await tx.query("SELECT * FROM subscriptions WHERE org_id = $1 FOR UPDATE", [orgId])).rows[0];
  if (!sub?.partner_org_id) return;
  if (!opts.operator && (await tx.query("SELECT 1 FROM billing_charges WHERE org_id = $1 AND status = 'paid' LIMIT 1", [orgId])).rows[0]) {
    throw new BillingError("the referring firm can only be removed before the first payment; contact us to change it", 409);
  }
  await tx.query(
    "UPDATE subscriptions SET partner_org_id = NULL, partner_reward = NULL, partner_discount_pct = 0, partner_linked_at = NULL, updated_at = now() WHERE org_id = $1",
    [orgId],
  );
  await appendAudit(tx, {
    orgId, actor: actor.id, action: "billing.referral_removed", objectType: "organization", objectId: orgId,
    before: { partnerOrgId: sub.partner_org_id, reward: sub.partner_reward }, after: null,
  });
}

// --------------------------------------------------------------- fees

/**
 * Records a fee for every paid charge that earns one: the client chose a
 * firm that takes the fee, the charge was paid after the link, and its
 * period starts within 12 months of the client's first paid period. Safe to
 * run any number of times; each charge earns at most one fee.
 */
export async function accrueReferralFees(pool: pg.Pool): Promise<number> {
  return withSystem(pool, async (tx) => {
    const r = await tx.query(
      `WITH firsts AS (
         SELECT org_id, min(period_start) AS first_start FROM billing_charges WHERE status = 'paid' GROUP BY org_id
       )
       INSERT INTO referral_fees (partner_org_id, client_org_id, charge_id, currency, base_minor, rate_pct, fee_minor, earned_on)
       SELECT s.partner_org_id, c.org_id, c.id, coalesce(to_jsonb(c)->>'currency', 'USD'), c.subtotal_minor, $1::int,
              (c.subtotal_minor * $1::int + 50) / 100, coalesce(c.paid_at, c.updated_at)::date
         FROM billing_charges c
         JOIN subscriptions s ON s.org_id = c.org_id
         JOIN referral_partners p ON p.org_id = s.partner_org_id
         JOIN firsts f ON f.org_id = c.org_id
        WHERE c.status = 'paid' AND s.partner_reward = 'firm_fee'
          AND coalesce(c.paid_at, c.updated_at) >= s.partner_linked_at
          AND c.period_start < (f.first_start + make_interval(months => $2::int))::date
          AND c.subtotal_minor > 0
       ON CONFLICT (charge_id) DO NOTHING`,
      [REFERRAL_PCT, FEE_MONTHS],
    );
    return r.rowCount ?? 0;
  });
}

// --------------------------------------------------------------- operator side

/** The operator's Referral fees page: every firm, what it is owed and what it has been paid. */
export async function operatorOverview(tx: Tx) {
  const partners = (await tx.query(
    `SELECT p.org_id, o.name, p.code, p.reward, p.payout_email, p.payout_note, p.w9_received, p.active,
            (SELECT count(*) FROM subscriptions s WHERE s.partner_org_id = p.org_id) AS clients
       FROM referral_partners p JOIN organizations o ON o.id = p.org_id ORDER BY o.name`,
  )).rows;
  const owed = (await tx.query(
    `SELECT partner_org_id, currency, sum(fee_minor) AS owed_minor, count(*) AS fees FROM referral_fees WHERE status = 'owed' GROUP BY 1, 2`,
  )).rows;
  const fees = (await tx.query(
    `SELECT f.id, f.partner_org_id, o.name AS client, f.currency, f.base_minor, f.fee_minor, f.earned_on, f.status, f.void_reason, c.invoice_number
       FROM referral_fees f JOIN organizations o ON o.id = f.client_org_id JOIN billing_charges c ON c.id = f.charge_id
      WHERE f.status = 'owed' OR f.earned_on > current_date - 400 ORDER BY f.earned_on DESC`,
  )).rows;
  const payouts = (await tx.query(
    `SELECT r.*, o.name FROM referral_payouts r JOIN organizations o ON o.id = r.partner_org_id ORDER BY r.paid_on DESC, r.created_at DESC LIMIT 200`,
  )).rows;
  return {
    minPayoutMinor: String(MIN_PAYOUT_MINOR),
    partners: partners.map((p) => ({
      orgId: p.org_id, name: p.name, code: p.code, reward: p.reward, payoutEmail: p.payout_email, payoutNote: p.payout_note,
      w9Received: p.w9_received, active: p.active, clients: Number(p.clients),
      owed: owed.filter((o) => o.partner_org_id === p.org_id).map((o) => ({ currency: o.currency, owedMinor: String(o.owed_minor), fees: Number(o.fees) })),
    })),
    fees: fees.map((f) => ({
      id: f.id, partnerOrgId: f.partner_org_id, client: f.client, currency: f.currency, baseMinor: String(f.base_minor), feeMinor: String(f.fee_minor),
      earnedOn: f.earned_on, status: f.status, voidReason: f.void_reason, invoiceNumber: f.invoice_number,
    })),
    payouts: payouts.map((r) => ({
      id: r.id, partnerOrgId: r.partner_org_id, name: r.name, currency: r.currency, totalMinor: String(r.total_minor), bookedMinor: String(r.booked_minor),
      paidOn: r.paid_on, method: r.method, reference: r.reference, billNumber: r.bill_number,
    })),
  };
}

export async function setW9(tx: Tx, partnerOrgId: string, received: boolean) {
  const r = await tx.query("UPDATE referral_partners SET w9_received = $2, updated_at = now() WHERE org_id = $1", [partnerOrgId, received]);
  if (!r.rowCount) throw new BillingError("no such firm", 404);
}

/** Cancels one owed fee, for a refund, a chargeback or a referral that broke the program terms. */
export async function voidFee(tx: Tx, feeId: string, reason: unknown) {
  const why = text(reason, "reason", 300);
  if (!why) throw new BillingError("say why the fee is cancelled");
  const r = await tx.query(
    "UPDATE referral_fees SET status = 'void', void_reason = $2, updated_at = now() WHERE id = $1 AND status = 'owed'", [feeId, why],
  );
  if (!r.rowCount) throw new BillingError("only a fee that is still owed can be cancelled", 409);
}

export interface PayoutInput {
  partnerOrgId: string; currency: unknown; paidOn: string; method: unknown; reference?: unknown;
  /** The expense account in the seller's books; "6000" Advertising if not given. */
  account?: unknown;
  /** For a payout in a currency other than the seller's books: what it cost there, in major units. */
  bookedAmount?: unknown;
}

/**
 * Records a payout the operator made outside the app: every owed fee for
 * the firm in that currency, earned on or before the payout date, is marked
 * paid, and the seller's books get a bill from the firm, paid the same day.
 */
export async function recordPayout(pool: pg.Pool, cfg: BillingConfig & { mailer?: Mailer }, input: PayoutInput, actor: Actor) {
  const seller = cfg.seller;
  if (!seller) throw new BillingError("billing isn't set up, so there are no seller books to record the payout in", 503);
  const currency = String(input.currency ?? "USD").toUpperCase();
  if (!["USD", "CAD"].includes(currency)) throw new BillingError("pick US or Canadian dollars");
  const method = text(input.method, "how it was paid", 80);
  if (!method) throw new BillingError("say how it was paid (for example ACH, e-Transfer or cheque)");
  const reference = text(input.reference, "reference", 120);
  const account = text(input.account, "expense account", 40) ?? "6000";

  const claimed = await withSystem(pool, async (tx) => {
    const p = (await tx.query(
      "SELECT p.*, o.name FROM referral_partners p JOIN organizations o ON o.id = p.org_id WHERE p.org_id = $1 FOR UPDATE OF p", [input.partnerOrgId],
    )).rows[0];
    if (!p) throw new BillingError("no such firm", 404);
    const fees = (await tx.query(
      "SELECT id, fee_minor FROM referral_fees WHERE partner_org_id = $1 AND currency = $2 AND status = 'owed' AND earned_on <= $3 FOR UPDATE",
      [input.partnerOrgId, currency, input.paidOn],
    )).rows;
    const total = fees.reduce((s, f) => s + minor(f.fee_minor), 0n);
    if (total <= 0n) throw new BillingError("nothing is owed to this firm in that currency");
    return { p, fees, total };
  });
  const { p, fees, total } = claimed;

  const bookCurrency: string = (await pool.query("SELECT functional_currency FROM entities WHERE id = $1", [seller.entityId])).rows[0]?.functional_currency?.trim() ?? "USD";
  let booked = total;
  if (bookCurrency !== currency) {
    const v = String(input.bookedAmount ?? "");
    if (!/^\d+(\.\d{1,2})?$/.test(v) || Number(v) <= 0) {
      throw new BillingError(`this payout was in ${currency}; enter what it cost in ${bookCurrency} (from your bank statement)`);
    }
    const [w, f = ""] = v.split(".");
    booked = BigInt(w!) * 100n + BigInt(f.padEnd(2, "0"));
  }

  const payoutId = (await pool.query("SELECT gen_random_uuid() AS id")).rows[0].id as string;
  // The seller's books first: if this fails, nothing is marked paid.
  const bill = await withTenant(pool, seller.orgId, async (tx) => {
    let vendorId: string | null = p.seller_vendor_id;
    if (vendorId && !(await tx.query("SELECT 1 FROM contacts WHERE id = $1 AND entity_id = $2", [vendorId, seller.entityId])).rows[0]) vendorId = null;
    if (!vendorId) {
      const existing = (await tx.query("SELECT id FROM contacts WHERE entity_id = $1 AND lower(name) = lower($2)", [seller.entityId, p.name])).rows[0];
      vendorId = existing?.id ?? (await createContact(tx, {
        orgId: seller.orgId, entityId: seller.entityId, kind: "vendor", name: p.name, email: p.payout_email ?? undefined, actor,
      })).id;
    }
    const doc = await issueDocument(tx, {
      orgId: seller.orgId, entityId: seller.entityId, kind: "bill", contactId: vendorId!, issueDate: input.paidOn, dueDate: input.paidOn,
      reference: reference ?? undefined,
      memo: `TrailBook referral fees, ${fees.length} payment${fees.length === 1 ? "" : "s"} by referred clients${bookCurrency !== currency ? ` (${currency} ${major(total)} paid)` : ""}`,
      lines: [{ account, description: `Referral fees (${REFERRAL_PCT}% of clients' first ${FEE_MONTHS} months)`, quantity: "1", unitPrice: major(booked) }],
      idempotencyKey: `referral-payout:${payoutId}`, actor,
    });
    await recordPayment(tx, {
      orgId: seller.orgId, entityId: seller.entityId, documentId: doc.id, date: input.paidOn, amount: doc.totalMinor,
      bankAccount: seller.bankAccount, idempotencyKey: `referral-payout:${payoutId}`, actor,
    });
    return { id: doc.id, number: doc.number, vendorId: vendorId! };
  });

  await withSystem(pool, async (tx) => {
    await tx.query(
      `INSERT INTO referral_payouts (id, partner_org_id, currency, total_minor, booked_minor, paid_on, method, reference, bill_id, bill_number, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [payoutId, p.org_id, currency, total, booked, input.paidOn, method, reference, bill.id, bill.number, actor.id],
    );
    const r = await tx.query(
      "UPDATE referral_fees SET status = 'paid', payout_id = $2, updated_at = now() WHERE id = ANY($1) AND status = 'owed'",
      [fees.map((f) => f.id), payoutId],
    );
    if (r.rowCount !== fees.length) throw new BillingError("the fees changed while the payout was being recorded; reload and try again", 409);
    await tx.query("UPDATE referral_partners SET seller_vendor_id = $2, updated_at = now() WHERE org_id = $1", [p.org_id, bill.vendorId]);
    await appendAudit(tx, {
      orgId: p.org_id, actor: SYSTEM.id, action: "referrals.payout_recorded", objectType: "referral_payout", objectId: payoutId,
      after: { currency, totalMinor: String(total), paidOn: input.paidOn, method, fees: fees.length }, context: { by: actor.id },
    });
  });

  if (cfg.mailer && p.payout_email) {
    await cfg.mailer({
      to: p.payout_email,
      subject: `TrailBook referral fees paid: ${currency} ${major(total)}`,
      text: `We've paid ${p.name} ${currency} ${major(total)} in TrailBook referral fees, by ${method}${reference ? ` (reference ${reference})` : ""}, on ${input.paidOn}.\n\n`
        + `It covers ${fees.length} payment${fees.length === 1 ? "" : "s"} made by clients you referred. The details are on the Referrals page in TrailBook${cfg.appUrl ? ` (${cfg.appUrl}/#/referrals)` : ""}.\n`,
    }).catch((err) => console.error("referral payout email failed", err));
  }
  return { payoutId, totalMinor: String(total), currency, fees: fees.length, billNumber: bill.number };
}

/** For the morning billing run: a note to the operator, on the 1st of each month, of what firms are owed. */
export async function owedSummary(pool: pg.Pool): Promise<string | null> {
  const rows = (await pool.query(
    `SELECT o.name, f.currency, sum(f.fee_minor) AS owed, bool_and(p.w9_received) AS w9
       FROM referral_fees f JOIN referral_partners p ON p.org_id = f.partner_org_id JOIN organizations o ON o.id = f.partner_org_id
      WHERE f.status = 'owed' GROUP BY o.name, f.currency ORDER BY o.name`,
  )).rows;
  const due = rows.filter((r) => minor(r.owed) >= BigInt(MIN_PAYOUT_MINOR));
  if (!due.length) return null;
  return due.map((r) => `${r.name}: ${r.currency} ${major(minor(r.owed))}${r.w9 ? "" : " (no W-9 on file yet, if a US firm)"}`).join("\n");
}
