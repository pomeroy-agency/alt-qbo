import { beforeAll, describe, expect, it } from "vitest";
import { handleApi } from "../src/app/api.js";
import { runBilling, splitInProportion, unbookedCharges, type BillingConfig } from "../src/billing/billing.js";
import { formEncode, stripeGateway, type ChargeResult, type PaymentGateway } from "../src/billing/gateway.js";
import { addDays } from "../src/billing/plans.js";
import { pacificToday } from "../src/payroll/business-days.js";
import { getDocument } from "../src/core/documents.js";
import { withTenant } from "../src/db/pool.js";
import { passSecondFactor, pool, setupCaliforniaBusiness } from "./helpers.js";

const BASE = "https://alt-qbo.test";
const sent: { to: string; subject: string; text: string }[] = [];
const charges: { amountMinor: bigint; idempotencyKey: string; currency?: string }[] = [];
let decline: string | null = null;
/** CAD to USD, as the fake card processor converts it; null makes reading the conversion fail. */
let fxRate: number | null = 0.72;
const setups: { currency?: string }[] = [];

const gateway: PaymentGateway = {
  async startCardSetup(input) {
    setups.push({ currency: input.currency });
    return { url: `https://checkout.example/${input.orgId}`, customerId: input.customerId ?? `cus_${input.orgId.slice(0, 8)}` };
  },
  async finishCardSetup(sessionId) {
    const [, orgId, last4] = sessionId.split(":");
    return { orgId: orgId!, customerId: `cus_${orgId!.slice(0, 8)}`, paymentMethodId: `pm_${last4}`, brand: "visa", last4: last4!, expMonth: 4, expYear: 2030 };
  },
  async charge(input): Promise<ChargeResult> {
    charges.push({ amountMinor: input.amountMinor, idempotencyKey: input.idempotencyKey, currency: input.currency });
    return decline ? { ok: false, id: "pi_declined", message: decline } : { ok: true, id: `pi_${charges.length}` };
  },
  async settlement(chargeId) {
    if (fxRate === null) throw new Error("The provided key does not have the required permissions for this endpoint (rak_charge_read)");
    const c = charges[Number(chargeId.slice(3)) - 1]!;
    return { amountMinor: BigInt(Math.round(Number(c.amountMinor) * fxRate)), currency: "USD", rate: String(fxRate) };
  },
};

let seller: { orgId: string; entityId: string };
const billing: BillingConfig = { gateway, enforce: true, freeOrgNames: [] };
const opts = { signupCode: "c", billing, mailer: async (m: { to: string; subject: string; text: string }) => { sent.push(m); }, appUrl: BASE };
const cfg = () => ({ ...billing, mailer: opts.mailer });

beforeAll(async () => {
  const s = await setupCaliforniaBusiness("TrailBook Seller");
  seller = { orgId: s.org.id, entityId: s.entity.id };
  billing.seller = seller;
});

async function call(path: string, init: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  const res = await handleApi(
    new Request(BASE + path, { method: init.body !== undefined ? "POST" : "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
    pool, opts,
  );
  return { status: res.status, data: await res.json().catch(() => null), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

let n = 0;
const LA = { line1: "200 N Spring St", city: "Los Angeles", state: "CA", zip: "90012" };
const VANCOUVER = { line1: "453 W 12th Ave", city: "Vancouver", state: "BC", zip: "v5y1v4", country: "CA" };
async function customer(plan: "books" | "books_payroll" = "books", interval: "month" | "year" = "month", address: Record<string, string> = LA) {
  const email = `bill${Date.now()}${n++}@example.com`;
  const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Owner", email, password: "long-enough-pw", orgName: `Billed ${n}`, inviteCode: "c" } });
  const cookie = await passSecondFactor(su.cookie!);
  const orgId = (await call("/api/me", { cookie })).data.orgs[0].id as string;
  const o = (p: string) => `/api/orgs/${orgId}${p}`;
  expect((await call(o("/billing/details"), { cookie, body: { name: `Billed ${n} LLC`, email, address } })).status).toBe(200);
  expect((await call(o("/billing/plan"), { cookie, body: { plan, interval } })).status).toBe(200);
  const card = await call(o("/billing/card"), { cookie, body: {} });
  expect(card.data.url).toContain("checkout.example");
  expect((await call(o("/billing/card/confirm"), { cookie, body: { sessionId: `cs:${orgId}:4242` } })).status).toBe(200);
  return { cookie, orgId, o, email };
}

const sub = async (orgId: string) => (await pool.query("SELECT * FROM subscriptions WHERE org_id = $1", [orgId])).rows[0];
/** Moves the trial so that it ended `days` ago, to test what happens after it. */
const endTrial = (orgId: string, daysAgo: number) =>
  pool.query("UPDATE subscriptions SET trial_ends_on = $2 WHERE org_id = $1", [orgId, addDays(pacificToday(), -daysAgo)]);

describe("billing", () => {
  it("starts with a 30-day trial of everything and the approved prices", async () => {
    const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "T", email: `trial${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Trial Co", inviteCode: "c" } });
    const orgId = (await call("/api/me", { cookie: su.cookie })).data.orgs[0].id;
    const b = await call(`/api/orgs/${orgId}/billing`, { cookie: su.cookie });
    expect(b.data).toMatchObject({ status: "trialing", plan: "books", trialEndsOn: addDays(pacificToday(), 30), access: { level: "full" } });
    expect(b.data.prices.plan).toEqual({ books: { month: 1500, year: 15000 }, books_payroll: { month: 3500, year: 35000 } });
    expect(b.data.prices.perPersonMonth).toBe(400);
    // Launched states only, for now.
    const out = await call(`/api/orgs/${orgId}/billing/details`, { cookie: su.cookie, body: { name: "X", email: "x@example.com", address: { line1: "1 Calle Luna", city: "San Juan", state: "PR", zip: "00901" } } });
    expect(out.status).toBe(400);
  });

  it("charges after the trial through an invoice in the seller's books", async () => {
    const c = await customer("books_payroll");
    await endTrial(c.orgId, 1);
    const today = pacificToday();
    const r = await runBilling(pool, cfg(), today, c.orgId);
    expect(r).toMatchObject({ charged: 1, failed: 0 });
    expect(charges.at(-1)!.amountMinor).toBe(3500n);

    const s = await sub(c.orgId);
    expect(s).toMatchObject({ status: "active", period_start: today, founding: true, plan: "books_payroll" });
    const ch = (await pool.query("SELECT * FROM billing_charges WHERE org_id = $1", [c.orgId])).rows[0];
    expect(ch).toMatchObject({ status: "paid", subtotal_minor: 3500n, kind: "renewal" });
    const doc = await withTenant(pool, seller.orgId, (tx) => getDocument(tx, ch.invoice_id));
    expect(doc).toMatchObject({ status: "paid", totalMinor: 3500n, number: ch.invoice_number });
    expect(doc.lines[0]).toMatchObject({ description: "TrailBook Books + Payroll, monthly", taxCategory: "prewritten_software", servicePeriodStart: today });
    expect(sent.at(-1)?.subject).toMatch(/receipt/);

    // Running again the same day charges nothing more.
    expect((await runBilling(pool, cfg(), today, c.orgId)).charged).toBe(0);
  });

  it("retries a declined card, pauses changes after the grace period, and recovers with a new card", async () => {
    const c = await customer();
    await endTrial(c.orgId, 1);
    decline = "Your card was declined.";
    const today = pacificToday();
    expect((await runBilling(pool, cfg(), today, c.orgId)).failed).toBe(1);
    expect(sent.at(-1)?.subject).toMatch(/didn't go through/);
    const ch = (await pool.query("SELECT * FROM billing_charges WHERE org_id = $1", [c.orgId])).rows[0];
    expect(ch).toMatchObject({ status: "failed", next_attempt_on: addDays(today, 3) });
    // Still in the trial state: the trial is over and unpaid, so changes are paused, reading is not.
    const blocked = await call(c.o("/entities"), { cookie: c.cookie, body: { legalName: "New LLC", entityType: "llc_single" } });
    expect(blocked.status).toBe(402);
    expect(blocked.data.error).toMatch(/trial has ended/);
    expect((await call(c.o(""), { cookie: c.cookie })).status).toBe(200);

    decline = null;
    const fixed = await call(c.o("/billing/card/confirm"), { cookie: c.cookie, body: { sessionId: `cs:${c.orgId}:5555` } });
    expect(fixed.data).toMatchObject({ charged: 1, failed: 0 });
    // A new idempotency key for the new attempt.
    expect(charges.at(-1)!.idempotencyKey).toBe(`${ch.id}:2`);
    expect((await sub(c.orgId)).status).toBe("active");
    expect((await call(c.o("/entities"), { cookie: c.cookie, body: { legalName: "New LLC", entityType: "llc_single" } })).status).toBe(201);
  });

  it("gives 14 days of grace when a renewal fails", async () => {
    const c = await customer();
    await endTrial(c.orgId, 40);
    // First period paid, starting 39 days ago; it ended 9 days ago.
    await runBilling(pool, cfg(), addDays(pacificToday(), -39), c.orgId);
    decline = "Insufficient funds.";
    await runBilling(pool, cfg(), addDays(pacificToday(), -8), c.orgId);
    decline = null;
    const s = await sub(c.orgId);
    expect(s).toMatchObject({ status: "past_due", past_due_since: addDays(pacificToday(), -8) });
    let b = await call(c.o("/billing"), { cookie: c.cookie });
    expect(b.data.access.warning).toMatch(/didn't go through/);
    expect((await call(c.o("/entities"), { cookie: c.cookie, body: { legalName: "Grace LLC", entityType: "llc_single" } })).status).toBe(201);
    await pool.query("UPDATE subscriptions SET past_due_since = $2 WHERE org_id = $1", [c.orgId, addDays(pacificToday(), -15)]);
    b = await call(c.o("/billing"), { cookie: c.cookie });
    expect(b.data.access.level).toBe("read_only");
    // Removing someone and downloading the books still work while read-only.
    const ent = (await call(c.o(""), { cookie: c.cookie })).data.entities[0].id;
    expect((await call(c.o(`/entities/${ent}/backup`), { cookie: c.cookie, body: {} })).status).toBe(200);
  });

  it("bills extra businesses, upgrades mid-period for the days left, and keeps payroll for Books + Payroll", async () => {
    const c = await customer("books");
    await call(c.o("/entities"), { cookie: c.cookie, body: { legalName: "First LLC", entityType: "llc_single" } });
    await call(c.o("/entities"), { cookie: c.cookie, body: { legalName: "Second LLC", entityType: "llc_single" } });
    await endTrial(c.orgId, 1);
    await runBilling(pool, cfg(), pacificToday(), c.orgId);
    expect(charges.at(-1)!.amountMinor).toBe(1500n + 1000n);

    const ent = (await call(c.o(""), { cookie: c.cookie })).data.entities[0].id;
    const emp = await call(c.o(`/entities/${ent}/employees`), { cookie: c.cookie, body: { name: "Ana" } });
    expect(emp.status).toBe(402);
    expect(emp.data.error).toMatch(/Books \+ Payroll/);

    await call(c.o("/billing/plan"), { cookie: c.cookie, body: { plan: "books_payroll", interval: "month" } });
    const up = (await pool.query("SELECT * FROM billing_charges WHERE org_id = $1 AND kind = 'upgrade'", [c.orgId])).rows[0];
    expect(up.status).toBe("paid");
    // A full period left: the whole difference for two businesses, (3500 - 1500) + (2500 - 1000).
    expect(up.subtotal_minor).toBe(3500n);
    expect((await call(c.o(`/entities/${ent}/employees`), { cookie: c.cookie, body: { name: "Ana" } })).status).not.toBe(402);
  });

  it("ends at the period's end after cancelling, and never deletes the books", async () => {
    const c = await customer();
    await endTrial(c.orgId, 40);
    await runBilling(pool, cfg(), addDays(pacificToday(), -39), c.orgId);
    expect((await call(c.o("/billing/cancel"), { cookie: c.cookie, body: {} })).status).toBe(200);
    expect((await sub(c.orgId)).cancel_at_period_end).toBe(true);
    const before = charges.length;
    await runBilling(pool, cfg(), pacificToday(), c.orgId);
    expect(charges.length).toBe(before);
    expect((await sub(c.orgId)).status).toBe("canceled");
    expect((await call(c.o("/entities"), { cookie: c.cookie, body: { legalName: "After LLC", entityType: "llc_single" } })).status).toBe(402);
    expect((await call(c.o(""), { cookie: c.cookie })).status).toBe(200);

    // Restarting charges again from today.
    await call(c.o("/billing/resume"), { cookie: c.cookie, body: {} });
    expect((await sub(c.orgId)).status).toBe("active");
  });
});

describe("Stripe client", () => {
  it("encodes nested parameters the way Stripe expects", () => {
    expect(formEncode({ mode: "setup", payment_method_types: ["card"], metadata: { org_id: "o1" } }))
      .toBe("mode=setup&payment_method_types%5B%5D=card&metadata%5Borg_id%5D=o1");
  });

  it("charges off-session with an idempotency key and reads declines", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ error: { message: "Your card was declined.", payment_intent: { id: "pi_x" } } }), { status: 402 });
    }) as unknown as typeof fetch;
    const r = await stripeGateway("sk_test_x", fake).charge({ customerId: "cus_1", paymentMethodId: "pm_1", amountMinor: 1500n, description: "d", idempotencyKey: "k1", metadata: {} });
    expect(r).toEqual({ ok: false, id: "pi_x", message: "Your card was declined." });
    expect(calls[0]!.url).toBe("https://api.stripe.com/v1/payment_intents");
    expect((calls[0]!.init.headers as Record<string, string>)["idempotency-key"]).toBe("k1");
    expect(String(calls[0]!.init.body)).toContain("off_session=true");
  });

  it("charges in Canadian dollars and reads the conversion", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url} ${init.body ?? ""}`);
      if (init.method === "POST") return new Response(JSON.stringify({ id: "pi_9", status: "succeeded" }), { status: 200 });
      return new Response(JSON.stringify({ id: "pi_9", latest_charge: { id: "ch_9", balance_transaction: { amount: 1512, currency: "usd", exchange_rate: 0.72 } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const g = stripeGateway("rk_test_x", fake);
    expect(await g.charge({ customerId: "cus_1", paymentMethodId: "pm_1", amountMinor: 2100n, currency: "CAD", description: "d", idempotencyKey: "k", metadata: {} })).toEqual({ ok: true, id: "pi_9" });
    expect(calls[0]).toContain("currency=cad");
    expect(await g.settlement("pi_9")).toEqual({ amountMinor: 1512n, currency: "USD", rate: "0.72" });
    expect(calls[1]).toContain("/payment_intents/pi_9?expand[]=latest_charge.balance_transaction");
  });
});

describe("partner discount", () => {
  it("takes the firm's 20% off every line", async () => {
    const c = await customer("books");
    await pool.query("UPDATE subscriptions SET partner_discount_pct = 20 WHERE org_id = $1", [c.orgId]);
    await endTrial(c.orgId, 1);
    await runBilling(pool, cfg(), pacificToday(), c.orgId);
    expect(charges.at(-1)!.amountMinor).toBe(1200n);
    const ch = (await pool.query("SELECT lines FROM billing_charges WHERE org_id = $1", [c.orgId])).rows[0];
    expect(ch.lines[0].description).toMatch(/20% partner discount/);
  });
});

describe("Canadian billing", () => {
  it("stays closed until it is switched on", async () => {
    const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "T", email: `ca-closed${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Closed Co", inviteCode: "c" } });
    const orgId = (await call("/api/me", { cookie: su.cookie })).data.orgs[0].id;
    const r = await call(`/api/orgs/${orgId}/billing/details`, { cookie: su.cookie, body: { name: "X", email: "x@example.com", address: VANCOUVER } });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/Canada isn't open yet/);
  });

  it("bills a Canadian address in Canadian dollars and books the US dollars paid out", async () => {
    billing.canada = true;
    try {
      const c = await customer("books_payroll", "month", VANCOUVER);
      expect(setups.at(-1)!.currency).toBe("CAD");
      const b = await call(c.o("/billing"), { cookie: c.cookie });
      expect(b.data).toMatchObject({ currency: "CAD", canadaOpen: true, billing: { address: { state: "BC", zip: "V5Y 1V4", country: "CA" } } });
      expect(b.data.prices.plan.books_payroll.month).toBe(4900);
      expect(b.data.prices.perPersonMonth).toBe(600);

      await endTrial(c.orgId, 1);
      const today = pacificToday();
      expect(await runBilling(pool, cfg(), today, c.orgId)).toMatchObject({ charged: 1, failed: 0 });
      expect(charges.at(-1)).toMatchObject({ amountMinor: 4900n, currency: "CAD" });
      expect(sent.at(-1)!.text).toContain("C$49.00");

      const ch = (await pool.query("SELECT * FROM billing_charges WHERE org_id = $1", [c.orgId])).rows[0];
      expect(ch).toMatchObject({ status: "paid", currency: "CAD", subtotal_minor: 4900n, tax_minor: 0n, total_minor: 4900n, settled_minor: 3528n });
      expect(Number(ch.fx_rate)).toBe(0.72);
      const doc = await withTenant(pool, seller.orgId, (tx) => getDocument(tx, ch.invoice_id));
      // The seller's books are in US dollars: the invoice is for what the card processor paid out, with no US sales tax.
      expect(doc).toMatchObject({ status: "paid", currency: "USD", totalMinor: 3528n, taxMinor: 0n });
      expect(doc.lines[0]!.description).toContain("1 x C$49.00");
      expect(doc.memo).toContain("Charged C$49.00");
      expect((await sub(c.orgId))).toMatchObject({ status: "active", currency: "CAD", founding: true });

      // Once paid, the subscription stays in Canadian dollars.
      const move = await call(c.o("/billing/details"), { cookie: c.cookie, body: { name: "X", email: c.email, address: LA } });
      expect(move.status).toBe(409);
    } finally {
      billing.canada = false;
    }
  });

  it("keeps a paid charge paid when the conversion can't be read, and books it on a later run", async () => {
    billing.canada = true;
    try {
      const c = await customer("books", "month", { ...VANCOUVER, state: "ON", city: "Toronto", zip: "M5V 2T6" });
      await endTrial(c.orgId, 1);
      fxRate = null;
      const today = pacificToday();
      expect((await runBilling(pool, cfg(), today, c.orgId)).charged).toBe(1);
      let ch = (await pool.query("SELECT * FROM billing_charges WHERE org_id = $1", [c.orgId])).rows[0];
      expect(ch).toMatchObject({ status: "paid", invoice_id: null });
      expect(ch.book_failure).toMatch(/permissions/);
      expect((await sub(c.orgId)).status).toBe("active");
      await pool.query("UPDATE billing_charges SET paid_at = now() - interval '2 hours' WHERE id = $1", [ch.id]);
      expect((await unbookedCharges(pool)).map((u) => u.id)).toContain(ch.id);

      fxRate = 0.7;
      await runBilling(pool, cfg(), today, c.orgId);
      ch = (await pool.query("SELECT * FROM billing_charges WHERE org_id = $1", [c.orgId])).rows[0];
      expect(ch).toMatchObject({ settled_minor: 1470n, book_failure: null });
      expect(ch.invoice_id).not.toBeNull();
      expect(charges.filter((x) => x.idempotencyKey.startsWith(ch.id))).toHaveLength(1);
    } finally {
      fxRate = 0.72;
      billing.canada = false;
    }
  });

  it("switches currency with the address only before the first payment", async () => {
    billing.canada = true;
    try {
      const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "T", email: `ca-switch${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Switch Co", inviteCode: "c" } });
      const cookie = await passSecondFactor(su.cookie!);
      const orgId = (await call("/api/me", { cookie })).data.orgs[0].id;
      const o = (p: string) => `/api/orgs/${orgId}${p}`;
      expect((await call(o("/billing/details"), { cookie, body: { name: "X", email: "x@example.com", address: VANCOUVER } })).status).toBe(200);
      expect((await call(o("/billing"), { cookie })).data.currency).toBe("CAD");
      expect((await call(o("/billing/details"), { cookie, body: { name: "X", email: "x@example.com", address: LA } })).status).toBe(200);
      const b = (await call(o("/billing"), { cookie })).data;
      expect(b.currency).toBe("USD");
      expect(b.prices.plan.books.month).toBe(1500);
      // A province typed with the US picked, and a bad postal code, are both caught.
      expect((await call(o("/billing/details"), { cookie, body: { name: "X", email: "x@example.com", address: { ...LA, state: "BC" } } })).status).toBe(400);
      expect((await call(o("/billing/details"), { cookie, body: { name: "X", email: "x@example.com", address: { ...VANCOUVER, zip: "90012" } } })).status).toBe(400);
    } finally {
      billing.canada = false;
    }
  });

  it("splits the converted amount across lines to the cent", () => {
    expect(splitInProportion([4900n, 3600n], 6120n)).toEqual([3528n, 2592n]);
    expect(splitInProportion([100n, 100n, 100n], 100n)).toEqual([33n, 33n, 34n]);
    expect(splitInProportion([0n], 0n)).toEqual([0n]);
  });
});
