import { describe, expect, it } from "vitest";
import { handleApi } from "../src/app/api.js";
import { pool } from "./helpers.js";

const BASE = "https://alt-qbo.test";
const opts = { signupCode: "invite-123" };

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  const res = await handleApi(
    new Request(BASE + path, { method: init.method ?? (init.body !== undefined ? "POST" : "GET"), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
    pool,
    opts,
  );
  const setCookie = res.headers.get("set-cookie");
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* CSV */ }
  return { status: res.status, data, cookie: setCookie?.split(";")[0] };
}

let n = 0;
async function signup(orgName = "Test Co") {
  const email = `user${Date.now()}${n++}@example.com`;
  const r = await call("/api/auth/signup", { body: { name: "Test User", email, password: "long-enough-pw", orgName, inviteCode: "invite-123" } });
  expect(r.status).toBe(201);
  const me = await call("/api/me", { cookie: r.cookie });
  return { cookie: r.cookie!, email, orgId: me.data.orgs[0].id as string };
}

/** Invites an email and has that person sign up through the link. Returns their session. */
async function join(s: { cookie: string; orgId: string }, email: string, role: string, password = "member-pass-12") {
  const inv = await call(`/api/orgs/${s.orgId}/invitations`, { cookie: s.cookie, body: { email, role } });
  expect(inv.status).toBe(201);
  const r = await call("/api/auth/signup", { body: { name: email.split("@")[0], email, password, inviteToken: inv.data.token } });
  expect(r.status).toBe(201);
  return { cookie: r.cookie!, email, token: inv.data.token as string };
}

async function entity(s: { cookie: string; orgId: string }) {
  const r = await call(`/api/orgs/${s.orgId}/entities`, {
    cookie: s.cookie, body: { legalName: "API Studio LLC", entityType: "llc_single", region: "CA", firstFiscalYear: 2026 },
  });
  expect(r.status).toBe(201);
  return r.data.id as string;
}

const run = {
  periodStart: "2026-06-01", periodEnd: "2026-06-14", payDate: "2026-06-19",
  employees: [{ name: "Maya Chen", payFrequency: "biweekly", salaryPerPeriod: "3000.00", federalStatus: "single_or_mfs", caStatus: "single", caAllowances: "1" }],
};

describe("API", () => {
  it("requires the invite code, a real password, and a session", async () => {
    expect((await call("/api/auth/signup", { body: { name: "X", email: "x@example.com", password: "long-enough-pw", orgName: "X", inviteCode: "nope" } })).status).toBe(403);
    expect((await call("/api/auth/signup", { body: { name: "X", email: "x@example.com", password: "short", orgName: "X", inviteCode: "invite-123" } })).status).toBe(400);
    expect((await call("/api/me")).status).toBe(401);
    const s = await signup();
    expect((await call("/api/auth/login", { body: { email: s.email, password: "wrong-password" } })).status).toBe(401);
    const login = await call("/api/auth/login", { body: { email: s.email.toUpperCase(), password: "long-enough-pw" } });
    expect(login.status).toBe(200);
    expect(login.cookie).toMatch(/^altqbo_session=/);
  });

  it("refuses cross-site writes", async () => {
    const s = await signup();
    const r = await call(`/api/orgs/${s.orgId}/entities`, { cookie: s.cookie, origin: "https://evil.example", body: { legalName: "X", entityType: "llc_single" } });
    expect(r.status).toBe(403);
  });

  it("keeps organisations apart", async () => {
    const a = await signup("A");
    const b = await signup("B");
    const ent = await entity(a);
    expect((await call(`/api/orgs/${a.orgId}`, { cookie: b.cookie })).status).toBe(404);
    expect((await call(`/api/orgs/${b.orgId}/entities/${ent}`, { cookie: b.cookie })).status).toBe(404);
  });

  it("posts entries and returns ledger errors as 422", async () => {
    const s = await signup();
    const ent = await entity(s);
    const ok = await call(`/api/orgs/${s.orgId}/entities/${ent}/journal`, {
      cookie: s.cookie, body: { date: "2026-02-01", memo: "Capital", lines: [{ account: "1000", debit: "100.00" }, { account: "3000", credit: "100.00" }] },
    });
    expect(ok.status).toBe(201);
    expect(ok.data.entryNumber).toBe("1");
    const bad = await call(`/api/orgs/${s.orgId}/entities/${ent}/journal`, {
      cookie: s.cookie, body: { date: "2026-02-01", lines: [{ account: "1000", debit: "100.00" }, { account: "3000", credit: "90.00" }] },
    });
    expect(bad.status).toBe(422);
    expect(bad.data.code).toBe("UNBALANCED");
  });

  it("enforces two-person approval for payroll and read-only access", async () => {
    const s = await signup();
    const ent = await entity(s);
    const prepared = await call(`/api/orgs/${s.orgId}/entities/${ent}/pay-runs`, { cookie: s.cookie, body: run });
    expect(prepared.status).toBe(201);
    expect(prepared.data.run.totals.netPayMinor).toBe("228358");

    const self = await call(`/api/orgs/${s.orgId}/entities/${ent}/pay-runs/${prepared.data.id}/approve`, { cookie: s.cookie, body: {} });
    expect(self.status).toBe(403);

    const approverEmail = `approver${Date.now()}@example.com`;
    const ava = await join(s, approverEmail, "approver");
    const approved = await call(`/api/orgs/${s.orgId}/entities/${ent}/pay-runs/${prepared.data.id}/approve`, { cookie: ava.cookie, body: {} });
    expect(approved.status).toBe(201);
    expect(approved.data.sourceType).toBe("pay_run");
    const again = await call(`/api/orgs/${s.orgId}/entities/${ent}/pay-runs/${prepared.data.id}/approve`, { cookie: ava.cookie, body: {} });
    expect(again.status).toBe(409);

    const viewerEmail = `viewer${Date.now()}@example.com`;
    const vic = await join(s, viewerEmail, "read_only");
    const denied = await call(`/api/orgs/${s.orgId}/entities/${ent}/journal`, {
      cookie: vic.cookie, body: { date: "2026-02-01", lines: [{ account: "1000", debit: "1.00" }, { account: "3000", credit: "1.00" }] },
    });
    expect(denied.status).toBe(403);
    const audit = await call(`/api/orgs/${s.orgId}/audit`, { cookie: vic.cookie });
    expect(audit.data.verification.ok).toBe(true);
    expect(audit.data.events.map((e: any) => e.action)).toContain("pay_run.approved");
  });
});

describe("invoices and bills API", () => {
  it("adds a customer, issues an invoice, takes a payment, and shows aging", async () => {
    const s = await signup();
    const ent = await entity(s);
    const base = `/api/orgs/${s.orgId}/entities/${ent}`;
    const cust = await call(`${base}/contacts`, { cookie: s.cookie, body: { kind: "customer", name: "Acme Corp" } });
    expect(cust.status).toBe(201);
    expect((await call(`${base}/contacts`, { cookie: s.cookie, body: { kind: "customer", name: "acme corp" } })).status).toBe(422);

    const inv = await call(`${base}/invoices`, {
      cookie: s.cookie,
      body: { contactId: cust.data.id, issueDate: "2026-05-01", dueDate: "2026-05-31", taxRate: "7.25", idempotencyKey: "k1",
        lines: [{ account: "4000", description: "Design", quantity: "2", unitPrice: "500.00", taxable: true }] },
    });
    expect(inv.status).toBe(201);
    expect(inv.data).toMatchObject({ number: "INV-1001", subtotalMinor: "100000", taxMinor: "7250", totalMinor: "107250" });
    expect((await call(`${base}/invoices`, { cookie: s.cookie, body: { contactId: "nope", issueDate: "2026-05-01", lines: [{ account: "4000", unitPrice: "1.00" }] } })).status).toBe(400);
    expect((await call(`${base}/invoices`, { cookie: s.cookie, body: { contactId: cust.data.id, issueDate: "2026-05-01", taxRate: "abc", lines: [{ account: "4000", unitPrice: "1.00" }] } })).status).toBe(400);

    const over = await call(`${base}/invoices/${inv.data.id}/payments`, { cookie: s.cookie, body: { date: "2026-05-10", amount: "2000.00" } });
    expect(over.status).toBe(422);
    expect(over.data.code).toBe("OVERPAID");
    const pay = await call(`${base}/invoices/${inv.data.id}/payments`, { cookie: s.cookie, body: { date: "2026-05-10", amount: "72.50" } });
    expect(pay.status).toBe(201);
    expect(pay.data.dueMinor).toBe("100000");

    // An invoice id is not a bill.
    expect((await call(`${base}/bills/${inv.data.id}`, { cookie: s.cookie })).status).toBe(404);
    const ag = await call(`${base}/invoices/aging?asOf=2026-06-15`, { cookie: s.cookie });
    expect(ag.data.buckets.d1_30).toBe("100000");
    const list = await call(`${base}/invoices?asOf=2026-06-15`, { cookie: s.cookie });
    expect(list.data.documents[0]).toMatchObject({ status: "overdue", contactName: "Acme Corp" });

    const audit = await call(`/api/orgs/${s.orgId}/audit`, { cookie: s.cookie });
    expect(audit.data.verification.ok).toBe(true);
    expect(audit.data.events.map((e: any) => e.action)).toEqual(expect.arrayContaining(["contact.created", "invoice.issued", "payment.recorded"]));
  });
});

describe("bank API", () => {
  it("imports a statement, records and undoes lines, and guards entries owned by documents", async () => {
    const s = await signup();
    const ent = await entity(s);
    const base = `/api/orgs/${s.orgId}/entities/${ent}`;
    const csv = "Date,Description,Amount\n2026-05-02,Client deposit,250.00\n2026-05-03,Office supplies,-40.00\n";
    const imp = await call(`${base}/bank-imports`, { cookie: s.cookie, body: { bankAccount: "1000", csv, fileName: "may.csv" } });
    expect(imp.status).toBe(201);
    expect(imp.data).toMatchObject({ added: 2, duplicates: 0 });
    expect((await call(`${base}/bank-imports`, { cookie: s.cookie, body: { bankAccount: "1000", csv } })).data).toMatchObject({ added: 0, duplicates: 2 });

    const { data } = await call(`${base}/bank-lines?account=1000&status=new`, { cookie: s.cookie });
    const supplies = data.lines.find((l: any) => l.amountMinor === "-4000");
    const cat = await call(`${base}/bank-lines/${supplies.id}/categorize`, { cookie: s.cookie, body: { account: "6000" } });
    expect(cat.status).toBe(200);
    expect(cat.data.status).toBe("posted");

    // The journal refuses to reverse an entry that belongs to a bank line.
    const rev = await call(`${base}/journal/${cat.data.entryId}/reverse`, { cookie: s.cookie, body: { date: "2026-05-04", reason: "x" } });
    expect(rev.status).toBe(409);
    const undo = await call(`${base}/bank-lines/${supplies.id}/undo`, { cookie: s.cookie, body: { date: "2026-05-04", reason: "wrong account" } });
    expect(undo.data.status).toBe("new");
    const ex = await call(`${base}/bank-lines/${supplies.id}/exclude`, { cookie: s.cookie, method: "POST" });
    expect(ex.data.status).toBe("excluded");
    expect((await call(`${base}/bank-lines/${crypto.randomUUID()}/exclude`, { cookie: s.cookie, method: "POST" })).status).toBe(404);
  });
});

describe("reconciliation API", () => {
  it("lists open items and completes at zero difference", async () => {
    const s = await signup();
    const ent = await entity(s);
    const base = `/api/orgs/${s.orgId}/entities/${ent}`;
    await call(`${base}/journal`, { cookie: s.cookie, body: { date: "2026-03-01", lines: [{ account: "1000", debit: "100.00" }, { account: "3000", credit: "100.00" }] } });
    const open = await call(`${base}/reconciliations?account=1000&statementDate=2026-03-31`, { cookie: s.cookie });
    expect(open.data.items).toHaveLength(1);
    const ids = open.data.items.map((i: any) => i.lineId);
    const off = await call(`${base}/reconciliations`, { cookie: s.cookie, body: { bankAccount: "1000", statementDate: "2026-03-31", statementBalance: "99.00", clearedLineIds: ids } });
    expect(off.status).toBe(422);
    const ok = await call(`${base}/reconciliations`, { cookie: s.cookie, body: { bankAccount: "1000", statementDate: "2026-03-31", statementBalance: "100.00", clearedLineIds: ids } });
    expect(ok.status).toBe(201);
    expect((await call(`${base}/reconciliations?account=1000`, { cookie: s.cookie })).data.history).toHaveLength(1);
  });
});

describe("reports API", () => {
  it("returns statements as JSON and CSV, the health checklist, and saves the EIN", async () => {
    const s = await signup();
    const ent = await entity(s);
    const base = `/api/orgs/${s.orgId}/entities/${ent}`;
    await call(`${base}/journal`, { cookie: s.cookie, body: { date: "2026-03-01", lines: [{ account: "1000", debit: "100.00" }, { account: "4000", credit: "100.00" }] } });
    const pl = await call(`${base}/reports/profit-and-loss?from=2026-01-01&to=2026-12-31`, { cookie: s.cookie });
    expect(pl.data.netIncomeMinor).toBe("10000");
    const csv = await call(`${base}/reports/balance-sheet?asOf=2026-12-31&format=csv`, { cookie: s.cookie });
    expect(csv.data).toContain("Total assets,,,100.00");
    const gl = await call(`${base}/reports/general-ledger?account=1000&from=2026-01-01&to=2026-12-31`, { cookie: s.cookie });
    expect(gl.data.closingMinor).toBe("10000");
    expect((await call(`${base}/reports/receivables-aging?asOf=2026-12-31`, { cookie: s.cookie })).data).toContain("Total,,,,,0.00");
    expect((await call(`${base}/reports/profit-and-loss?from=bad&to=2026-12-31`, { cookie: s.cookie })).status).toBe(400);
    const h = await call(`${base}/health`, { cookie: s.cookie });
    expect(h.data.checks.find((c: any) => c.key === "ein").ok).toBe(false);
    expect((await call(`${base}/settings`, { cookie: s.cookie, body: { ein: "12-34" } })).status).toBe(400);
    expect((await call(`${base}/settings`, { cookie: s.cookie, body: { ein: "123456789" } })).data.ein).toBe("12-3456789");
    expect((await call(`${base}/health`, { cookie: s.cookie })).data.checks.find((c: any) => c.key === "ein").ok).toBe(true);
  });
});

describe("team API", () => {
  const uniq = (p: string) => `${p}${Date.now()}${n++}@example.com`;

  it("joins by invitation link with the invited email only, once", async () => {
    const owner = await signup();
    const email = uniq("bea");
    const inv = await call(`/api/orgs/${owner.orgId}/invitations`, { cookie: owner.cookie, body: { email: email.toUpperCase(), role: "bookkeeper" } });
    expect(inv.status).toBe(201);
    expect(inv.data.link).toMatch(/\/#\/join\//);
    expect((await call(`/api/invitations/${inv.data.token}`)).data).toMatchObject({ orgName: "Test Co", email, role: "bookkeeper", status: "pending" });
    expect((await call(`/api/invitations/${"x".repeat(32)}`)).status).toBe(404);

    // Someone else can't use the link, by signing up or by accepting while signed in.
    const wrong = await call("/api/auth/signup", { body: { name: "Mallory", email: uniq("mallory"), password: "long-enough-pw", inviteToken: inv.data.token } });
    expect(wrong.status).toBe(403);
    const other = await signup("Other Co");
    expect((await call(`/api/invitations/${inv.data.token}/accept`, { cookie: other.cookie, body: {} })).status).toBe(403);

    const bea = await call("/api/auth/signup", { body: { name: "Bea", email, password: "long-enough-pw", inviteToken: inv.data.token } });
    expect(bea.status).toBe(201);
    const me = await call("/api/me", { cookie: bea.cookie });
    expect(me.data.orgs).toEqual([{ id: owner.orgId, name: "Test Co", role: "bookkeeper" }]);
    expect((await call(`/api/invitations/${inv.data.token}`)).data.status).toBe("accepted");
    expect((await call(`/api/invitations/${inv.data.token}/accept`, { cookie: bea.cookie, body: {} })).status).toBe(422);
    const team = await call(`/api/orgs/${owner.orgId}/members`, { cookie: owner.cookie });
    expect(team.data.members.map((m: any) => m.role)).toEqual(["owner", "bookkeeper"]);
    expect(team.data.invitations).toEqual([]);
  });

  it("lets an existing user accept by signing in, and revoked links stop working", async () => {
    const owner = await signup();
    const existing = await signup("Their Own Co");
    const inv = await call(`/api/orgs/${owner.orgId}/invitations`, { cookie: owner.cookie, body: { email: existing.email, role: "accountant" } });
    const login = await call("/api/auth/login", { body: { email: existing.email, password: "long-enough-pw", inviteToken: inv.data.token } });
    expect(login.status).toBe(200);
    expect((await call("/api/me", { cookie: login.cookie })).data.orgs.map((o: any) => o.role)).toEqual(["owner", "accountant"]);
    expect((await call(`/api/orgs/${owner.orgId}/invitations`, { cookie: owner.cookie, body: { email: existing.email, role: "admin" } })).status).toBe(422);

    const email = uniq("gone");
    const revoked = await call(`/api/orgs/${owner.orgId}/invitations`, { cookie: owner.cookie, body: { email, role: "read_only" } });
    expect((await call(`/api/orgs/${owner.orgId}/members`, { cookie: owner.cookie })).data.invitations).toHaveLength(1);
    expect((await call(`/api/orgs/${owner.orgId}/invitations/${revoked.data.id}/revoke`, { cookie: owner.cookie, body: {} })).status).toBe(200);
    expect((await call("/api/auth/signup", { body: { name: "Gone", email, password: "long-enough-pw", inviteToken: revoked.data.token } })).status).toBe(422);
    // Re-inviting replaces the old link.
    const first = await call(`/api/orgs/${owner.orgId}/invitations`, { cookie: owner.cookie, body: { email, role: "read_only" } });
    const second = await call(`/api/orgs/${owner.orgId}/invitations`, { cookie: owner.cookie, body: { email, role: "approver" } });
    expect((await call(`/api/invitations/${first.data.token}`)).data.status).toBe("revoked");
    expect((await call(`/api/invitations/${second.data.token}`)).data).toMatchObject({ status: "pending", role: "approver" });
  });

  it("changes roles, removes members, and always keeps an owner", async () => {
    const owner = await signup();
    const ownerId = (await call("/api/me", { cookie: owner.cookie })).data.user.id;
    const admin = await join(owner, uniq("adam"), "admin");
    const book = await join(owner, uniq("bo"), "bookkeeper");
    const ids = Object.fromEntries((await call(`/api/orgs/${owner.orgId}/members`, { cookie: owner.cookie })).data.members.map((m: any) => [m.role, m.userId]));
    const roleOf = async (id: string) => (await call(`/api/orgs/${owner.orgId}/members`, { cookie: owner.cookie })).data.members.find((m: any) => m.userId === id)?.role;

    // Non-managers can't see invitations or manage anyone.
    expect((await call(`/api/orgs/${owner.orgId}/members`, { cookie: book.cookie })).data.invitations).toEqual([]);
    expect((await call(`/api/orgs/${owner.orgId}/members/${ids.admin}/role`, { cookie: book.cookie, body: { role: "read_only" } })).status).toBe(403);
    expect((await call(`/api/orgs/${owner.orgId}/invitations`, { cookie: book.cookie, body: { email: uniq("x"), role: "admin" } })).status).toBe(403);
    // Admins manage everyone but owners, and can't make owners.
    expect((await call(`/api/orgs/${owner.orgId}/members/${ids.bookkeeper}/role`, { cookie: admin.cookie, body: { role: "accountant" } })).status).toBe(200);
    expect(await roleOf(ids.bookkeeper)).toBe("accountant");
    expect((await call(`/api/orgs/${owner.orgId}/members/${ids.bookkeeper}/role`, { cookie: admin.cookie, body: { role: "owner" } })).status).toBe(403);
    expect((await call(`/api/orgs/${owner.orgId}/members/${ownerId}/remove`, { cookie: admin.cookie, body: {} })).status).toBe(403);

    // The only owner can't step down or leave; after handing over ownership they can.
    expect((await call(`/api/orgs/${owner.orgId}/members/${ownerId}/role`, { cookie: owner.cookie, body: { role: "admin" } })).status).toBe(422);
    expect((await call(`/api/orgs/${owner.orgId}/leave`, { cookie: owner.cookie, body: {} })).status).toBe(422);
    expect((await call(`/api/orgs/${owner.orgId}/members/${ids.admin}/role`, { cookie: owner.cookie, body: { role: "owner" } })).status).toBe(200);
    expect((await call(`/api/orgs/${owner.orgId}/leave`, { cookie: owner.cookie, body: {} })).status).toBe(200);
    expect((await call(`/api/orgs/${owner.orgId}`, { cookie: owner.cookie })).status).toBe(404);

    // A removed member loses access at once.
    expect((await call(`/api/orgs/${owner.orgId}/members/${ids.bookkeeper}/remove`, { cookie: admin.cookie, body: {} })).status).toBe(200);
    expect((await call(`/api/orgs/${owner.orgId}`, { cookie: book.cookie })).status).toBe(404);
    const audit = await call(`/api/orgs/${owner.orgId}/audit`, { cookie: admin.cookie });
    expect(audit.data.events.map((e: any) => e.action)).toEqual(expect.arrayContaining(["member.invited", "member.joined", "member.role_changed", "member.left", "member.removed"]));
    expect(audit.data.verification.ok).toBe(true);
  });

  it("holds in the database: invitations settle once, and an organisation keeps an owner", async () => {
    const owner = await signup();
    const inv = await call(`/api/orgs/${owner.orgId}/invitations`, { cookie: owner.cookie, body: { email: uniq("z"), role: "bookkeeper" } });
    await call(`/api/orgs/${owner.orgId}/invitations/${inv.data.id}/revoke`, { cookie: owner.cookie, body: {} });
    await expect(pool.query("UPDATE invitations SET revoked_at = NULL WHERE id = $1", [inv.data.id])).rejects.toThrow(/IMMUTABLE/);
    await expect(pool.query("DELETE FROM invitations WHERE id = $1", [inv.data.id])).rejects.toThrow(/IMMUTABLE/);
    const live = await call(`/api/orgs/${owner.orgId}/invitations`, { cookie: owner.cookie, body: { email: uniq("y"), role: "admin" } });
    await expect(pool.query("UPDATE invitations SET role = 'admin', expires_at = now() + interval '1 year' WHERE id = $1", [live.data.id])).rejects.toThrow(/IMMUTABLE/);
    await expect(pool.query("UPDATE invitations SET role = 'owner' WHERE id = $1", [live.data.id])).rejects.toThrow(/check constraint|IMMUTABLE/);
    await expect(pool.query("DELETE FROM memberships WHERE org_id = $1", [owner.orgId])).rejects.toThrow(/at least one owner/);
  });
});

describe("simplicity API", () => {
  it("opens one example business per person, in its own organisation, with figures to look at", async () => {
    const s = await signup("Real Books Co");
    const ex = await call("/api/example", { cookie: s.cookie, body: {} });
    expect(ex.status).toBe(201);
    expect(ex.data.orgId).not.toBe(s.orgId);
    expect((await call("/api/example", { cookie: s.cookie, body: {} })).data).toEqual(ex.data);
    expect((await call("/api/me", { cookie: s.cookie })).data.orgs.map((o: any) => o.name)).toEqual(["Real Books Co", "Example: Sunset Design Studio"]);
    expect((await call(`/api/orgs/${s.orgId}`, { cookie: s.cookie })).data.entities).toEqual([]);
    expect((await call("/api/example", { body: {} })).status).toBe(401);

    const base = `/api/orgs/${ex.data.orgId}/entities/${ex.data.entityId}`;
    const g = (await call(`${base}/glance`, { cookie: s.cookie })).data;
    expect(g).toMatchObject({ cashMinor: "1524862", owedToYouMinor: "1040000", youOweMinor: "186000", salesTaxHeldMinor: "5850", closedThrough: null });
    if (g.asOf.startsWith("2026")) expect(g.profitThisYearMinor).toBe("873012");
    expect(g.recent).toHaveLength(8);
    expect((await call(`${base}/attention`, { cookie: s.cookie })).data).toMatchObject({ bankToReview: 5, payRunsToApprove: 0 });
    const accounts = (await call(base, { cookie: s.cookie })).data.accounts;
    expect(accounts.find((a: any) => a.code === "1000").balance_minor).toBe("1524862");
  });

  it("searches the journal, shows every account's ledger, and closes the books through a date", async () => {
    const s = await signup();
    const id = await entity(s);
    const base = `/api/orgs/${s.orgId}/entities/${id}`;
    const post = (date: string, memo: string, amount: string, account = "6400") => call(`${base}/journal`, {
      cookie: s.cookie, body: { date, memo, lines: [{ account, debit: amount }, { account: "1000", credit: amount }] },
    });
    await post("2026-01-05", "January rent", "1450.00");
    await post("2026-02-05", "February rent", "1450.00");
    await post("2026-02-09", "Printer paper 100%_off", "38.20", "6500");

    const search = async (q: string) => (await call(`${base}/journal?q=${encodeURIComponent(q)}`, { cookie: s.cookie })).data.entries.map((e: any) => e.memo);
    expect(await search("rent")).toEqual(["February rent", "January rent"]);
    expect(await search("software")).toEqual(["Printer paper 100%_off"]); // by account name
    expect(await search("1,450")).toEqual(["February rent", "January rent"]);
    expect(await search("38.2")).toEqual(["Printer paper 100%_off"]);
    expect(await search("#1")).toEqual(["January rent"]);
    expect(await search("%")).toEqual(["Printer paper 100%_off"]);

    const all = (await call(`${base}/reports/general-ledger?account=all&from=2026-02-01&to=2026-02-28`, { cookie: s.cookie })).data;
    // Bank opens February at minus January's rent (on its debit side); rent, an expense, at plus; software starts at zero.
    expect(all.ledgers.map((l: any) => [l.account.code, l.openingMinor, l.lines.length])).toEqual([["1000", "-145000", 2], ["6400", "145000", 1], ["6500", "0", 1]]);
    const csv = (await call(`${base}/reports/general-ledger?account=all&from=2026-02-01&to=2026-02-28&format=csv`, { cookie: s.cookie })).data as string;
    expect(csv.split("\n")[1]).toBe("Account,Name,Date,Entry,Type,Memo,Description,Debit,Credit,Balance");

    const closed = await call(`${base}/close-through`, { cookie: s.cookie, body: { through: "2026-02-28", status: "locked" } });
    expect(closed.data).toEqual({ closed: 2, closedThrough: "2026-02-28" });
    expect((await call(`${base}/close-through`, { cookie: s.cookie, body: { through: "2026-02-28" } })).data.closed).toBe(0);
    expect((await post("2026-02-10", "Late receipt", "10.00")).status).toBe(422);
    expect((await call(`${base}/glance`, { cookie: s.cookie })).data.closedThrough).toBe("2026-02-28");
    expect((await call(`${base}/close-through`, { cookie: s.cookie, body: { through: "2025-12-31" } })).status).toBe(422);
  });
});
