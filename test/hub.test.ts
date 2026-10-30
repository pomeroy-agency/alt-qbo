import { beforeAll, describe, expect, it } from "vitest";
import { handleApi } from "../src/app/api.js";
import { pushChanged, pushStatus, signPayload, verifySignature, SIGNATURE_HEADER, type HubOptions } from "../src/app/hub.js";
import { runBilling, type BillingConfig } from "../src/billing/billing.js";
import type { ChargeResult, PaymentGateway } from "../src/billing/gateway.js";
import { addDays } from "../src/billing/plans.js";
import { pacificToday } from "../src/payroll/business-days.js";
import { pool, setupCaliforniaBusiness } from "./helpers.js";

const BASE = "https://alt-qbo.test";
const HUB = "https://account.example";
const charges: bigint[] = [];

const gateway: PaymentGateway = {
  async startCardSetup(input) {
    return { url: `https://checkout.example/${input.orgId}`, customerId: input.customerId ?? `cus_${input.orgId.slice(0, 8)}` };
  },
  async finishCardSetup(sessionId) {
    const [, orgId, last4] = sessionId.split(":");
    return { orgId: orgId!, customerId: `cus_${orgId!.slice(0, 8)}`, paymentMethodId: `pm_${last4}`, brand: "visa", last4: last4!, expMonth: 4, expYear: 2030 };
  },
  async charge(input): Promise<ChargeResult> {
    charges.push(input.amountMinor);
    return { ok: true, id: `pi_${charges.length}` };
  },
};

// The hub, as TrailBook sees it: it records each status it's sent, after checking the signature.
const received: { body: any; signed: boolean }[] = [];
let hubDown = false;
const hub: HubOptions = {
  url: HUB,
  secret: "test-secret-that-is-at-least-32-characters-long",
  fetch: async (input, init) => {
    expect(String(input)).toBe(`${HUB}/api/trailbook/status`);
    if (hubDown) throw new Error("connect ECONNREFUSED");
    const body = String(init!.body);
    const signed = verifySignature(hub, new Headers(init!.headers).get(SIGNATURE_HEADER), body);
    received.push({ body: JSON.parse(body), signed });
    return new Response("{}", { status: 200 });
  },
};

const billing: BillingConfig = { gateway, enforce: true, freeOrgNames: ["Practice Co"] };
const opts = { signupCode: "c", billing, hub, appUrl: BASE };
const cfg = () => billing;

beforeAll(async () => {
  const s = await setupCaliforniaBusiness("TrailBook Seller (hub)");
  billing.seller = { orgId: s.org.id, entityId: s.entity.id };
});

async function call(path: string, init: { body?: unknown; cookie?: string; headers?: Record<string, string>; raw?: string } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  const payload = init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined);
  if (payload !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  const res = await handleApi(new Request(BASE + path, { method: payload !== undefined ? "POST" : "GET", headers, body: payload }), pool, opts);
  return { status: res.status, data: await res.json().catch(() => null), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

/** A request the way the hub signs it. */
const fromHub = {
  get: (path: string) => call(path, { headers: { [SIGNATURE_HEADER]: signPayload(hub, `GET ${path}`) } }),
  post: (path: string, body: unknown) => {
    const raw = JSON.stringify(body);
    return call(path, { raw, headers: { [SIGNATURE_HEADER]: signPayload(hub, raw) } });
  },
};

let n = 0;
async function customer(withCard = true) {
  const email = `hub${Date.now()}${n++}@example.com`;
  const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Owner", email, password: "long-enough-pw", orgName: `Hub Co ${n}`, inviteCode: "c" } });
  const cookie = su.cookie!;
  const orgId = (await call("/api/me", { cookie })).data.orgs[0].id as string;
  const o = (p: string) => `/api/orgs/${orgId}${p}`;
  expect((await call(o("/billing/details"), { cookie, body: { name: `Hub Co ${n} LLC`, email, address: { line1: "200 N Spring St", city: "Los Angeles", state: "CA", zip: "90012" } } })).status).toBe(200);
  expect((await call(o("/billing/plan"), { cookie, body: { plan: "books", interval: "month" } })).status).toBe(200);
  if (withCard) expect((await call(o("/billing/card/confirm"), { cookie, body: { sessionId: `cs:${orgId}:4242` } })).status).toBe(200);
  return { cookie, orgId, o, email };
}

const lastFor = (orgId: string) => received.filter((r) => r.body.trailbook_org_id === orgId).at(-1);

describe("account hub", () => {
  it("signs and verifies, and refuses an old or altered signature", () => {
    const sig = signPayload(hub, "hello");
    expect(verifySignature(hub, sig, "hello")).toBe(true);
    expect(verifySignature(hub, sig, "hello!")).toBe(false);
    expect(verifySignature({ ...hub, secret: `${hub.secret}x` }, sig, "hello")).toBe(false);
    const old = { ...hub, now: () => Date.now() - 6 * 60_000 };
    expect(verifySignature(hub, signPayload(old, "hello"), "hello")).toBe(false);
    expect(verifySignature(hub, null, "hello")).toBe(false);
  });

  it("pushes a signed status after a billing change, with names but no email addresses, and only when it changed", async () => {
    const c = await customer();
    const s = lastFor(c.orgId)!;
    expect(s.signed).toBe(true);
    expect(s.body).toMatchObject({
      trailbook_org_id: c.orgId, name: expect.stringMatching(/^Hub Co/), plan_key: "trailbook_books", status: "trialing", access: "full",
      businesses: expect.any(Number), people: 0, comp_until: null,
    });
    expect(s.body.reported_at).toBeTruthy();
    expect(JSON.stringify(s.body)).not.toContain(c.email);

    const before = received.length;
    expect(await pushStatus(pool, hub, cfg(), c.orgId)).toBe("unchanged");
    expect(received.length).toBe(before);

    // Moving to Books + Payroll is a change.
    expect((await call(c.o("/billing/plan"), { cookie: c.cookie, body: { plan: "books_payroll", interval: "month" } })).status).toBe(200);
    expect(lastFor(c.orgId)!.body.plan_key).toBe("trailbook_books_payroll");
  });

  it("catches a trial that ran out overnight in the daily run, and retries when the hub is down", async () => {
    const c = await customer(false);
    await pool.query("UPDATE subscriptions SET trial_ends_on = $2 WHERE org_id = $1", [c.orgId, addDays(pacificToday(), -1)]);
    hubDown = true;
    const down = await pushChanged(pool, hub, cfg());
    expect(down.failed).toBeGreaterThan(0);
    expect((await pool.query("SELECT last_error FROM hub_pushes WHERE org_id = $1", [c.orgId])).rows[0].last_error).toMatch(/didn't answer/);
    hubDown = false;
    const up = await pushChanged(pool, hub, cfg());
    expect(up.failed).toBe(0);
    expect(lastFor(c.orgId)!.body).toMatchObject({ status: "trialing", access: "read_only" });
    // Nothing changed since, so the next run sends nothing for it.
    const before = received.filter((r) => r.body.trailbook_org_id === c.orgId).length;
    await pushChanged(pool, hub, cfg());
    expect(received.filter((r) => r.body.trailbook_org_id === c.orgId).length).toBe(before);
  });

  it("answers the hub's signed status request, and nobody else's", async () => {
    const c = await customer();
    expect((await call("/api/hub/status")).status).toBe(401);
    expect((await call("/api/hub/status", { headers: { [SIGNATURE_HEADER]: signPayload(hub, "GET /api/hub/other") } })).status).toBe(401);
    const all = await fromHub.get("/api/hub/status");
    expect(all.status).toBe(200);
    expect(all.data.orgs.find((o: any) => o.trailbook_org_id === c.orgId)).toMatchObject({ access: "full" });
    expect(all.data.orgs.find((o: any) => o.trailbook_org_id === billing.seller!.orgId)).toMatchObject({ status: "free", access: "full" });
    const one = await fromHub.get(`/api/hub/status?org=${c.orgId}`);
    expect(one.data.org.trailbook_org_id).toBe(c.orgId);
    expect((await fromHub.get("/api/hub/status?org=00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("leaves practice organisations out", async () => {
    const s = await setupCaliforniaBusiness("Practice Co");
    expect(await pushStatus(pool, hub, cfg(), s.org.id)).toBe("skipped");
    const all = await fromHub.get("/api/hub/status");
    expect(all.data.orgs.some((o: any) => o.trailbook_org_id === s.org.id)).toBe(false);
  });

  it("makes TrailBook complimentary until a date, charging nothing, then bills as usual", async () => {
    const c = await customer();
    const until = addDays(pacificToday(), 365);
    const set = await fromHub.post("/api/hub/comp", { trailbook_org_id: c.orgId, comped: true, comp_until: until, reason: "The Install", plan_key: "trailbook_books_payroll" });
    expect(set.status).toBe(200);
    expect(set.data.org).toMatchObject({ comped: true, comp_until: until, comp_reason: "The Install", plan_key: "trailbook_books_payroll", access: "full" });
    expect(lastFor(c.orgId)!.body.comp_until).toBe(until);

    const b = await call(c.o("/billing"), { cookie: c.cookie });
    expect(b.data).toMatchObject({ comped: true, compUntil: until, compReason: "The Install", plan: "books_payroll", access: { level: "full" } });
    // Payroll is open, and the billing run charges nothing during the comp.
    const before = charges.length;
    await runBilling(pool, cfg(), addDays(pacificToday(), 200), c.orgId);
    expect(charges.length).toBe(before);
    const audit = (await pool.query("SELECT actor, action FROM audit_events WHERE org_id = $1 AND action LIKE 'billing.comp%'", [c.orgId])).rows;
    expect(audit).toEqual([{ actor: "app:account-hub", action: "billing.comp_set" }]);

    // The day after it ends, the card on file is charged. (Moved to end yesterday, so today's tax rates apply.)
    await pool.query("UPDATE subscriptions SET trial_ends_on = $2, comp_until = $2 WHERE org_id = $1", [c.orgId, addDays(pacificToday(), -1)]);
    await runBilling(pool, cfg(), pacificToday(), c.orgId);
    expect(charges.length).toBe(before + 1);
    expect(charges.at(-1)).toBe(3500n);
  });

  it("goes read-only after a comp ends with no card, and can end a comp early", async () => {
    const c = await customer(false);
    const until = addDays(pacificToday(), 30);
    expect((await fromHub.post("/api/hub/comp", { trailbook_org_id: c.orgId, comped: true, comp_until: until, reason: "Agency client", plan_key: "trailbook_books" })).status).toBe(200);
    await pool.query("UPDATE subscriptions SET trial_ends_on = $2, comp_until = $2 WHERE org_id = $1", [c.orgId, addDays(pacificToday(), -1)]);
    const blocked = await call(c.o("/entities"), { cookie: c.cookie, body: { legalName: "New LLC", entityType: "llc_single" } });
    expect(blocked.status).toBe(402);
    expect(blocked.data.error).toMatch(/complimentary period has ended/);

    const d = await customer(false);
    await fromHub.post("/api/hub/comp", { trailbook_org_id: d.orgId, comped: true, comp_until: until, reason: "Agency client", plan_key: "trailbook_books" });
    const cleared = await fromHub.post("/api/hub/comp", { trailbook_org_id: d.orgId, comped: false });
    expect(cleared.status).toBe(200);
    expect(cleared.data.org).toMatchObject({ comped: true, comp_until: pacificToday(), trial_ends_on: pacificToday(), access: "full" });
    // From tomorrow it no longer covers anything.
    const tomorrow = (await pool.query("SELECT * FROM subscriptions WHERE org_id = $1", [d.orgId])).rows[0];
    expect(tomorrow.trial_ends_on).toBe(pacificToday());
  });

  it("keeps an open-ended comp for an agency plan until the hub ends it", async () => {
    const c = await customer(false);
    const set = await fromHub.post("/api/hub/comp", { trailbook_org_id: c.orgId, comped: true, comp_until: null, reason: "Full Engine plan", plan_key: "trailbook_books_payroll" });
    expect(set.status).toBe(200);
    expect(set.data.org).toMatchObject({ comped: true, comp_until: null, trial_ends_on: null, access: "full", plan_key: "trailbook_books_payroll" });
    const b = await call(c.o("/billing"), { cookie: c.cookie });
    expect(b.data).toMatchObject({ comped: true, compUntil: null, compReason: "Full Engine plan", trialEndsOn: null, next: null });
    // Years later, still free and open, with nothing charged.
    const before = charges.length;
    await runBilling(pool, cfg(), addDays(pacificToday(), 800), c.orgId);
    expect(charges.length).toBe(before);
    expect((await fromHub.get(`/api/hub/status?org=${c.orgId}`)).data.org).toMatchObject({ comped: true, access: "full" });
    // The agency plan ends: the hub ends the comp, and the trial rules take over from tomorrow.
    const end = await fromHub.post("/api/hub/comp", { trailbook_org_id: c.orgId, comped: false });
    expect(end.data.org).toMatchObject({ comp_until: pacificToday(), trial_ends_on: pacificToday() });
    expect(lastFor(c.orgId)!.body.comp_until).toBe(pacificToday());
  });

  it("refuses a comp with an unsigned request, a bad date, or a charge still open", async () => {
    const c = await customer(false);
    const body = { trailbook_org_id: c.orgId, comped: true, comp_until: addDays(pacificToday(), 30), reason: "x", plan_key: "trailbook_books" };
    expect((await call("/api/hub/comp", { body })).status).toBe(401);
    expect((await fromHub.post("/api/hub/comp", { ...body, comp_until: pacificToday() })).status).toBe(400);
    expect((await fromHub.post("/api/hub/comp", { ...body, comp_until: addDays(pacificToday(), 2000) })).status).toBe(400);
    expect((await fromHub.post("/api/hub/comp", { ...body, plan_key: "crm_pro" })).status).toBe(400);
    expect((await fromHub.post("/api/hub/comp", { ...body, comped: undefined })).status).toBe(400);
    expect((await fromHub.post("/api/hub/comp", { ...body, trailbook_org_id: billing.seller!.orgId })).status).toBe(409);
    await pool.query(
      `INSERT INTO billing_charges (org_id, kind, period_start, period_end, plan, interval, lines, subtotal_minor, status)
       VALUES ($1, 'renewal', $2, $2, 'books', 'month', '[]', 1500, 'failed')`,
      [c.orgId, pacificToday()],
    );
    const open = await fromHub.post("/api/hub/comp", body);
    expect(open.status).toBe(409);
    expect(open.data.error.message).toMatch(/isn't settled/);
  });

  it("reports a subscription that ended over 7 years ago as ended", async () => {
    const c = await customer();
    await pool.query("UPDATE subscriptions SET status = 'canceled', period_start = $2, period_end = $3 WHERE org_id = $1", [c.orgId, "2018-01-01", "2018-01-31"]);
    const s = await fromHub.get(`/api/hub/status?org=${c.orgId}`);
    expect(s.data.org).toMatchObject({ status: "canceled", access: "ended" });
    await pool.query("UPDATE subscriptions SET period_start = $2, period_end = $3 WHERE org_id = $1", [c.orgId, addDays(pacificToday(), -400), addDays(pacificToday(), -370)]);
    expect((await fromHub.get(`/api/hub/status?org=${c.orgId}`)).data.org.access).toBe("read_only");
  });
});
