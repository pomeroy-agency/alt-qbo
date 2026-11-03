import { beforeAll, describe, expect, it } from "vitest";
import { handleApi } from "../src/app/api.js";
import { runBilling, type BillingConfig } from "../src/billing/billing.js";
import type { ChargeResult, PaymentGateway } from "../src/billing/gateway.js";
import { accrueReferralFees, feeOf, owedSummary } from "../src/billing/referrals.js";
import { addDays, addMonths } from "../src/billing/plans.js";
import { pacificToday } from "../src/payroll/business-days.js";
import { getDocument } from "../src/core/documents.js";
import { withTenant } from "../src/db/pool.js";
import { passSecondFactor, pool, setupCaliforniaBusiness } from "./helpers.js";

const BASE = "https://alt-qbo.test";
const sent: { to: string; subject: string; text: string }[] = [];
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
    return { ok: true, id: `pi_r${charges.length}` };
  },
  async settlement() {
    throw new Error("not used");
  },
};

let seller: { orgId: string; entityId: string };
const billing: BillingConfig = { gateway, enforce: true, freeOrgNames: [] };
const opts = { signupCode: "c", billing, mailer: async (m: { to: string; subject: string; text: string }) => { sent.push(m); }, appUrl: BASE };
const cfg = () => ({ ...billing, mailer: opts.mailer });

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
async function signup(orgName: string, extra: Record<string, unknown> = {}) {
  const email = `ref${Date.now()}${n++}@example.com`;
  const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Owner", email, password: "long-enough-pw", orgName, inviteCode: "c", ...extra } });
  if (su.status !== 201) return { error: su.data?.error as string, status: su.status };
  const cookie = await passSecondFactor(su.cookie!);
  const orgId = (await call("/api/me", { cookie })).data.orgs[0].id as string;
  return { cookie, orgId, email, o: (p: string) => `/api/orgs/${orgId}${p}` };
}
type Signed = { cookie: string; orgId: string; email: string; o: (p: string) => string };

/** A client that adds a card and pays its first month the day after its trial. */
async function payingClient(c: Signed) {
  expect((await call(c.o("/billing/details"), { cookie: c.cookie, body: { name: "Client LLC", email: c.email, address: { line1: "200 N Spring St", city: "Los Angeles", state: "CA", zip: "90012" } } })).status).toBe(200);
  await call(c.o("/billing/card"), { cookie: c.cookie, body: {} });
  expect((await call(c.o("/billing/card/confirm"), { cookie: c.cookie, body: { sessionId: `cs:${c.orgId}:4242` } })).status).toBe(200);
  await pool.query("UPDATE subscriptions SET trial_ends_on = $2 WHERE org_id = $1", [c.orgId, addDays(pacificToday(), -1)]);
  await runBilling(pool, cfg(), pacificToday(), c.orgId);
}

let operator: Signed;

beforeAll(async () => {
  const s = await setupCaliforniaBusiness("TrailBook Referral Seller");
  seller = { orgId: s.org.id, entityId: s.entity.id };
  billing.seller = seller;
  const op = (await signup("Operator's own")) as Signed;
  const user = (await pool.query("SELECT id FROM users WHERE email = $1", [op.email])).rows[0].id;
  await pool.query("INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')", [user, seller.orgId]);
  operator = { ...op, orgId: seller.orgId, o: (p: string) => `/api/orgs/${seller.orgId}${p}` };
});

async function firm(reward: "client_discount" | "firm_fee") {
  const f = (await signup(`Firm ${reward} ${n}`)) as Signed;
  expect((await call(f.o("/referrals"), { cookie: f.cookie, body: { reward, payoutEmail: "pay@firm.example" } })).data.error).toMatch(/agree to the referral program terms/);
  expect((await call(f.o("/referrals"), { cookie: f.cookie, body: { reward, payoutEmail: "pay@firm.example", acceptTerms: true } })).status).toBe(200);
  const r = await call(f.o("/referrals"), { cookie: f.cookie });
  expect(r.data).toMatchObject({ joined: true, reward, pct: 20, months: 12 });
  expect(r.data.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  return { ...f, code: r.data.code as string };
}

describe("firm referrals", () => {
  it("gives a client of a discount firm 20% off, from a code entered at sign-up", async () => {
    const f = await firm("client_discount");
    expect((await signup("Bad code client", { referralCode: "NOPE1234" })).error).toMatch(/referral code isn't valid/);
    const c = (await signup("Discount client", { referralCode: f.code.toLowerCase() })) as Signed;
    const ref = await call(c.o("/billing/referral"), { cookie: c.cookie });
    expect(ref.data).toMatchObject({ firm: { name: expect.stringContaining("Firm client_discount"), reward: "client_discount" }, canChange: true, discountPct: 20 });
    await payingClient(c);
    expect(charges.at(-1)).toBe(1200n);
    await accrueReferralFees(pool);
    expect((await pool.query("SELECT count(*)::int AS n FROM referral_fees WHERE client_org_id = $1", [c.orgId])).rows[0].n).toBe(0);
    // After the first payment the client can't swap the firm itself.
    expect((await call(c.o("/billing/referral"), { cookie: c.cookie, body: { remove: true } })).status).toBe(409);
  });

  it("earns a fee firm 20% of each payment before tax for the client's first 12 months, and records the payout", async () => {
    const f = await firm("firm_fee");
    const c = (await signup("Fee client")) as Signed;
    expect((await call(c.o("/billing/referral"), { cookie: c.cookie, body: { code: f.code } })).data).toEqual({ reward: "firm_fee" });
    await payingClient(c);
    expect(charges.at(-1)).toBe(1500n); // the client pays the standard price
    expect(await accrueReferralFees(pool)).toBe(1);
    expect(await accrueReferralFees(pool)).toBe(0); // once per charge

    // A payment for a period starting 12 months after the first doesn't earn a fee.
    const first = (await pool.query("SELECT period_start FROM billing_charges WHERE org_id = $1 AND status = 'paid'", [c.orgId])).rows[0].period_start as string;
    await pool.query(
      `INSERT INTO billing_charges (org_id, kind, period_start, period_end, plan, interval, lines, subtotal_minor, status, paid_at)
       VALUES ($1, 'renewal', $2, $3, 'books', 'month', '[]', 1500, 'paid', now()), ($1, 'renewal', $4, $5, 'books', 'month', '[]', 1500, 'paid', now())`,
      [c.orgId, addMonths(first, 11), addDays(addMonths(first, 12), -1), addMonths(first, 12), addDays(addMonths(first, 13), -1)],
    );
    expect(await accrueReferralFees(pool)).toBe(1);
    const fees = (await pool.query("SELECT base_minor, fee_minor, status FROM referral_fees WHERE client_org_id = $1 ORDER BY created_at", [c.orgId])).rows;
    expect(fees.map((x) => [x.base_minor, x.fee_minor, x.status])).toEqual([[1500n, 300n, "owed"], [1500n, 300n, "owed"]]);

    // The firm sees the client and what it has earned.
    const page = await call(f.o("/referrals"), { cookie: f.cookie });
    expect(page.data.clients).toEqual([expect.objectContaining({ name: "Fee client", reward: "firm_fee", owedMinor: "600", paidMinor: "0", feeUntil: addMonths(first, 12) })]);

    // Only the operator sees the Referral fees page.
    expect((await call(f.o("/referral-fees"), { cookie: f.cookie })).status).toBe(404);
    const ops = await call(operator.o("/referral-fees"), { cookie: operator.cookie });
    expect(ops.status).toBe(200);
    const row = ops.data.partners.find((p: { orgId: string }) => p.orgId === f.orgId);
    expect(row.owed).toEqual([{ currency: "USD", owedMinor: "600", fees: 2 }]);
    // $6 is under the $25 payout minimum, so the monthly note leaves it for later.
    expect(await owedSummary(pool) ?? "").not.toContain("Fee client");

    const paid = await call(operator.o("/referral-fees/payouts"), { cookie: operator.cookie, body: { partnerOrgId: f.orgId, currency: "USD", paidOn: pacificToday(), method: "ACH", reference: "T-1" } });
    expect(paid.status).toBe(201);
    expect(paid.data).toMatchObject({ totalMinor: "600", fees: 2, currency: "USD" });
    // A paid bill from the firm in the seller's books.
    const bill = (await pool.query("SELECT bill_id FROM referral_payouts WHERE id = $1", [paid.data.payoutId])).rows[0].bill_id;
    const doc = await withTenant(pool, seller.orgId, (tx) => getDocument(tx, bill));
    expect(doc).toMatchObject({ kind: "bill", status: "paid", totalMinor: 600n });
    expect(sent.at(-1)).toMatchObject({ to: "pay@firm.example", subject: "TrailBook referral fees paid: USD 6.00" });
    expect((await call(f.o("/referrals"), { cookie: f.cookie })).data.clients[0]).toMatchObject({ owedMinor: "0", paidMinor: "600" });
    // Nothing left to pay.
    expect((await call(operator.o("/referral-fees/payouts"), { cookie: operator.cookie, body: { partnerOrgId: f.orgId, currency: "USD", paidOn: pacificToday(), method: "ACH" } })).status).toBe(400);
  });

  it("lets the operator cancel an owed fee, and refuses a firm's owners collecting a fee on their own business", async () => {
    const f = await firm("firm_fee");
    // The firm's owner opens a business of their own and tries the code there.
    const user = (await pool.query("SELECT id FROM users WHERE email = $1", [f.email])).rows[0].id;
    const own = (await signup("Owner's own shop")) as Signed;
    await pool.query("INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')", [user, own.orgId]);
    expect((await call(own.o("/billing/referral"), { cookie: own.cookie, body: { code: f.code } })).data.error).toMatch(/its own owners run/);
    expect((await call(f.o("/billing/referral"), { cookie: f.cookie, body: { code: f.code } })).data.error).toMatch(/can't refer itself/);

    const c = (await signup("Refunded client", { referralCode: f.code })) as Signed;
    await payingClient(c);
    await accrueReferralFees(pool);
    const fee = (await pool.query("SELECT id FROM referral_fees WHERE client_org_id = $1", [c.orgId])).rows[0].id;
    expect((await call(operator.o(`/referral-fees/fees/${fee}/void`), { cookie: operator.cookie, body: {} })).status).toBe(400);
    expect((await call(operator.o(`/referral-fees/fees/${fee}/void`), { cookie: operator.cookie, body: { reason: "refunded" } })).status).toBe(200);
    expect((await pool.query("SELECT status FROM referral_fees WHERE id = $1", [fee])).rows[0].status).toBe("void");
  });

  it("keeps bank account numbers out of the payout note", async () => {
    const f = (await signup("Careful firm")) as Signed;
    const r = await call(f.o("/referrals"), { cookie: f.cookie, body: { reward: "firm_fee", payoutEmail: "a@b.example", payoutNote: "ACH to 021000021 acct 123456789", acceptTerms: true } });
    expect(r.data.error).toMatch(/account numbers/);
    expect(feeOf(1250n)).toBe(250n);
    expect(feeOf(1249n)).toBe(250n);
  });
});
