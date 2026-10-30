import { describe, expect, it } from "vitest";
import { handleApi, type ApiOptions } from "../src/app/api.js";
import { pool } from "./helpers.js";

const BASE = "https://trailbook.test";
const REDIRECT = "https://crm.example.test/api/integrations/trailbook/callback";
const SECRET = "milepost-client-secret-for-tests";
const SCOPE = "customers:write invoices:write invoices:read company:read";

// A stand-in for MilePost's REST API.
const mpContacts = [
  { id: "c-1", first_name: "Ana", last_name: "Ruiz", email: "ana@example.com", phone: "555-0100", job_title: null, lifecycle_stage: "customer", created_at: "2026-10-01" },
  { id: "c-2", first_name: "Ben", last_name: "Okafor", email: "ben@example.com", phone: null, job_title: null, lifecycle_stage: "lead", created_at: "2026-10-02" },
];
const mpFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const auth = new Headers(init?.headers).get("authorization");
  if (auth !== "Bearer pacrm_good_key_000000000000000000") return new Response("{}", { status: 401 });
  if (url.pathname === "/api/v1/me") return Response.json({ org: { id: "mp-org", name: "Pomeroy Agency CRM" } });
  if (url.pathname === "/api/v1/contacts") {
    const email = url.searchParams.get("email");
    return Response.json(email ? mpContacts.filter((c) => c.email === email) : mpContacts);
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const opts: ApiOptions = {
  signupCode: "invite-123",
  oauthClients: [{ id: "milepost", app: "milepost", secret: SECRET, name: "MilePost", redirectUris: [REDIRECT], homeUrl: "https://crm.example.test" }],
  milepost: { url: "https://crm.example.test", fetch: mpFetch },
};

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; form?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  let body: string | undefined;
  if (init.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(init.form).toString();
  } else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  if (init.cookie) headers.cookie = init.cookie;
  const res = await handleApi(new Request(BASE + path, { method: init.method ?? (body !== undefined ? "POST" : "GET"), headers, body }), pool, opts);
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, data, headers: res.headers, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

const basic = (id = "milepost", secret = SECRET) => ({ authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` });
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

let n = 0;
async function business() {
  const email = `owner${Date.now()}${n++}@example.com`;
  const r = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Owner", email, password: "long-enough-pw", orgName: "Link Co", inviteCode: "invite-123" } });
  const cookie = r.cookie!;
  const orgId = (await call("/api/me", { cookie })).data.orgs[0].id as string;
  const ent = await call(`/api/orgs/${orgId}/entities`, { cookie, body: { legalName: "Link Studio LLC", entityType: "llc_single", region: "CA", firstFiscalYear: 2026 } });
  await call(`/api/orgs/${orgId}/entities/${ent.data.id}/address`, { cookie, body: { address: { line1: "500 Market St", city: "San Francisco", state: "CA", zip: "94105" } } });
  return { cookie, email, orgId, entityId: ent.data.id as string };
}

async function approve(s: { cookie: string; orgId: string; entityId: string }, state = "xyz") {
  const r = await call(`/api/orgs/${s.orgId}/entities/${s.entityId}/oauth/approve`, { cookie: s.cookie, body: { clientId: "milepost", redirectUri: REDIRECT, scope: SCOPE, state } });
  expect(r.status).toBe(200);
  const back = new URL(r.data.redirect);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe(state);
  expect(back.searchParams.get("company_id")).toBe(s.entityId);
  return back.searchParams.get("code")!;
}

async function connect(s: { cookie: string; orgId: string; entityId: string }) {
  const code = await approve(s);
  const t = await call("/oauth/token", { headers: basic(), form: { grant_type: "authorization_code", code, redirect_uri: REDIRECT } });
  expect(t.status).toBe(200);
  return t.data as { access_token: string; refresh_token: string; expires_in: number; company_id: string };
}

describe("connecting MilePost with OAuth", () => {
  it("sends the browser to the consent page and describes the request without trusting unknown addresses", async () => {
    const q = `client_id=milepost&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&scope=${encodeURIComponent(SCOPE)}&state=abc`;
    const go = await call(`/oauth/authorize?${q}`);
    expect(go.status).toBe(302);
    expect(go.headers.get("location")).toBe(`/#/oauth/authorize?${new URLSearchParams(q).toString()}`);

    const info = await call(`/api/oauth/client?${q}`);
    expect(info.status).toBe(200);
    expect(info.data.client.name).toBe("MilePost");
    expect(info.data.scopes).toHaveLength(4);
    expect(new URL(info.data.denyUrl).searchParams.get("error")).toBe("access_denied");

    const evil = await call(`/api/oauth/client?client_id=milepost&redirect_uri=${encodeURIComponent("https://evil.test/cb")}&response_type=code&scope=company:read`);
    expect(evil.status).toBe(400);
    expect(evil.data.denyUrl).toBeUndefined();
    expect((await call("/api/oauth/client?client_id=nobody&redirect_uri=x&response_type=code&scope=company:read")).status).toBe(400);
  });

  it("only lets an owner or admin approve, and only to the registered address", async () => {
    const s = await business();
    const bad = await call(`/api/orgs/${s.orgId}/entities/${s.entityId}/oauth/approve`, { cookie: s.cookie, body: { clientId: "milepost", redirectUri: "https://evil.test/cb", scope: SCOPE } });
    expect(bad.status).toBe(400);
    const bkEmail = `bk${Date.now()}@example.com`;
    const inv = await call(`/api/orgs/${s.orgId}/invitations`, { cookie: s.cookie, body: { email: bkEmail, role: "bookkeeper" } });
    expect(inv.status).toBe(201);
    const bk = await call("/api/auth/signup", { body: { acceptTerms: true, name: "BK", email: bkEmail, password: "member-pass-12", inviteToken: inv.data.token } });
    expect(bk.status).toBe(201);
    const r = await call(`/api/orgs/${s.orgId}/entities/${s.entityId}/oauth/approve`, { cookie: bk.cookie, body: { clientId: "milepost", redirectUri: REDIRECT, scope: SCOPE } });
    expect(r.status).toBe(403);
  });

  it("swaps a code for tokens once, rotates refresh tokens, and closes the connection when a token is replayed", async () => {
    const s = await business();
    const code = await approve(s);
    expect((await call("/oauth/token", { headers: basic("milepost", "wrong"), form: { grant_type: "authorization_code", code, redirect_uri: REDIRECT } })).status).toBe(401);
    expect((await call("/oauth/token", { headers: basic(), form: { grant_type: "authorization_code", code, redirect_uri: "https://crm.example.test/other" } })).status).toBe(400);
    const t = await call("/oauth/token", { headers: basic(), form: { grant_type: "authorization_code", code, redirect_uri: REDIRECT } });
    expect(t.status).toBe(200);
    expect(t.data).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: SCOPE, company_id: s.entityId });

    // Refresh: a new pair, and the old refresh token is spent.
    const r1 = await call("/oauth/token", { headers: basic(), form: { grant_type: "refresh_token", refresh_token: t.data.refresh_token } });
    expect(r1.status).toBe(200);
    expect(r1.data.refresh_token).not.toBe(t.data.refresh_token);
    expect((await call("/api/v1/company", { headers: bearer(r1.data.access_token) })).status).toBe(200);

    // Replaying the spent refresh token closes the whole connection.
    const replay = await call("/oauth/token", { headers: basic(), form: { grant_type: "refresh_token", refresh_token: t.data.refresh_token } });
    expect(replay.status).toBe(400);
    expect(replay.data.error).toBe("invalid_grant");
    expect((await call("/api/v1/company", { headers: bearer(r1.data.access_token) })).status).toBe(401);

    // And the code can't be used again.
    expect((await call("/oauth/token", { headers: basic(), form: { grant_type: "authorization_code", code, redirect_uri: REDIRECT } })).data.error).toBe("invalid_grant");
    const log = await call(`/api/orgs/${s.orgId}/audit`, { cookie: s.cookie });
    const actions = JSON.stringify(log.data);
    expect(actions).toContain("app.connected");
    expect(actions).toContain("app.disconnected");
  });

  it("reports the business and its subscription, adds customers and issues invoices once per MilePost record", async () => {
    const s = await business();
    const t = await connect(s);
    const auth = bearer(t.access_token);

    const company = await call("/api/v1/company", { headers: auth });
    expect(company.data).toMatchObject({ id: s.entityId, org_id: s.orgId, name: "Link Studio LLC", currency: "USD", subscription: { active: true, status: "trialing" } });

    expect((await call("/api/v1/company")).status).toBe(401);
    expect((await call("/api/v1/company", { headers: bearer("tb_at_nope") })).data.error.code).toBe("invalid_token");

    const body = { display_name: "Ana Ruiz", given_name: "Ana", family_name: "Ruiz", email: "Ana@Example.com", phone: "555-0100", external_ref: "c-1" };
    const c1 = await call("/api/v1/customers", { headers: auth, body });
    expect(c1.status).toBe(201);
    expect(c1.data).toMatchObject({ display_name: "Ana Ruiz", email: "ana@example.com", phone: "555-0100", external_ref: "c-1" });
    const again = await call("/api/v1/customers", { headers: auth, body: { ...body, phone: "555-0199" } });
    expect(again.status).toBe(200);
    expect(again.data.id).toBe(c1.data.id);
    expect(again.data.phone).toBe("555-0199");
    // Someone else with the same name stays a separate customer.
    const other = await call("/api/v1/customers", { headers: auth, body: { display_name: "Ana Ruiz", email: "other-ana@example.com", external_ref: "c-9" } });
    expect(other.status).toBe(201);
    expect(other.data.display_name).toBe("Ana Ruiz (other-ana@example.com)");
    const found = await call("/api/v1/customers?email=ana@example.com", { headers: auth });
    expect(found.data).toEqual([expect.objectContaining({ id: c1.data.id, external_ref: "c-1" })]);

    const invoice = { customer_id: c1.data.id, currency: "USD", memo: "Website redesign", external_ref: "deal-1", lines: [{ description: "Design", quantity: 2, unit_price: 1250.5 }] };
    const i1 = await call("/api/v1/invoices", { headers: auth, body: invoice });
    expect(i1.status).toBe(201);
    expect(i1.data).toMatchObject({ customer_id: c1.data.id, total: "2501.00", balance: "2501.00", status: "open", external_ref: "deal-1", tax: "0.00" });
    const i2 = await call("/api/v1/invoices", { headers: auth, body: { ...invoice, lines: [{ description: "Changed", quantity: 1, unit_price: 5 }] } });
    expect(i2.status).toBe(200);
    expect(i2.data.id).toBe(i1.data.id);
    expect((await call("/api/v1/invoices", { headers: auth, body: { ...invoice, external_ref: "deal-2", currency: "EUR" } })).status).toBe(422);
    expect((await call("/api/v1/invoices", { headers: auth, body: { ...invoice, external_ref: "deal-3", lines: [{ quantity: 1, unit_price: "1.234" }] } })).status).toBe(400);

    // Paid in TrailBook: MilePost sees it on its next check.
    const pay = await call(`/api/orgs/${s.orgId}/entities/${s.entityId}/invoices/${i1.data.id}/payments`, { cookie: s.cookie, body: { date: i1.data.issue_date, amount: "2501.00" } });
    expect(pay.status).toBe(201);
    const one = await call(`/api/v1/invoices/${i1.data.id}`, { headers: auth });
    expect(one.data).toMatchObject({ status: "paid", balance: "0.00", paid: "2501.00" });
    const changed = await call(`/api/v1/invoices?updated_since=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`, { headers: auth });
    expect(changed.data.map((x: any) => x.id)).toEqual([i1.data.id]);
    expect((await call(`/api/v1/invoices?updated_since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, { headers: auth })).data).toEqual([]);

    // Invoices TrailBook issued itself aren't MilePost's to read.
    const own = await call(`/api/orgs/${s.orgId}/entities/${s.entityId}/invoices`, {
      cookie: s.cookie, body: { contactId: c1.data.id, issueDate: i1.data.issue_date, lines: [{ description: "Other", quantity: "1", unitPrice: "10.00", taxCategory: "professional_service" }] },
    });
    expect(own.status).toBe(201);
    expect((await call(`/api/v1/invoices/${own.data.id}`, { headers: auth })).status).toBe(404);

    // The business sees the MilePost tab, with MilePost's invoice on it.
    expect((await call(`/api/orgs/${s.orgId}/entities/${s.entityId}`, { cookie: s.cookie })).data.apps).toEqual({ milepost: true });
    const tab = await call(`/api/orgs/${s.orgId}/entities/${s.entityId}/milepost`, { cookie: s.cookie });
    expect(tab.data.invoices.map((x: any) => x.dealId)).toEqual(["deal-1"]);
    expect(tab.data.contacts).toBeNull();
  });

  it("stops working when the approver is no longer an owner or admin, or the app is disconnected", async () => {
    const s = await business();
    const t = await connect(s);
    const integ = await call(`/api/orgs/${s.orgId}/entities/${s.entityId}/integrations`, { cookie: s.cookie });
    expect(integ.data.milepost.grant).toMatchObject({ app: "milepost", approvedBy: s.email });
    const grantId = integ.data.milepost.grant.id;

    const set = await call(`/api/orgs/${s.orgId}/entities/${s.entityId}/integrations/apps/${grantId}/settings`, { cookie: s.cookie, body: { taxCategory: "nonsense" } });
    expect(set.status).toBe(400);
    expect((await call(`/api/orgs/${s.orgId}/entities/${s.entityId}/integrations/apps/${grantId}/settings`, { cookie: s.cookie, body: { taxCategory: "custom_software" } })).status).toBe(200);

    expect((await call(`/api/orgs/${s.orgId}/entities/${s.entityId}/integrations/apps/${grantId}/revoke`, { cookie: s.cookie, body: {} })).status).toBe(200);
    expect((await call("/api/v1/company", { headers: bearer(t.access_token) })).status).toBe(401);
    expect((await call(`/api/orgs/${s.orgId}/entities/${s.entityId}`, { cookie: s.cookie })).data.apps).toEqual({ milepost: false });

    // MilePost can disconnect itself too.
    const t2 = await connect(s);
    expect((await call("/oauth/revoke", { headers: basic(), form: { token: t2.refresh_token } })).status).toBe(200);
    expect((await call("/api/v1/company", { headers: bearer(t2.access_token) })).status).toBe(401);

    // An admin connects it, then is made a bookkeeper: the grant no longer works.
    const adminEmail = `admin${Date.now()}@example.com`;
    const inv = await call(`/api/orgs/${s.orgId}/invitations`, { cookie: s.cookie, body: { email: adminEmail, role: "admin" } });
    const admin = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Admin", email: adminEmail, password: "member-pass-12", inviteToken: inv.data.token } });
    const t3 = await connect({ ...s, cookie: admin.cookie! });
    expect((await call("/api/v1/company", { headers: bearer(t3.access_token) })).status).toBe(200);
    const adminId = (await pool.query("SELECT id FROM users WHERE email = $1", [adminEmail])).rows[0].id;
    expect((await call(`/api/orgs/${s.orgId}/members/${adminId}/role`, { cookie: s.cookie, body: { role: "bookkeeper" } })).status).toBe(200);
    const r = await call("/api/v1/company", { headers: bearer(t3.access_token) });
    expect(r.status).toBe(401);
    expect(r.data.error.message).toMatch(/no longer an owner or admin/);
  });
});

describe("the MilePost tab with an API key", () => {
  it("checks and seals the key, lists MilePost contacts and adds one as a customer", async () => {
    const s = await business();
    const p = `/api/orgs/${s.orgId}/entities/${s.entityId}`;
    expect((await call(`${p}/integrations/milepost/key`, { cookie: s.cookie, body: { apiKey: "not-a-key" } })).status).toBe(422);
    expect((await call(`${p}/integrations/milepost/key`, { cookie: s.cookie, body: { apiKey: "pacrm_wrong_key_00000000000000000" } })).status).toBe(403);
    const ok = await call(`${p}/integrations/milepost/key`, { cookie: s.cookie, body: { apiKey: "pacrm_good_key_000000000000000000" } });
    expect(ok.status).toBe(201);

    // Only a sealed copy and the last four characters are stored.
    const row = (await pool.query("SELECT api_key_sealed, key_hint FROM app_links WHERE entity_id = $1", [s.entityId])).rows[0];
    expect(row.api_key_sealed).not.toContain("pacrm_");
    expect(row.key_hint).toBe("0000");
    const integ = await call(`${p}/integrations`, { cookie: s.cookie });
    expect(JSON.stringify(integ.data)).not.toContain("pacrm_good");
    expect(integ.data.milepost.key).toMatchObject({ account_name: "Pomeroy Agency CRM", key_hint: "0000", active: true });
    expect((await call(p, { cookie: s.cookie })).data.apps).toEqual({ milepost: true });

    const tab = await call(`${p}/milepost`, { cookie: s.cookie });
    expect(tab.data.contacts.map((c: any) => [c.id, c.customerId])).toEqual([["c-1", null], ["c-2", null]]);
    const add = await call(`${p}/milepost/customers`, { cookie: s.cookie, body: { contactId: "c-1", email: "ana@example.com" } });
    expect(add.status).toBe(201);
    expect(add.data).toMatchObject({ name: "Ana Ruiz", email: "ana@example.com", phone: "555-0100", kind: "customer" });
    expect((await call(`${p}/milepost/customers`, { cookie: s.cookie, body: { contactId: "c-1", email: "ana@example.com" } })).status).toBe(409);
    const after = await call(`${p}/milepost?email=ana@example.com`, { cookie: s.cookie });
    expect(after.data.contacts).toEqual([expect.objectContaining({ id: "c-1", customerId: add.data.id })]);

    expect((await call(`${p}/integrations/milepost/key/remove`, { cookie: s.cookie, body: {} })).status).toBe(200);
    expect((await call(p, { cookie: s.cookie })).data.apps).toEqual({ milepost: false });
  });
});
