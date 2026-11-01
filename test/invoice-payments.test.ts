import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withSystem, withTenant, type Tx } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import { createContact, getDocument, issueDocument, recordPayment } from "../src/core/documents.js";
import { createEntity } from "../src/core/tenancy.js";
import {
  confirmFromView, connectStart, disconnect, finishConnect, payableByToken, paymentsStatus, readConnectState, signConnectState, startCheckout, sweepPayments,
} from "../src/core/invoice-payments.js";
import { invoicePaymentsFromEnv, stripeConnect, type CheckoutInfo, type InvoicePayments } from "../src/app/stripe-connect.js";
import { handleApi } from "../src/app/api.js";
import { bookkeeper, owner, pool, setupCaliforniaBusiness } from "./helpers.js";

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

/** A Stripe stand-in: sessions the test can move along by hand. */
function fakeStripe(opts: { canada?: boolean } = {}) {
  const sessions = new Map<string, CheckoutInfo & { account: string }>();
  const created: { account: string; amountMinor: bigint; currency: string; successUrl: string; metadata: Record<string, string> }[] = [];
  const deauthorized: string[] = [];
  const client: InvoicePayments = {
    livemode: false,
    canada: Boolean(opts.canada),
    authorizeUrl: ({ state, redirectUri }) => `https://connect.stripe.test/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchange: async (code) => ({ accountId: `acct_${code}`, livemode: false }),
    account: async () => ({ name: "Sunset Design", chargesEnabled: true, country: "US" }),
    deauthorize: async (id) => { deauthorized.push(id); },
    createCheckout: async (account, input) => {
      const id = `cs_test_${randomBytes(6).toString("hex")}`;
      created.push({ account, amountMinor: input.amountMinor, currency: input.currency, successUrl: input.successUrl, metadata: input.metadata });
      sessions.set(id, {
        id, account, status: "open", paymentStatus: "unpaid", amountMinor: input.amountMinor, currency: input.currency, metadata: input.metadata,
        paymentIntentId: null, paymentIntentStatus: null, paymentMethod: null, feeMinor: null, feeCurrency: null,
      });
      return { id, url: `https://checkout.stripe.test/${id}` };
    },
    getSession: async (account, id) => {
      const s = sessions.get(id);
      if (!s || s.account !== account) throw new Error("no such session");
      return s;
    },
  };
  const pay = (id: string, how: Partial<CheckoutInfo>) => Object.assign(sessions.get(id)!, { status: "complete", paymentIntentId: "pi_1", ...how });
  return { client, sessions, created, deauthorized, pay };
}

async function viewToken(orgId: string, entityId: string, documentId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await withSystem(pool, (tx) => tx.query(
    "INSERT INTO view_links (token_hash, org_id, entity_id, document_id) VALUES ($1, $2, $3, $4)",
    [createHash("sha256").update(token).digest("hex"), orgId, entityId, documentId],
  ));
  return token;
}

async function invoicedBusiness() {
  const { org, entity } = await setupCaliforniaBusiness(`Pay Co ${Date.now()} ${Math.random()}`);
  const base = { orgId: org.id, entityId: entity.id };
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const invoice = await t(async (tx) => {
    const c = await createContact(tx, { ...base, kind: "customer", name: "Acme", address: { line1: "1 Main St", city: "Fresno", state: "CA", zip: "93701" }, actor: bookkeeper });
    return issueDocument(tx, {
      ...base, kind: "invoice", contactId: c.id, issueDate: "2026-03-01", dueDate: "2026-03-31", idempotencyKey: `inv-${Math.random()}`, actor: bookkeeper,
      lines: [{ account: "4000", description: "Design", quantity: "1", unitPrice: "500.00", taxCategory: "service" }],
    });
  });
  const token = await viewToken(org.id, entity.id, invoice.id);
  return { org, entity, base, t, invoice, token };
}

const balanceOf = (tx: Tx, entityId: string, code: string) => tx.query(
  `SELECT coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint AS b FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.entity_id = $1 AND a.code = $2`,
  [entityId, code],
).then((r) => r.rows[0].b as bigint);

describe("Stripe sign-in state", () => {
  it("is signed, tied to the person and business, and expires", () => {
    const s = signConnectState({ orgId: "o1", entityId: "e1", userId: "u1", now: 1_000 });
    expect(readConnectState(s, 2_000)).toEqual({ orgId: "o1", entityId: "e1", userId: "u1" });
    expect(readConnectState(s, 1_000 + 16 * 60_000)).toBeNull();
    const [body, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ o: "o2", e: "e1", u: "u1", x: 9e15 })).toString("base64url");
    expect(readConnectState(`${forged}.${sig}`, 2_000)).toBeNull();
    expect(readConnectState(`${body}.AAAA`, 2_000)).toBeNull();
    expect(readConnectState("nonsense", 2_000)).toBeNull();
  });

  it("is off unless all three settings are there", () => {
    expect(invoicePaymentsFromEnv({ STRIPE_SECRET_KEY: "sk_test_1", STRIPE_CONNECT_CLIENT_ID: "ca_1" })).toBeUndefined();
    expect(invoicePaymentsFromEnv({ STRIPE_SECRET_KEY: "sk_test_1", INVOICE_PAYMENTS: "on" })).toBeUndefined();
    const on = invoicePaymentsFromEnv({ STRIPE_SECRET_KEY: "sk_live_1", STRIPE_CONNECT_CLIENT_ID: "ca_1", INVOICE_PAYMENTS: "on" })!;
    expect(on.livemode).toBe(true);
    expect(on.canada).toBe(false);
    expect(on.authorizeUrl({ state: "s", redirectUri: "https://app.example/api/stripe/connect/callback" }))
      .toBe("https://connect.stripe.com/oauth/authorize?response_type=code&client_id=ca_1&scope=read_write&state=s&redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fstripe%2Fconnect%2Fcallback");
  });
});

describe("payments on invoices", () => {
  it("connects the business's own Stripe, takes a card payment, and records it with Stripe's fee", async () => {
    const b = await invoicedBusiness();
    const stripe = fakeStripe();
    expect(await payableByToken(pool, stripe.client, b.token)).toBe(false);

    await expectLedgerError(b.t((tx) => connectStart(tx, stripe.client, { ...b.base, actor: bookkeeper, userId: "u", redirectUri: "https://app.example/cb" })), "FORBIDDEN");
    const url = await b.t((tx) => connectStart(tx, stripe.client, { ...b.base, actor: owner, userId: "u", redirectUri: "https://app.example/cb" }));
    expect(readConnectState(decodeURIComponent(/state=([^&]+)/.exec(url)![1]!))).toEqual({ orgId: b.org.id, entityId: b.entity.id, userId: "u" });

    const conn = await b.t((tx) => finishConnect(tx, stripe.client, { ...b.base, code: "abc123", actor: owner }));
    expect(conn).toMatchObject({ accountId: "acct_abc123", name: "Sunset Design", bankAccount: "1050" });
    const acct = await b.t((tx) => tx.query("SELECT name, subtype FROM accounts WHERE entity_id = $1 AND code = '1050'", [b.entity.id]));
    expect(acct.rows[0]).toEqual({ name: "Stripe balance", subtype: "bank" });
    await expectLedgerError(b.t((tx) => finishConnect(tx, stripe.client, { ...b.base, code: "again1", actor: owner })), "INVALID");

    expect(await payableByToken(pool, stripe.client, b.token)).toBe(true);
    const { url: pay } = await startCheckout(pool, stripe.client, { token: b.token, appUrl: "https://app.example/" });
    expect(pay).toMatch(/^https:\/\/checkout\.stripe\.test\/cs_test_/);
    expect(stripe.created[0]).toMatchObject({ account: "acct_abc123", amountMinor: 50000n, currency: "USD", metadata: { trailbook_document: b.invoice.id } });
    expect(stripe.created[0]!.successUrl).toBe(`https://app.example/view.html?paid={CHECKOUT_SESSION_ID}#${b.token}`);
    const sessionId = [...stripe.sessions.keys()][0]!;

    // Not paid yet: nothing is recorded.
    expect(await confirmFromView(pool, stripe.client, { token: b.token, sessionId, today: "2026-03-20" })).toEqual({ status: "open" });
    await expectLedgerError(confirmFromView(pool, stripe.client, { token: b.token, sessionId: "cs_test_someoneelse", today: "2026-03-20" }), "INVALID");

    stripe.pay(sessionId, { paymentStatus: "paid", paymentIntentStatus: "succeeded", paymentMethod: "card", feeMinor: 1480n, feeCurrency: "USD" });
    expect(await confirmFromView(pool, stripe.client, { token: b.token, sessionId, today: "2026-03-20" })).toEqual({ status: "paid" });
    // Coming back twice records it once.
    expect(await confirmFromView(pool, stripe.client, { token: b.token, sessionId, today: "2026-03-20" })).toEqual({ status: "paid" });

    await b.t(async (tx) => {
      const d = await getDocument(tx, b.invoice.id);
      expect(d.status).toBe("paid");
      expect(d.payments).toHaveLength(1);
      expect(d.payments[0]).toMatchObject({ amountMinor: 50000n, bankAccountCode: "1050", createdBy: "system:stripe" });
      expect(await balanceOf(tx, b.entity.id, "1050")).toBe(50000n - 1480n);
      expect(await balanceOf(tx, b.entity.id, "6100")).toBe(1480n);
      const st = await paymentsStatus(tx, b.entity.id, stripe.client);
      expect(st).toMatchObject({ enabled: true, available: true, connection: { accountId: "acct_abc123" } });
      expect(st.recent[0]).toMatchObject({ number: b.invoice.number, status: "paid", feeMinor: 1480n, paymentMethod: "card" });
    });
    expect(await payableByToken(pool, stripe.client, b.token)).toBe(false);
    await expectLedgerError(startCheckout(pool, stripe.client, { token: b.token, appUrl: "https://app.example" }), "INVALID");
  });

  it("waits for a bank debit to clear, and leaves an overpayment for the business to look at", async () => {
    const b = await invoicedBusiness();
    const stripe = fakeStripe();
    await b.t((tx) => finishConnect(tx, stripe.client, { ...b.base, code: "bank01", actor: owner }));

    await startCheckout(pool, stripe.client, { token: b.token, appUrl: "https://app.example" });
    const ach = [...stripe.sessions.keys()][0]!;
    stripe.pay(ach, { paymentStatus: "unpaid", paymentIntentStatus: "processing", paymentMethod: "us_bank_account" });
    expect(await confirmFromView(pool, stripe.client, { token: b.token, sessionId: ach, today: "2026-03-20" })).toEqual({ status: "processing" });
    // While it clears, the customer can't start a second payment.
    await expectLedgerError(startCheckout(pool, stripe.client, { token: b.token, appUrl: "https://app.example" }), "INVALID");

    // Meanwhile the business records part of it by hand, so the bank debit is now more than what's due.
    await b.t((tx) => recordPayment(tx, { ...b.base, documentId: b.invoice.id, date: "2026-03-21", amount: "100.00", idempotencyKey: "hand", actor: bookkeeper }));
    stripe.pay(ach, { paymentStatus: "paid", paymentIntentStatus: "succeeded", feeMinor: 400n, feeCurrency: "USD" });
    const r = await sweepPayments(pool, stripe.client, { today: "2026-03-24" });
    expect(r.failed).toBe(0);
    const row = await b.t((tx) => tx.query("SELECT status, note FROM invoice_payment_sessions WHERE session_id = $1", [ach]));
    expect(row.rows[0].status).toBe("needs_review");
    expect(row.rows[0].note).toMatch(/more than is still due/);
    expect((await b.t((tx) => getDocument(tx, b.invoice.id))).paidMinor).toBe(10000n);
  });

  it("records a bank debit once the sweep sees it cleared, and marks failed ones", async () => {
    const b = await invoicedBusiness();
    const stripe = fakeStripe();
    await b.t((tx) => finishConnect(tx, stripe.client, { ...b.base, code: "bank02", actor: owner }));
    await startCheckout(pool, stripe.client, { token: b.token, appUrl: "https://app.example" });
    const first = [...stripe.sessions.keys()][0]!;
    stripe.pay(first, { paymentStatus: "unpaid", paymentIntentStatus: "requires_payment_method", paymentMethod: "us_bank_account" });
    await sweepPayments(pool, stripe.client, { today: "2026-03-22" });
    expect((await b.t((tx) => tx.query("SELECT status, note FROM invoice_payment_sessions WHERE session_id = $1", [first]))).rows[0])
      .toEqual({ status: "expired", note: "The bank payment didn't go through." });

    await startCheckout(pool, stripe.client, { token: b.token, appUrl: "https://app.example" });
    const second = [...stripe.sessions.keys()][1]!;
    stripe.pay(second, { paymentStatus: "paid", paymentIntentStatus: "succeeded", paymentMethod: "us_bank_account", feeMinor: 500n, feeCurrency: "USD" });
    const r = await sweepPayments(pool, stripe.client, { today: "2026-03-25" });
    expect(r.paid).toBeGreaterThanOrEqual(1);
    expect((await b.t((tx) => getDocument(tx, b.invoice.id))).status).toBe("paid");

    // Disconnecting stops new payments and tells Stripe.
    expect(await b.t((tx) => disconnect(tx, stripe.client, { ...b.base, actor: owner }))).toEqual({ stripeNotified: true });
    expect(stripe.deauthorized).toEqual(["acct_bank02"]);
    expect((await b.t((tx) => paymentsStatus(tx, b.entity.id, stripe.client))).connection).toBeNull();
  });

  it("isn't available to Canadian businesses until that switch is on", async () => {
    const b = await invoicedBusiness();
    const ca = await withTenant(pool, b.org.id, (tx) => createEntity(tx, {
      orgId: b.org.id, legalName: "Coast Ltd", entityType: "ca_corporation", place: { country: "CA", region: "BC" }, firstFiscalYear: 2026, actor: owner,
    }));
    const off = fakeStripe();
    const st = await b.t((tx) => paymentsStatus(tx, ca.id, off.client));
    expect(st).toMatchObject({ enabled: true, available: false, reason: "Online payments aren't available for Canadian businesses yet." });
    await expectLedgerError(b.t((tx) => finishConnect(tx, off.client, { orgId: b.org.id, entityId: ca.id, code: "ca0001", actor: owner })), "INVALID");
    const on = fakeStripe({ canada: true });
    expect((await b.t((tx) => paymentsStatus(tx, ca.id, on.client))).available).toBe(true);
  });

  it("calls Stripe on the connected account, with card and bank debit for US dollars", async () => {
    const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string | undefined });
      if (url.includes("/oauth/token")) return new Response(JSON.stringify({ stripe_user_id: "acct_123", livemode: false }));
      if (url.includes("/checkout/sessions?") || /checkout\/sessions\/cs_/.test(url)) {
        return new Response(JSON.stringify({
          id: "cs_test_1", status: "complete", payment_status: "paid", amount_total: 50000, currency: "usd", metadata: { a: "b" },
          payment_intent: { id: "pi_1", status: "succeeded", payment_method_types: ["card"], latest_charge: { payment_method_details: { type: "card" }, balance_transaction: { fee: 1480, currency: "usd" } } },
        }));
      }
      return new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }));
    }) as unknown as typeof fetch;
    const s = stripeConnect({ secretKey: "sk_test_x", clientId: "ca_x" }, fake);
    expect(await s.exchange("ac_code123")).toEqual({ accountId: "acct_123", livemode: false });
    await s.createCheckout("acct_123", {
      amountMinor: 50000n, currency: "USD", description: "Invoice INV-1001", successUrl: "https://a/s", cancelUrl: "https://a/c", metadata: { trailbook_document: "d" }, idempotencyKey: "k1",
    });
    const create = calls[1]!;
    expect(create.headers["stripe-account"]).toBe("acct_123");
    expect(create.headers["idempotency-key"]).toBe("k1");
    const form = new URLSearchParams(create.body);
    expect(form.getAll("payment_method_types[]")).toEqual(["card", "us_bank_account"]);
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("50000");
    expect(form.get("line_items[0][price_data][currency]")).toBe("usd");
    // No application fee: the business keeps the whole payment, less Stripe's own fee.
    expect([...form.keys()].some((k) => k.includes("application_fee"))).toBe(false);
    const info = await s.getSession("acct_123", "cs_test_1");
    expect(info).toMatchObject({ paymentStatus: "paid", amountMinor: 50000n, currency: "USD", feeMinor: 1480n, feeCurrency: "USD", paymentMethod: "card" });
    await s.createCheckout("acct_123", { amountMinor: 100n, currency: "CAD", description: "x", successUrl: "https://a/s", cancelUrl: "https://a/c", metadata: {}, idempotencyKey: "k2" });
    expect(new URLSearchParams(calls[3]!.body).getAll("payment_method_types[]")).toEqual(["card"]);
  });

  it("shows the Pay button on the customer's link only when payments are on", async () => {
    const b = await invoicedBusiness();
    const stripe = fakeStripe();
    const view = (opts: Parameters<typeof handleApi>[2]) => handleApi(new Request("https://alt-qbo.test/api/view", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: b.token }),
    }), pool, opts);
    expect((await (await view({})).json()).payable).toBe(false);
    const payOff = await handleApi(new Request("https://alt-qbo.test/api/view/pay", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: b.token }),
    }), pool, {});
    expect(payOff.status).toBe(404);
    await b.t((tx) => finishConnect(tx, stripe.client, { ...b.base, code: "view01", actor: owner }));
    expect((await (await view({ invoicePayments: stripe.client })).json()).payable).toBe(true);
    const pay = await handleApi(new Request("https://alt-qbo.test/api/view/pay", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: b.token }),
    }), pool, { invoicePayments: stripe.client, appUrl: "https://app.example" });
    expect(pay.status).toBe(200);
    expect((await pay.json()).url).toMatch(/checkout\.stripe\.test/);
  });
});
