// Card and bank payments on invoices, through each business's own Stripe
// account (Stripe Connect Standard). The business signs in to Stripe and
// connects its account; TrailBook creates a Checkout page on that account for
// the amount due; the customer pays Stripe directly and the money lands in
// the business's Stripe balance. TrailBook charges no fee on the payment,
// never holds the money, and only reads the result to record it in the books.
//
// Switched on by three settings, all needed:
//   STRIPE_SECRET_KEY         TrailBook's Stripe account (the Connect platform)
//   STRIPE_CONNECT_CLIENT_ID  the platform's Connect client ID (ca_...)
//   INVOICE_PAYMENTS=on       the legal switch, set once the terms are reviewed
// Canadian businesses also need INVOICE_PAYMENTS_CANADA=on.

import { formEncode } from "../billing/gateway.js";

export interface CheckoutInfo {
  id: string;
  /** open: on Stripe's page; complete: finished; expired: abandoned. */
  status: "open" | "complete" | "expired";
  /** paid once the money is in; unpaid while a bank debit clears. */
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  amountMinor: bigint;
  currency: string;
  metadata: Record<string, string>;
  paymentIntentId: string | null;
  /** The payment intent's state: processing while a bank debit clears, canceled or requires_payment_method when it failed. */
  paymentIntentStatus: string | null;
  paymentMethod: string | null;
  /** Stripe's fee, once known, in the balance currency. */
  feeMinor: bigint | null;
  feeCurrency: string | null;
}

export interface InvoicePayments {
  livemode: boolean;
  /** Whether Canadian businesses can take payments (the RPAA review). */
  canada: boolean;
  authorizeUrl(input: { state: string; redirectUri: string; email?: string; country?: string }): string;
  exchange(code: string): Promise<{ accountId: string; livemode: boolean }>;
  account(accountId: string): Promise<{ name: string | null; chargesEnabled: boolean; country: string | null }>;
  deauthorize(accountId: string): Promise<void>;
  createCheckout(accountId: string, input: {
    amountMinor: bigint; currency: string; description: string; customerEmail?: string | null;
    successUrl: string; cancelUrl: string; metadata: Record<string, string>; idempotencyKey: string;
  }): Promise<{ id: string; url: string }>;
  getSession(accountId: string, sessionId: string): Promise<CheckoutInfo>;
}

export class ConnectError extends Error {}

type Fetch = typeof fetch;

export function stripeConnect(
  cfg: { secretKey: string; clientId: string; canada?: boolean }, fetchImpl: Fetch = fetch,
): InvoicePayments {
  const call = async (
    method: "GET" | "POST", url: string, params?: Record<string, unknown>, opts: { account?: string; idempotencyKey?: string } = {},
  ) => {
    const headers: Record<string, string> = { authorization: `Bearer ${cfg.secretKey}`, "stripe-version": "2024-06-20" };
    if (method === "POST") headers["content-type"] = "application/x-www-form-urlencoded";
    if (opts.account) headers["stripe-account"] = opts.account;
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
    const res = await fetchImpl(url, { method, headers, body: method === "POST" && params ? formEncode(params) : undefined })
      .catch(() => { throw new ConnectError("Stripe couldn't be reached; try again in a minute"); });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) throw new ConnectError(data?.error_description || data?.error?.message || `Stripe returned ${res.status}`);
    return data;
  };
  const checkAccount = (id: string) => {
    if (!/^acct_[A-Za-z0-9]+$/.test(id)) throw new ConnectError("that Stripe account isn't valid");
  };
  return {
    livemode: cfg.secretKey.startsWith("sk_live_"),
    canada: Boolean(cfg.canada),
    authorizeUrl(input) {
      const q = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, scope: "read_write", state: input.state, redirect_uri: input.redirectUri });
      if (input.email) q.set("stripe_user[email]", input.email);
      if (input.country) q.set("stripe_user[country]", input.country);
      return `https://connect.stripe.com/oauth/authorize?${q}`;
    },
    async exchange(code) {
      if (!/^[A-Za-z0-9_]{6,200}$/.test(code)) throw new ConnectError("Stripe didn't return a valid sign-in");
      const d = await call("POST", "https://connect.stripe.com/oauth/token", { grant_type: "authorization_code", code });
      checkAccount(d.stripe_user_id);
      return { accountId: d.stripe_user_id as string, livemode: Boolean(d.livemode) };
    },
    async account(accountId) {
      checkAccount(accountId);
      const d = await call("GET", `https://api.stripe.com/v1/accounts/${accountId}`);
      return {
        name: d.business_profile?.name || d.settings?.dashboard?.display_name || null,
        chargesEnabled: Boolean(d.charges_enabled), country: d.country ?? null,
      };
    },
    async deauthorize(accountId) {
      checkAccount(accountId);
      await call("POST", "https://connect.stripe.com/oauth/deauthorize", { client_id: cfg.clientId, stripe_user_id: accountId });
    },
    async createCheckout(accountId, input) {
      checkAccount(accountId);
      const currency = input.currency.toLowerCase();
      // Bank debit (ACH) is offered for US dollars; Canadian dollars take cards.
      const methods = currency === "usd" ? ["card", "us_bank_account"] : ["card"];
      const d = await call("POST", "https://api.stripe.com/v1/checkout/sessions", {
        mode: "payment",
        payment_method_types: methods,
        line_items: { 0: { quantity: 1, price_data: { currency, unit_amount: input.amountMinor.toString(), product_data: { name: input.description.slice(0, 250) } } } },
        customer_email: input.customerEmail || undefined,
        metadata: input.metadata,
        payment_intent_data: { metadata: input.metadata, description: input.description.slice(0, 250) },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      }, { account: accountId, idempotencyKey: input.idempotencyKey });
      return { id: d.id as string, url: d.url as string };
    },
    async getSession(accountId, sessionId) {
      checkAccount(accountId);
      if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new ConnectError("that payment isn't valid");
      const d = await call("GET", `https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=payment_intent.latest_charge.balance_transaction`, undefined, { account: accountId });
      const pi = d.payment_intent && typeof d.payment_intent === "object" ? d.payment_intent : null;
      const bt = pi?.latest_charge?.balance_transaction && typeof pi.latest_charge.balance_transaction === "object" ? pi.latest_charge.balance_transaction : null;
      return {
        id: d.id, status: d.status, paymentStatus: d.payment_status,
        amountMinor: BigInt(d.amount_total ?? 0), currency: String(d.currency ?? "").toUpperCase(), metadata: d.metadata ?? {},
        paymentIntentId: pi?.id ?? (typeof d.payment_intent === "string" ? d.payment_intent : null),
        paymentIntentStatus: pi?.status ?? null,
        paymentMethod: pi?.latest_charge?.payment_method_details?.type ?? pi?.payment_method_types?.[0] ?? null,
        feeMinor: bt ? BigInt(bt.fee) : null, feeCurrency: bt ? String(bt.currency).toUpperCase() : null,
      };
    },
  };
}

/** Invoice payments, when all three settings are present; otherwise off. */
export function invoicePaymentsFromEnv(env: Record<string, string | undefined> = process.env): InvoicePayments | undefined {
  if (env.INVOICE_PAYMENTS !== "on" || !env.STRIPE_SECRET_KEY || !env.STRIPE_CONNECT_CLIENT_ID) return undefined;
  return stripeConnect({ secretKey: env.STRIPE_SECRET_KEY, clientId: env.STRIPE_CONNECT_CLIENT_ID, canada: env.INVOICE_PAYMENTS_CANADA === "on" });
}
