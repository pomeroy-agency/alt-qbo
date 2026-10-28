import type pg from "pg";
import { withSystem, withTenant, type Tx } from "../db/pool.js";
import { createContact, recordPayment, updateContact, type ContactAddress } from "../core/documents.js";
import { issueInvoice, type RateLookup } from "../core/sales-tax.js";
import type { Mailer } from "../app/mail.js";
import type { PaymentGateway, SavedCard } from "./gateway.js";
import {
  CURRENT_PRICES, FOUNDING_LOCK_MONTHS, FOUNDING_SEATS, GRACE_DAYS, PLAN_NAMES, RETRY_DAYS, TRIAL_DAYS,
  addDays, addMonths, daysBetween, periodEnd, type Interval, type Plan, type PriceList,
} from "./plans.js";

// TrailBook's own subscriptions. Each organisation starts with a 30-day trial
// of everything. After that it pays per business, by card, monthly or
// yearly. Every charge is an invoice in the seller's own TrailBook books, so
// TrailBook's revenue and sales tax are recorded the same way as any client's,
// and the card is then charged for that invoice's total. A business that
// stops paying never loses its books: they stay readable and downloadable,
// and only changes are paused.

export interface BillingConfig {
  gateway?: PaymentGateway;
  /** The business that sells TrailBook: its books get the invoices and payments. */
  seller?: { orgId: string; entityId: string; bankAccount?: string };
  /** When on, an organisation whose trial ended unpaid, or whose payment is overdue past the grace period, becomes read-only. */
  enforce?: boolean;
  /** Organisations that never pay: practice examples. The seller's own organisation is free too. */
  freeOrgNames?: string[];
  taxRates?: RateLookup;
  mailer?: Mailer;
  appUrl?: string;
}

const SYSTEM = { id: "system:billing", role: "system" as const };
const SOFTWARE = "prewritten_software";
const MAX_ATTEMPTS = 4;

export class BillingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

interface Sub {
  org_id: string; plan: Plan; interval: Interval; next_plan: Plan | null; next_interval: Interval | null;
  status: "trialing" | "active" | "past_due" | "canceled"; trial_ends_on: string; period_start: string | null; period_end: string | null;
  people_billed_through: string | null; past_due_since: string | null; cancel_at_period_end: boolean; prices: PriceList;
  founding: boolean; price_locked_until: string | null; billing_name: string | null; billing_email: string | null;
  address_line1: string | null; address_city: string | null; address_state: string | null; address_zip: string | null;
  processor_customer: string | null; processor_card: string | null; card_brand: string | null; card_last4: string | null; card_exp: string | null;
  seller_contact_id: string | null; partner_discount_pct: number;
}

export interface ChargeLine { description: string; quantity: number; unitMinor: number; periodStart: string; periodEnd: string }

async function isFree(tx: Tx, orgId: string, cfg: BillingConfig): Promise<boolean> {
  if (cfg.seller?.orgId === orgId) return true;
  const org = (await tx.query("SELECT name FROM organizations WHERE id = $1", [orgId])).rows[0];
  return Boolean(org && (cfg.freeOrgNames ?? []).includes(org.name));
}

/** The organisation's subscription, starting its trial the first time it's asked for. */
export async function ensureSubscription(tx: Tx, orgId: string, today: string): Promise<Sub> {
  await tx.query(
    "INSERT INTO subscriptions (org_id, trial_ends_on, prices) VALUES ($1, $2, $3) ON CONFLICT (org_id) DO NOTHING",
    [orgId, addDays(today, TRIAL_DAYS), JSON.stringify(CURRENT_PRICES)],
  );
  return (await tx.query("SELECT * FROM subscriptions WHERE org_id = $1", [orgId])).rows[0];
}

// --------------------------------------------------------------- access

export interface Access { level: "full" | "read_only"; reason?: string; warning?: string }

export function accessFor(sub: Sub, today: string): Access {
  if (sub.status === "trialing") {
    if (today <= sub.trial_ends_on) return { level: "full" };
    return { level: "read_only", reason: "your free trial has ended; add a card under Billing to keep making changes (your books stay readable and downloadable)" };
  }
  if (sub.status === "canceled" || (sub.cancel_at_period_end && sub.period_end && today > sub.period_end)) {
    return { level: "read_only", reason: "this subscription has ended; restart it under Billing to make changes (your books stay readable and downloadable)" };
  }
  if (sub.status === "past_due" && sub.past_due_since) {
    const until = addDays(sub.past_due_since, GRACE_DAYS);
    if (today > until) return { level: "read_only", reason: "the last payment didn't go through; update the card under Billing to keep making changes (your books stay readable and downloadable)" };
    return { level: "full", warning: `The last payment didn't go through. Update your card under Billing by ${until} to keep making changes.` };
  }
  return { level: "full" };
}

/** Changes that belong to payroll, which Books alone doesn't include. */
const PAYROLL_WRITE = /\/(employees|pay-runs|payroll-[\w-]+|direct-deposit[\w-]*|tax-deposits[\w/-]*|deposit-schedule|employer-account)(\/|$)/;

/**
 * Whether this organisation may make this change now. Free organisations,
 * and sites without enforcement, always may. The trial includes payroll.
 */
export async function checkAccess(pool: pg.Pool, orgId: string, cfg: BillingConfig, today: string, path = ""): Promise<Access> {
  if (!cfg.enforce) return { level: "full" };
  return withSystem(pool, async (tx) => {
    if (await isFree(tx, orgId, cfg)) return { level: "full" };
    const sub = await ensureSubscription(tx, orgId, today);
    const access = accessFor(sub, today);
    if (access.level === "full" && sub.status !== "trialing" && sub.plan === "books" && PAYROLL_WRITE.test(path)) {
      return { level: "read_only", reason: "payroll is part of Books + Payroll; switch plans under Billing to run payroll" };
    }
    return access;
  });
}

// --------------------------------------------------------------- pricing

async function businessCount(tx: Tx, orgId: string): Promise<number> {
  return (await tx.query("SELECT count(*)::int AS n FROM entities WHERE org_id = $1", [orgId])).rows[0].n;
}

/** People paid in posted pay runs with a pay date from `from` to `to`, across all the organisation's businesses. */
export async function peoplePaid(tx: Tx, orgId: string, from: string, to: string): Promise<number> {
  const { rows } = await tx.query(
    `SELECT count(DISTINCT p->>'employeeId')::int AS n
       FROM pay_runs r, jsonb_array_elements(r.result->'paychecks') p
      WHERE r.org_id = $1 AND r.status = 'posted' AND (r.result->>'payDate')::date BETWEEN $2 AND $3`,
    [orgId, from, to],
  );
  return rows[0].n;
}

const intervalWord = (i: Interval) => (i === "month" ? "monthly" : "yearly");

function planLines(prices: PriceList, plan: Plan, interval: Interval, businesses: number, start: string, end: string): ChargeLine[] {
  const lines: ChargeLine[] = [{ description: `TrailBook ${PLAN_NAMES[plan]}, ${intervalWord(interval)}`, quantity: 1, unitMinor: prices.plan[plan][interval], periodStart: start, periodEnd: end }];
  if (businesses > 1) {
    lines.push({ description: `Additional business, ${PLAN_NAMES[plan]}, ${intervalWord(interval)}`, quantity: businesses - 1, unitMinor: prices.extraBusiness[plan][interval], periodStart: start, periodEnd: end });
  }
  return lines;
}

function peopleLine(prices: PriceList, people: number, from: string, to: string): ChargeLine[] {
  return people > 0 ? [{ description: `People paid ${from} to ${to}`, quantity: people, unitMinor: prices.perPersonMonth, periodStart: from, periodEnd: to }] : [];
}

const subtotal = (lines: ChargeLine[]) => lines.reduce((s, l) => s + l.quantity * l.unitMinor, 0);

/** A partner firm's client discount, shown on each line it lowers. */
function discounted(lines: ChargeLine[], pct: number): ChargeLine[] {
  if (!pct) return lines;
  return lines.map((l) => ({ ...l, description: `${l.description} (${pct}% partner discount)`, unitMinor: Math.round((l.unitMinor * (100 - pct)) / 100) }));
}

/** What the next renewal would charge, before tax. */
export async function estimateRenewal(tx: Tx, sub: Sub, today: string): Promise<{ periodStart: string; periodEnd: string; lines: ChargeLine[]; subtotalMinor: number }> {
  const plan = sub.next_plan ?? sub.plan;
  const interval = sub.next_interval ?? sub.interval;
  const start = sub.period_end ? addDays(sub.period_end, 1) : sub.status === "trialing" && today <= sub.trial_ends_on ? addDays(sub.trial_ends_on, 1) : today;
  const end = periodEnd(start, interval);
  const lines = planLines(sub.prices, plan, interval, await businessCount(tx, sub.org_id), start, end);
  if (sub.plan === "books_payroll" && sub.interval === "month" && sub.people_billed_through && sub.people_billed_through < addDays(start, -1)) {
    const from = addDays(sub.people_billed_through, 1);
    lines.push(...peopleLine(sub.prices, await peoplePaid(tx, sub.org_id, from, addDays(start, -1)), from, addDays(start, -1)));
  }
  const final = discounted(lines, sub.partner_discount_pct);
  return { periodStart: start, periodEnd: end, lines: final, subtotalMinor: subtotal(final) };
}

// --------------------------------------------------------------- changes

const ADDRESS_FIELDS = ["line1", "city", "state", "zip"] as const;

export async function saveBillingDetails(
  tx: Tx, orgId: string, today: string,
  d: { name?: unknown; email?: unknown; address?: Partial<Record<(typeof ADDRESS_FIELDS)[number], unknown>> },
): Promise<void> {
  await ensureSubscription(tx, orgId, today);
  const text = (v: unknown, field: string, max = 120) => {
    if (typeof v !== "string" || !v.trim()) throw new BillingError(`${field} is required`);
    if (v.length > max) throw new BillingError(`${field} is too long`);
    return v.trim();
  };
  const name = text(d.name, "the billing name");
  const email = text(d.email, "the billing email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BillingError("enter a valid billing email");
  const a = d.address ?? {};
  const line1 = text(a.line1, "the street address"), city = text(a.city, "the city");
  const state = text(a.state, "the state", 2).toUpperCase(), zip = text(a.zip, "the ZIP code", 10);
  if (!/^[A-Z]{2}$/.test(state)) throw new BillingError("the state is two letters, like CA");
  if (!/^\d{5}(-\d{4})?$/.test(zip)) throw new BillingError("the ZIP code looks like 90012");
  // At launch TrailBook is sold to California businesses only.
  if (state !== "CA") throw new BillingError("for now, TrailBook is only available to businesses based in California");
  await tx.query(
    `UPDATE subscriptions SET billing_name = $2, billing_email = $3, address_line1 = $4, address_city = $5, address_state = $6, address_zip = $7, updated_at = now()
      WHERE org_id = $1`,
    [orgId, name, email, line1, city, state, zip],
  );
}

/**
 * Chooses a plan and how often to pay. During the trial, and when moving up
 * to Books + Payroll, it takes effect now; an upgrade mid-period is charged
 * for the days left. Moving down or switching between monthly and yearly
 * waits for the next renewal.
 */
export async function choosePlan(tx: Tx, orgId: string, today: string, plan: unknown, interval: unknown): Promise<{ upgradeChargeId?: string }> {
  if (plan !== "books" && plan !== "books_payroll") throw new BillingError("pick a plan");
  if (interval !== "month" && interval !== "year") throw new BillingError("pick monthly or yearly");
  const sub = await ensureSubscription(tx, orgId, today);
  if (sub.status === "trialing" || sub.status === "canceled" || !sub.period_end) {
    await tx.query("UPDATE subscriptions SET plan = $2, interval = $3, next_plan = NULL, next_interval = NULL, updated_at = now() WHERE org_id = $1", [orgId, plan, interval]);
    return {};
  }
  const nextInterval = interval === sub.interval ? null : interval;
  if (plan === "books_payroll" && sub.plan === "books") {
    // Upgrade now; charge the difference for the rest of the current period.
    const left = daysBetween(today, sub.period_end) + 1;
    const total = daysBetween(sub.period_start!, sub.period_end) + 1;
    const businesses = await businessCount(tx, orgId);
    const full = (p: Plan) => sub.prices.plan[p][sub.interval] + Math.max(0, businesses - 1) * sub.prices.extraBusiness[p][sub.interval];
    const diff = Math.round(((full("books_payroll") - full("books")) * left * (100 - sub.partner_discount_pct)) / total / 100);
    await tx.query("UPDATE subscriptions SET plan = 'books_payroll', next_plan = NULL, next_interval = $2, updated_at = now() WHERE org_id = $1", [orgId, nextInterval]);
    // Payroll for the rest of a yearly period: people are billed monthly from now.
    if (sub.interval === "year") await tx.query("UPDATE subscriptions SET people_billed_through = $2 WHERE org_id = $1", [orgId, addDays(today, -1)]);
    if (diff <= 0) return {};
    const lines: ChargeLine[] = [{ description: `Upgrade to ${PLAN_NAMES.books_payroll} for ${left} of ${total} days`, quantity: 1, unitMinor: diff, periodStart: today, periodEnd: sub.period_end }];
    const { rows } = await tx.query(
      `INSERT INTO billing_charges (org_id, kind, period_start, period_end, plan, interval, lines, subtotal_minor)
       VALUES ($1, 'upgrade', $2, $3, 'books_payroll', $4, $5, $6) ON CONFLICT (org_id, kind, period_start) DO NOTHING RETURNING id`,
      [orgId, today, sub.period_end, sub.interval, JSON.stringify(lines), diff],
    );
    return { upgradeChargeId: rows[0]?.id };
  }
  await tx.query(
    "UPDATE subscriptions SET next_plan = $2, next_interval = $3, updated_at = now() WHERE org_id = $1",
    [orgId, plan === sub.plan ? null : plan, nextInterval],
  );
  return {};
}

/** Stops renewal at the end of the paid period (or ends a trial now). Undone by `resume`. */
export async function cancel(tx: Tx, orgId: string, today: string): Promise<void> {
  const sub = await ensureSubscription(tx, orgId, today);
  if (sub.status === "trialing" || !sub.period_end) {
    await tx.query("UPDATE subscriptions SET status = 'canceled', canceled_at = now(), updated_at = now() WHERE org_id = $1", [orgId]);
    return;
  }
  await tx.query("UPDATE subscriptions SET cancel_at_period_end = true, canceled_at = now(), updated_at = now() WHERE org_id = $1", [orgId]);
}

export async function resume(tx: Tx, orgId: string, today: string): Promise<void> {
  const sub = await ensureSubscription(tx, orgId, today);
  if (sub.status === "canceled") {
    // Restarting after the end: billing starts again from today once a card is on file.
    await tx.query(
      `UPDATE subscriptions SET status = 'trialing', trial_ends_on = $2, period_start = NULL, period_end = NULL, cancel_at_period_end = false,
         canceled_at = NULL, updated_at = now() WHERE org_id = $1`,
      [orgId, addDays(today, -1)],
    );
    return;
  }
  await tx.query("UPDATE subscriptions SET cancel_at_period_end = false, canceled_at = NULL, updated_at = now() WHERE org_id = $1", [orgId]);
}

/** Records the card saved on the processor's page, and makes failed charges due again. */
export async function saveCard(tx: Tx, orgId: string, card: SavedCard, today: string): Promise<void> {
  if (card.orgId !== orgId) throw new BillingError("that card setup belongs to another organisation", 403);
  await tx.query(
    `UPDATE subscriptions SET processor_customer = $2, processor_card = $3, card_brand = $4, card_last4 = $5, card_exp = $6, updated_at = now()
      WHERE org_id = $1`,
    [orgId, card.customerId, card.paymentMethodId, card.brand, card.last4, `${String(card.expMonth).padStart(2, "0")}/${card.expYear}`],
  );
  // Attempts keep counting, so each try reaches the processor with a new idempotency key.
  await tx.query("UPDATE billing_charges SET next_attempt_on = $2, updated_at = now() WHERE org_id = $1 AND status = 'failed'", [orgId, today]);
}

// --------------------------------------------------------------- summary

export async function billingSummary(tx: Tx, orgId: string, today: string, cfg: BillingConfig) {
  if (await isFree(tx, orgId, cfg)) return { free: true as const };
  const sub = await ensureSubscription(tx, orgId, today);
  const charges = (await tx.query(
    `SELECT id, kind, period_start::text, period_end::text, subtotal_minor, tax_minor, total_minor, invoice_number, status, failure, attempts, next_attempt_on::text, paid_at, created_at
       FROM billing_charges WHERE org_id = $1 ORDER BY created_at DESC LIMIT 36`,
    [orgId],
  )).rows;
  const foundingLeft = Math.max(0, FOUNDING_SEATS - (await tx.query("SELECT count(*)::int AS n FROM subscriptions WHERE founding")).rows[0].n);
  return {
    free: false as const,
    plan: sub.plan, interval: sub.interval, nextPlan: sub.next_plan, nextInterval: sub.next_interval, status: sub.status,
    trialEndsOn: sub.trial_ends_on, periodStart: sub.period_start, periodEnd: sub.period_end, cancelAtPeriodEnd: sub.cancel_at_period_end,
    founding: sub.founding, priceLockedUntil: sub.price_locked_until, foundingSeatsLeft: foundingLeft, partnerDiscountPct: sub.partner_discount_pct,
    prices: sub.prices,
    billing: { name: sub.billing_name, email: sub.billing_email, address: sub.address_line1 ? { line1: sub.address_line1, city: sub.address_city, state: sub.address_state, zip: sub.address_zip } : null },
    card: sub.card_last4 ? { brand: sub.card_brand, last4: sub.card_last4, exp: sub.card_exp } : null,
    access: accessFor(sub, today),
    next: sub.status === "canceled" || sub.cancel_at_period_end ? null : await estimateRenewal(tx, sub, today),
    businesses: await businessCount(tx, orgId),
    charges,
    cardPayments: Boolean(cfg.gateway && cfg.seller),
  };
}

// ----------------------------------------------------------- charging

async function createCharge(tx: Tx, sub: Sub, kind: "renewal" | "people", start: string, end: string, lines: ChargeLine[], plan: Plan, interval: Interval) {
  await tx.query(
    `INSERT INTO billing_charges (org_id, kind, period_start, period_end, plan, interval, lines, subtotal_minor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (org_id, kind, period_start) DO NOTHING`,
    [sub.org_id, kind, start, end, plan, interval, JSON.stringify(lines), subtotal(lines)],
  );
}

/** Creates whatever is due for one organisation today: a renewal, or a month of people on a yearly plan. */
async function createDueCharges(tx: Tx, orgId: string, today: string): Promise<void> {
  const sub = (await tx.query("SELECT * FROM subscriptions WHERE org_id = $1 FOR UPDATE", [orgId])).rows[0] as Sub | undefined;
  if (!sub || sub.status === "canceled") return;
  const unpaid = (await tx.query(
    "SELECT 1 FROM billing_charges WHERE org_id = $1 AND kind = 'renewal' AND status NOT IN ('paid', 'waived')",
    [orgId],
  )).rows[0];

  if (sub.status === "trialing") {
    // The first paid period starts the day after the trial, or today if the card came later.
    if (today > sub.trial_ends_on && sub.processor_card && !unpaid) {
      const est = await estimateRenewal(tx, sub, today);
      await createCharge(tx, sub, "renewal", est.periodStart, est.periodEnd, est.lines, sub.plan, sub.interval);
    }
    return;
  }
  if (sub.period_end && today > sub.period_end && !unpaid) {
    if (sub.cancel_at_period_end) {
      await tx.query("UPDATE subscriptions SET status = 'canceled', updated_at = now() WHERE org_id = $1", [orgId]);
      return;
    }
    const est = await estimateRenewal(tx, sub, today);
    await createCharge(tx, sub, "renewal", est.periodStart, est.periodEnd, est.lines, sub.next_plan ?? sub.plan, sub.next_interval ?? sub.interval);
  }
  // Yearly Books + Payroll: each month of people paid, billed after the month ends.
  if (sub.plan === "books_payroll" && sub.interval === "year" && sub.people_billed_through) {
    const from = addDays(sub.people_billed_through, 1);
    const to = addDays(addMonths(from, 1), -1);
    if (today > to) {
      const lines = discounted(peopleLine(sub.prices, await peoplePaid(tx, orgId, from, to), from, to), sub.partner_discount_pct);
      if (lines.length) await createCharge(tx, sub, "people", from, to, lines, sub.plan, sub.interval);
      else await tx.query("UPDATE subscriptions SET people_billed_through = $2 WHERE org_id = $1", [orgId, to]);
    }
  }
}

async function notifyOwners(pool: pg.Pool, cfg: BillingConfig, orgId: string, msg: (orgName: string) => { subject: string; text: string }) {
  if (!cfg.mailer) return;
  const owners = (await pool.query(
    `SELECT u.email, o.name FROM memberships m JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.org_id
      WHERE m.org_id = $1 AND m.role = 'owner'`,
    [orgId],
  )).rows;
  const billingEmail = (await pool.query("SELECT billing_email FROM subscriptions WHERE org_id = $1", [orgId])).rows[0]?.billing_email;
  const to = [...new Set([...owners.map((o) => o.email), billingEmail].filter(Boolean))];
  for (const addr of to) {
    try {
      await cfg.mailer({ to: addr, ...msg(owners[0]?.name ?? "your organisation") });
    } catch (err) {
      console.error("billing email failed", err);
    }
  }
}

/** The customer record for this organisation in the seller's books, kept in step with its billing details. */
async function sellerContact(tx: Tx, cfg: BillingConfig, sub: Sub): Promise<string> {
  const seller = cfg.seller!;
  const address: ContactAddress = { line1: sub.address_line1!, city: sub.address_city!, state: sub.address_state!, zip: sub.address_zip! };
  // The organisation id in the name keeps two customers with the same business name apart.
  const name = `${sub.billing_name} (${sub.org_id.slice(0, 8)})`;
  const fields = { name, email: sub.billing_email, address };
  if (sub.seller_contact_id) {
    const cur = (await tx.query(
      "SELECT name, email, address_line1, address_city, address_state, address_zip FROM contacts WHERE id = $1", [sub.seller_contact_id],
    )).rows[0];
    const same = cur && cur.name === name && cur.email === sub.billing_email && cur.address_line1 === address.line1
      && cur.address_city === address.city && cur.address_state === address.state && cur.address_zip === address.zip;
    if (!same) await updateContact(tx, { orgId: seller.orgId, entityId: seller.entityId, contactId: sub.seller_contact_id, ...fields, actor: SYSTEM });
    return sub.seller_contact_id;
  }
  const c = await createContact(tx, { orgId: seller.orgId, entityId: seller.entityId, kind: "customer", ...fields, actor: SYSTEM });
  return c.id;
}

const money = (minor: number | bigint) => (Number(minor) / 100).toFixed(2);

/** Invoices one charge in the seller's books, then charges the card for it. */
async function attemptCharge(pool: pg.Pool, cfg: BillingConfig, chargeId: string, today: string): Promise<"paid" | "failed" | "skipped"> {
  const seller = cfg.seller!;
  const gateway = cfg.gateway!;
  // Claim the charge first, so a second run, or a crash mid-way, never charges twice.
  const claimed = await withSystem(pool, async (tx) => {
    const c = (await tx.query("SELECT * FROM billing_charges WHERE id = $1 FOR UPDATE", [chargeId])).rows[0];
    if (!c || !["pending", "failed"].includes(c.status)) return null;
    const sub = (await tx.query("SELECT * FROM subscriptions WHERE org_id = $1 FOR UPDATE", [c.org_id])).rows[0] as Sub;
    if (!sub.processor_card || !sub.address_line1) {
      await tx.query(
        "UPDATE billing_charges SET status = 'failed', failure = 'no card or billing address on file', next_attempt_on = NULL, updated_at = now() WHERE id = $1",
        [chargeId],
      );
      return null;
    }
    await tx.query("UPDATE billing_charges SET status = 'processing', attempts = attempts + 1, updated_at = now() WHERE id = $1", [chargeId]);
    return { c, sub };
  });
  if (!claimed) return "skipped";
  const { c, sub } = claimed;

  let invoice: { id: string; number: string; taxMinor: bigint; totalMinor: bigint; dueMinor: bigint; contactId: string };
  try {
    invoice = await withTenant(pool, seller.orgId, async (tx) => {
      const contactId = await sellerContact(tx, cfg, sub);
      const doc = await issueInvoice(tx, {
        orgId: seller.orgId, entityId: seller.entityId, contactId, issueDate: today, dueDate: today,
        memo: `TrailBook subscription, ${c.period_start} to ${c.period_end}`,
        lines: (c.lines as ChargeLine[]).map((l) => ({
          description: l.description, quantity: String(l.quantity), unitPrice: money(l.unitMinor), taxCategory: SOFTWARE,
          servicePeriodStart: l.periodStart, servicePeriodEnd: l.periodEnd,
        })),
        idempotencyKey: `billing:${c.id}`, lookup: cfg.taxRates, actor: SYSTEM,
      });
      return { id: doc.id, number: doc.number, taxMinor: doc.taxMinor, totalMinor: doc.totalMinor, dueMinor: doc.dueMinor, contactId };
    });
    await pool.query("UPDATE subscriptions SET seller_contact_id = $2 WHERE org_id = $1", [sub.org_id, invoice.contactId]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Nothing was charged; hold it for a person, since a problem in the seller's books won't fix itself.
    await pool.query("UPDATE billing_charges SET status = 'held', failure = $2, updated_at = now() WHERE id = $1", [chargeId, `couldn't invoice: ${message}`]);
    console.error(`billing: couldn't invoice charge ${chargeId}: ${message}`);
    return "failed";
  }
  await pool.query(
    "UPDATE billing_charges SET invoice_id = $2, invoice_number = $3, tax_minor = $4, total_minor = $5, updated_at = now() WHERE id = $1",
    [chargeId, invoice.id, invoice.number, invoice.taxMinor, invoice.totalMinor],
  );

  const result = invoice.dueMinor <= 0n
    ? { ok: true as const, id: "already-paid" }
    : await gateway.charge({
      customerId: sub.processor_customer!, paymentMethodId: sub.processor_card!, amountMinor: invoice.dueMinor,
      description: `TrailBook ${invoice.number}`, idempotencyKey: `${chargeId}:${c.attempts + 1}`,
      metadata: { org_id: sub.org_id, charge_id: chargeId, invoice: invoice.number },
    }).catch((err) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err), unknown: true }));

  if (!result.ok) {
    if ("unknown" in result) {
      // The processor didn't answer: the card may or may not have been charged. A person checks before any retry.
      await pool.query("UPDATE billing_charges SET status = 'held', failure = $2, updated_at = now() WHERE id = $1", [chargeId, `no answer from the card processor: ${result.message}`]);
      return "failed";
    }
    const attempts = c.attempts + 1;
    await withSystem(pool, async (tx) => {
      await tx.query(
        "UPDATE billing_charges SET status = 'failed', failure = $2, processor_charge = $3, next_attempt_on = $4, updated_at = now() WHERE id = $1",
        [chargeId, result.message, result.id ?? null, attempts % MAX_ATTEMPTS ? addDays(today, RETRY_DAYS) : null],
      );
      await tx.query("UPDATE subscriptions SET status = 'past_due', past_due_since = coalesce(past_due_since, $2), updated_at = now() WHERE org_id = $1 AND status <> 'trialing'", [sub.org_id, today]);
      // A first payment that fails leaves the trial ended; the books are read-only until a card works.
    });
    await notifyOwners(pool, cfg, sub.org_id, (name) => ({
      subject: "Your TrailBook payment didn't go through",
      text: `We couldn't charge the card ending ${sub.card_last4} for ${invoice.number} ($${money(invoice.dueMinor)}) for ${name}: ${result.message}.\n\n`
        + `Update the card under Billing${cfg.appUrl ? ` (${cfg.appUrl}/#/billing)` : ""}. ${attempts % MAX_ATTEMPTS ? `We'll try again in ${RETRY_DAYS} days.` : "We won't try again until the card is updated."} `
        + `Your books stay fully usable for ${GRACE_DAYS} days after the first failed payment, and always readable and downloadable after that.\n`,
    }));
    return "failed";
  }

  await withTenant(pool, seller.orgId, (tx) => invoice.dueMinor > 0n
    ? recordPayment(tx, {
      orgId: seller.orgId, entityId: seller.entityId, documentId: invoice.id, date: today, amount: invoice.dueMinor,
      bankAccount: seller.bankAccount, idempotencyKey: `billing:${chargeId}`, actor: SYSTEM,
    })
    : Promise.resolve(null));
  await withSystem(pool, async (tx) => {
    await tx.query("UPDATE billing_charges SET status = 'paid', processor_charge = $2, failure = NULL, next_attempt_on = NULL, paid_at = now(), updated_at = now() WHERE id = $1", [chargeId, result.id]);
    const stillUnpaid = (await tx.query("SELECT 1 FROM billing_charges WHERE org_id = $1 AND status IN ('failed', 'held', 'pending', 'processing')", [sub.org_id])).rows[0];
    if (c.kind === "renewal") {
      const founding = !sub.founding && !(await tx.query("SELECT activated_at FROM subscriptions WHERE org_id = $1", [sub.org_id])).rows[0].activated_at
        && (await tx.query("SELECT count(*)::int AS n FROM subscriptions WHERE founding")).rows[0].n < FOUNDING_SEATS;
      await tx.query(
        `UPDATE subscriptions SET status = $2, plan = $3, interval = $4, next_plan = NULL, next_interval = NULL,
           period_start = $5, period_end = $6, past_due_since = CASE WHEN $2 = 'active' THEN NULL ELSE past_due_since END,
           people_billed_through = CASE WHEN $3 = 'books_payroll' THEN $7::date ELSE people_billed_through END,
           activated_at = coalesce(activated_at, now()),
           founding = founding OR $8, price_locked_until = CASE WHEN $8 THEN $9::date ELSE price_locked_until END, updated_at = now()
         WHERE org_id = $1`,
        [sub.org_id, stillUnpaid ? "past_due" : "active", c.plan, c.interval, c.period_start, c.period_end, addDays(c.period_start, -1), founding, addMonths(today, FOUNDING_LOCK_MONTHS)],
      );
    } else {
      if (c.kind === "people") await tx.query("UPDATE subscriptions SET people_billed_through = $2 WHERE org_id = $1", [sub.org_id, c.period_end]);
      if (!stillUnpaid) await tx.query("UPDATE subscriptions SET status = 'active', past_due_since = NULL, updated_at = now() WHERE org_id = $1 AND status = 'past_due'", [sub.org_id]);
    }
  });
  await notifyOwners(pool, cfg, sub.org_id, (name) => ({
    subject: `TrailBook receipt ${invoice.number}`,
    text: `Thanks. We charged $${money(invoice.dueMinor)} to the card ending ${sub.card_last4} for ${name}'s TrailBook subscription, ${c.period_start} to ${c.period_end}.\n\n`
      + `${(c.lines as ChargeLine[]).map((l) => `${l.description}: ${l.quantity} x $${money(l.unitMinor)}`).join("\n")}\n`
      + `${invoice.taxMinor > 0n ? `California sales tax: $${money(invoice.taxMinor)}\n` : ""}Total: $${money(invoice.totalMinor)}\n\nYour invoices are under Billing.\n`,
  }));
  return "paid";
}

export interface BillingRunResult { charged: number; failed: number; created: number }

/** Charges what's due for one organisation, or for all of them. Safe to run more than once a day. */
export async function runBilling(pool: pg.Pool, cfg: BillingConfig, today: string, onlyOrg?: string): Promise<BillingRunResult> {
  const result: BillingRunResult = { charged: 0, failed: 0, created: 0 };
  if (!cfg.gateway || !cfg.seller) return result;
  const orgs = (await pool.query(
    onlyOrg ? "SELECT org_id FROM subscriptions WHERE org_id = $1" : "SELECT org_id FROM subscriptions WHERE status <> 'canceled' OR cancel_at_period_end",
    onlyOrg ? [onlyOrg] : [],
  )).rows.map((r) => r.org_id as string);
  for (const orgId of orgs) {
    const free = await withSystem(pool, (tx) => isFree(tx, orgId, cfg));
    if (free) continue;
    const count = async () => (await pool.query("SELECT count(*)::int AS n FROM billing_charges WHERE org_id = $1", [orgId])).rows[0].n as number;
    const before = await count();
    await withSystem(pool, (tx) => createDueCharges(tx, orgId, today));
    result.created += (await count()) - before;
    const due = (await pool.query(
      "SELECT id FROM billing_charges WHERE org_id = $1 AND (status = 'pending' OR (status = 'failed' AND next_attempt_on <= $2)) ORDER BY created_at",
      [orgId, today],
    )).rows;
    for (const d of due) {
      const r = await attemptCharge(pool, cfg, d.id, today);
      if (r === "paid") result.charged++;
      else if (r === "failed") result.failed++;
    }
  }
  return result;
}

/**
 * Charges left needing a person: an invoice that couldn't be made, a
 * processor that didn't answer, or one stopped mid-way by a crash.
 */
export async function heldCharges(pool: pg.Pool): Promise<{ id: string; orgId: string; failure: string }[]> {
  const { rows } = await pool.query(
    `SELECT id, org_id, coalesce(failure, 'stopped while charging; check the card processor before retrying') AS failure FROM billing_charges
      WHERE status = 'held' OR (status = 'processing' AND updated_at < now() - interval '1 hour') ORDER BY created_at`,
  );
  return rows.map((r) => ({ id: r.id, orgId: r.org_id, failure: r.failure }));
}
