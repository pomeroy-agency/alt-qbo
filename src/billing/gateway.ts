// Card payments for TrailBook's own subscriptions. Cards are entered on the
// payment processor's own page (Stripe Checkout), so card numbers never touch
// TrailBook; we keep only the processor's references and the brand, last four
// digits and expiry to show the customer. Charges are made by TrailBook's
// renewal job against the saved card, for the total of an invoice issued in
// the seller's own TrailBook books (with sales tax worked out there).

export interface SavedCard {
  orgId: string;
  customerId: string;
  paymentMethodId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export type ChargeResult = { ok: true; id: string } | { ok: false; id?: string; message: string };

/** What a charge in another currency paid out, in the processor account's own currency (US dollars). */
export interface Settlement {
  /** The converted amount, before the processor's fee. */
  amountMinor: bigint;
  currency: string;
  /** Units of the payout currency per unit charged, such as 0.7123 for CAD to USD. */
  rate: string;
}

export interface PaymentGateway {
  /** A page on the processor's site where the customer enters a card. */
  startCardSetup(input: {
    orgId: string; customerId: string | null; email: string; name: string; successUrl: string; cancelUrl: string;
    /** The currency the card will be charged in; US dollars when left out. */
    currency?: string;
  }): Promise<{ url: string; customerId: string }>;
  /** The card saved on that page, once the customer finished it. */
  finishCardSetup(sessionId: string): Promise<SavedCard>;
  charge(input: {
    customerId: string; paymentMethodId: string; amountMinor: bigint; description: string; idempotencyKey: string;
    metadata: Record<string, string>;
    /** US dollars when left out. */
    currency?: string;
  }): Promise<ChargeResult>;
  /** What a successful charge paid out after conversion. Needed for charges in Canadian dollars. */
  settlement(chargeId: string): Promise<Settlement>;
}

type Fetch = typeof fetch;

/** Stripe's form encoding: nested keys as a[b][c]=v, arrays as a[]=v. */
export function formEncode(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x) => parts.push(`${encodeURIComponent(`${key}[]`)}=${encodeURIComponent(String(x))}`));
    else if (typeof v === "object") parts.push(formEncode(v as Record<string, unknown>, key));
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.filter(Boolean).join("&");
}

export class GatewayError extends Error {}

export function stripeGateway(secretKey: string, fetchImpl: Fetch = fetch): PaymentGateway {
  const call = async (method: "GET" | "POST", path: string, params?: Record<string, unknown>, idempotencyKey?: string) => {
    const headers: Record<string, string> = { authorization: `Bearer ${secretKey}`, "stripe-version": "2024-06-20" };
    if (method === "POST") headers["content-type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const res = await fetchImpl(`https://api.stripe.com/v1${path}`, { method, headers, body: method === "POST" && params ? formEncode(params) : undefined });
    const data = await res.json() as any;
    return { ok: res.ok, status: res.status, data };
  };
  return {
    async startCardSetup(input) {
      let customerId = input.customerId;
      if (!customerId) {
        const c = await call("POST", "/customers", { email: input.email, name: input.name, metadata: { org_id: input.orgId } }, `customer:${input.orgId}`);
        if (!c.ok) throw new GatewayError(c.data?.error?.message ?? "the card processor didn't respond");
        customerId = c.data.id as string;
      }
      const s = await call("POST", "/checkout/sessions", {
        mode: "setup", currency: (input.currency ?? "usd").toLowerCase(), customer: customerId, payment_method_types: ["card"],
        client_reference_id: input.orgId, metadata: { org_id: input.orgId },
        success_url: input.successUrl, cancel_url: input.cancelUrl,
      });
      if (!s.ok) throw new GatewayError(s.data?.error?.message ?? "the card processor didn't respond");
      return { url: s.data.url as string, customerId: customerId! };
    },
    async finishCardSetup(sessionId) {
      if (!/^cs_[\w]+$/.test(sessionId)) throw new GatewayError("that card setup isn't valid");
      const s = await call("GET", `/checkout/sessions/${sessionId}?expand[]=setup_intent.payment_method`);
      if (!s.ok) throw new GatewayError(s.data?.error?.message ?? "that card setup isn't valid");
      const pm = s.data.setup_intent?.payment_method;
      if (s.data.status !== "complete" || !pm?.card) throw new GatewayError("the card wasn't saved; try adding it again");
      return {
        orgId: s.data.client_reference_id, customerId: s.data.customer, paymentMethodId: pm.id,
        brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year,
      };
    },
    async charge(input) {
      const r = await call("POST", "/payment_intents", {
        amount: input.amountMinor.toString(), currency: (input.currency ?? "usd").toLowerCase(), customer: input.customerId, payment_method: input.paymentMethodId,
        off_session: "true", confirm: "true", description: input.description, metadata: input.metadata,
      }, input.idempotencyKey);
      if (r.ok && r.data.status === "succeeded") return { ok: true, id: r.data.id };
      const err = r.data?.error;
      return { ok: false, id: err?.payment_intent?.id ?? r.data?.id, message: err?.message ?? `the payment didn't go through (${r.data?.status ?? r.status})` };
    },
    async settlement(chargeId) {
      // Reading the conversion needs the restricted key's Charges and Balance permissions (read).
      if (!/^pi_[\w]+$/.test(chargeId)) throw new GatewayError("that payment reference isn't valid");
      const r = await call("GET", `/payment_intents/${chargeId}?expand[]=latest_charge.balance_transaction`);
      if (!r.ok) throw new GatewayError(r.data?.error?.message ?? "the card processor didn't respond");
      const bt = r.data.latest_charge?.balance_transaction;
      if (!bt || typeof bt !== "object" || typeof bt.amount !== "number") {
        throw new GatewayError("the card processor hasn't converted this payment yet");
      }
      // A charge in the account's own currency has no exchange rate.
      const rate = bt.exchange_rate == null ? "1" : String(bt.exchange_rate);
      return { amountMinor: BigInt(bt.amount), currency: String(bt.currency).toUpperCase(), rate };
    },
  };
}
