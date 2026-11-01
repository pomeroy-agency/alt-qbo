// Plaid, for automatic bank feeds. TrailBook only reads transactions
// (the Transactions product); it never initiates payments through Plaid.
//
// Switched on by PLAID_CLIENT_ID and PLAID_SECRET (with PLAID_ENV sandbox or
// production, default sandbox). Without them, the bank page offers file
// import only.

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  /** Positive is money out of the account, as Plaid reports it. */
  amount: number;
  date: string;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
}

export interface PlaidClient {
  env: "sandbox" | "production";
  linkToken(input: { userId: string; accessToken?: string; webhook?: string }): Promise<string>;
  exchange(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  accounts(accessToken: string): Promise<{ id: string; name: string; mask: string | null; type: string }[]>;
  sync(accessToken: string, cursor: string | null): Promise<{ added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: { transaction_id: string }[]; nextCursor: string; hasMore: boolean }>;
  remove(accessToken: string): Promise<void>;
}

export class PlaidError extends Error {
  constructor(message: string, readonly code: string | null) { super(message); }
}

type Fetch = typeof fetch;

export function plaidClient(cfg: { clientId: string; secret: string; env: "sandbox" | "production" }, fetchImpl: Fetch = fetch): PlaidClient {
  const base = cfg.env === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com";
  const call = async (path: string, body: Record<string, unknown>) => {
    const res = await fetchImpl(`${base}${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: cfg.clientId, secret: cfg.secret, ...body }),
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) throw new PlaidError(data?.display_message || data?.error_message || `the bank connection service returned ${res.status}`, data?.error_code ?? null);
    return data;
  };
  return {
    env: cfg.env,
    async linkToken(input) {
      const d = await call("/link/token/create", {
        client_name: "TrailBook", language: "en", country_codes: ["US", "CA"],
        user: { client_user_id: input.userId },
        ...(input.accessToken ? { access_token: input.accessToken } : { products: ["transactions"], transactions: { days_requested: 90 } }),
        ...(input.webhook ? { webhook: input.webhook } : {}),
      });
      return d.link_token as string;
    },
    async exchange(publicToken) {
      const d = await call("/item/public_token/exchange", { public_token: publicToken });
      return { accessToken: d.access_token, itemId: d.item_id };
    },
    async accounts(accessToken) {
      const d = await call("/accounts/get", { access_token: accessToken });
      return (d.accounts as any[]).map((a) => ({ id: a.account_id, name: a.official_name || a.name, mask: a.mask ?? null, type: a.subtype || a.type }));
    },
    async sync(accessToken, cursor) {
      const d = await call("/transactions/sync", { access_token: accessToken, count: 500, ...(cursor ? { cursor } : {}) });
      return { added: d.added, modified: d.modified, removed: d.removed, nextCursor: d.next_cursor, hasMore: d.has_more };
    },
    async remove(accessToken) {
      await call("/item/remove", { access_token: accessToken });
    },
  };
}

export function plaidFromEnv(env: Record<string, string | undefined> = process.env): PlaidClient | undefined {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) return undefined;
  return plaidClient({ clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env: env.PLAID_ENV === "production" ? "production" : "sandbox" });
}
