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
  const r = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Test User", email, password: "long-enough-pw", orgName, inviteCode: "invite-123" } });
  expect(r.status).toBe(201);
  const me = await call("/api/me", { cookie: r.cookie });
  return { cookie: r.cookie!, email, orgId: me.data.orgs[0].id as string };
}

/** Invites an email and has that person sign up through the link. Returns their session. */
async function join(s: { cookie: string; orgId: string }, email: string, role: string, password = "member-pass-12") {
  const inv = await call(`/api/orgs/${s.orgId}/invitations`, { cookie: s.cookie, body: { email, role } });
  expect(inv.status).toBe(201);
  const r = await call("/api/auth/signup", { body: { acceptTerms: true, name: email.split("@")[0], email, password, inviteToken: inv.data.token } });
  expect(r.status).toBe(201);
  return { cookie: r.cookie!, email, token: inv.data.token as string };
}

async function entity(s: { cookie: string; orgId: string }) {
  const r = await call(`/api/orgs/${s.orgId}/entities`, {
    cookie: s.cookie, body: { legalName: "API Studio LLC", entityType: "llc_single", region: "CA", firstFiscalYear: 2026 },
  });
  expect(r.status).toBe(201);
  // Pay stubs need the employer's address before a run can be approved.
  const addr = await call(`/api/orgs/${s.orgId}/entities/${r.data.id}/address`, {
    cookie: s.cookie, body: { address: { line1: "500 Market St", city: "San Francisco", state: "CA", zip: "94105" } },
  });
  expect(addr.status).toBe(200);
  return r.data.id as string;
}

const maya = {
  name: "Maya Chen", hireDate: "2026-01-05", payType: "salary", payFrequency: "biweekly", payRate: "78000", overtimeExempt: true,
  w4: { filingStatus: "single_or_mfs" }, de4: { filingStatus: "single", regularAllowances: 1 },
};
const runFor = (employeeIds: string[], payDate = "2026-06-19") =>
  ({ periodStart: "2026-06-01", periodEnd: "2026-06-14", payDate, lines: employeeIds.map((employeeId) => ({ employeeId })) });

describe("API", () => {
  it("requires the invite code, a real password, and a session", async () => {
    expect((await call("/api/auth/signup", { body: { acceptTerms: true, name: "X", email: "x@example.com", password: "long-enough-pw", orgName: "X", inviteCode: "nope" } })).status).toBe(403);
    expect((await call("/api/auth/signup", { body: { acceptTerms: true, name: "X", email: "x@example.com", password: "short", orgName: "X", inviteCode: "invite-123" } })).status).toBe(400);
    expect((await call("/api/me")).status).toBe(401);
    const s = await signup();
    expect((await call("/api/auth/login", { body: { email: s.email, password: "wrong-password" } })).status).toBe(401);
    const login = await call("/api/auth/login", { body: { email: s.email.toUpperCase(), password: "long-enough-pw" } });
    expect(login.status).toBe(200);
    expect(login.cookie).toMatch(/^altqbo_session=/);
  });

  it("pauses password sign-in for an email after too many wrong passwords", async () => {
    const s = await signup();
    for (let i = 0; i < 10; i++) {
      expect((await call("/api/auth/login", { body: { email: s.email, password: `wrong-password-${i}` } })).status).toBe(401);
    }
    const blocked = await call("/api/auth/login", { body: { email: s.email, password: "long-enough-pw" } });
    expect(blocked.status).toBe(429);
    expect(blocked.data.error).toMatch(/emailed link/);
    // Other people aren't affected.
    const t = await signup();
    expect((await call("/api/auth/login", { body: { email: t.email, password: "long-enough-pw" } })).status).toBe(200);
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
    const emp = await call(`/api/orgs/${s.orgId}/entities/${ent}/employees`, { cookie: s.cookie, body: maya });
    expect(emp.status).toBe(201);
    const prepared = await call(`/api/orgs/${s.orgId}/entities/${ent}/pay-runs`, { cookie: s.cookie, body: runFor([emp.data.id]) });
    expect(prepared.status).toBe(201);
    expect(prepared.data.run.totals.netPayMinor).toBe("228358");

    // With another approver on the team, the preparer can't approve their own run.
    const approverEmail = `approver${Date.now()}@example.com`;
    const ava = await join(s, approverEmail, "approver");
    const self = await call(`/api/orgs/${s.orgId}/entities/${ent}/pay-runs/${prepared.data.id}/approve`, { cookie: s.cookie, body: {} });
    expect(self.status).toBe(403);
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

describe("one-person payroll", () => {
  it("lets the only person who can approve approve their own run, and needs the business address first", async () => {
    const s = await signup();
    const r = await call(`/api/orgs/${s.orgId}/entities`, {
      cookie: s.cookie, body: { legalName: "Solo LLC", entityType: "llc_single", region: "CA", firstFiscalYear: 2026 },
    });
    const ent = r.data.id as string;
    const base = `/api/orgs/${s.orgId}/entities/${ent}`;
    const emp = await call(`${base}/employees`, { cookie: s.cookie, body: maya });
    const prepared = await call(`${base}/pay-runs`, { cookie: s.cookie, body: runFor([emp.data.id]) });
    expect((await call(`${base}/pay-runs`, { cookie: s.cookie })).data.soleApprover).toBe(true);
    const noAddress = await call(`${base}/pay-runs/${prepared.data.id}/approve`, { cookie: s.cookie, body: {} });
    expect(noAddress.status).toBe(409);
    expect(noAddress.data.error).toMatch(/address/);
    await call(`${base}/address`, { cookie: s.cookie, body: { address: { line1: "1 Main St", city: "Fresno", state: "CA", zip: "93721" } } });
    const approved = await call(`${base}/pay-runs/${prepared.data.id}/approve`, { cookie: s.cookie, body: {} });
    expect(approved.status).toBe(201);
    const audit = await call(`/api/orgs/${s.orgId}/audit`, { cookie: s.cookie });
    const ev = audit.data.events.find((e: any) => e.action === "pay_run.approved");
    expect(ev.context.selfApproved).toMatch(/no one else/);
  });
});

describe("sick leave policy", () => {
  it("front-loads 40 hours once a year, on the first approved run", async () => {
    const s = await signup();
    const ent = await entity(s);
    const base = `/api/orgs/${s.orgId}/entities/${ent}`;
    expect((await call(`${base}/payroll-settings`, { cookie: s.cookie, body: { sickLeavePolicy: "front_load" } })).status).toBe(200);
    expect((await call(`${base}/employees`, { cookie: s.cookie })).data.sickLeavePolicy).toBe("front_load");
    const emp = await call(`${base}/employees`, { cookie: s.cookie, body: { ...maya, payType: "hourly", payRate: "30", overtimeExempt: false } });
    const line = { employeeId: emp.data.id, regularHours: "72", sickHoursUsed: "8" };
    const prepared = await call(`${base}/pay-runs`, { cookie: s.cookie, body: { ...runFor([]), lines: [line] } });
    expect(prepared.data.run.paychecks[0].sickLeave).toEqual({ accruedHours: "0", usedHours: "8", grantedHours: "40", balanceHours: "32" });
    expect((await call(`${base}/pay-runs/${prepared.data.id}/approve`, { cookie: s.cookie, body: {} })).status).toBe(201);
    const next = await call(`${base}/pay-runs/preview`, { cookie: s.cookie, body: { ...runFor([], "2026-07-03"), periodStart: "2026-06-15", periodEnd: "2026-06-28", lines: [line] } });
    expect(next.data.paychecks[0].sickLeave).toEqual({ accruedHours: "0", usedHours: "8", balanceHours: "24" });
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
      body: { contactId: cust.data.id, issueDate: "2026-05-01", dueDate: "2026-05-31", idempotencyKey: "k1",
        manualTax: { ratePercent: "7.25", reason: "test rate" },
        lines: [{ account: "4000", description: "Signs", quantity: "2", unitPrice: "500.00", taxCategory: "goods" }] },
    });
    expect(inv.status).toBe(201);
    expect(inv.data).toMatchObject({ number: "INV-1001", subtotalMinor: "100000", taxMinor: "7250", totalMinor: "107250" });
    expect((await call(`${base}/invoices`, { cookie: s.cookie, body: { contactId: "nope", issueDate: "2026-05-01", lines: [{ account: "4000", unitPrice: "1.00" }] } })).status).toBe(400);
    expect((await call(`${base}/invoices`, { cookie: s.cookie, body: { contactId: cust.data.id, issueDate: "2026-05-01", manualTax: { ratePercent: "abc", reason: "x" }, lines: [{ account: "4000", unitPrice: "1.00", taxCategory: "goods" }] } })).status).toBe(422);

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
    const wrong = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Mallory", email: uniq("mallory"), password: "long-enough-pw", inviteToken: inv.data.token } });
    expect(wrong.status).toBe(403);
    const other = await signup("Other Co");
    expect((await call(`/api/invitations/${inv.data.token}/accept`, { cookie: other.cookie, body: {} })).status).toBe(403);

    const bea = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Bea", email, password: "long-enough-pw", inviteToken: inv.data.token } });
    expect(bea.status).toBe(201);
    const me = await call("/api/me", { cookie: bea.cookie });
    expect(me.data.orgs).toEqual([{ id: owner.orgId, name: "Test Co", role: "bookkeeper", termsAccepted: true }]);
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
    expect((await call("/api/auth/signup", { body: { acceptTerms: true, name: "Gone", email, password: "long-enough-pw", inviteToken: revoked.data.token } })).status).toBe(422);
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

describe("saved employees and pay runs", () => {
  async function setup() {
    const s = await signup();
    const ent = await entity(s);
    const base = `/api/orgs/${s.orgId}/entities/${ent}`;
    const approver = await join(s, `approver${Date.now()}${n++}@example.com`, "approver");
    const add = async (body: unknown) => {
      const r = await call(`${base}/employees`, { cookie: s.cookie, body });
      expect(r.status).toBe(201);
      return r.data;
    };
    const prepare = async (body: unknown) => {
      const r = await call(`${base}/pay-runs`, { cookie: s.cookie, body });
      expect(r.status).toBe(201);
      return r.data;
    };
    const approve = async (id: string) => {
      const r = await call(`${base}/pay-runs/${id}/approve`, { cookie: approver.cookie, body: {} });
      expect(r.data).not.toHaveProperty("error");
      expect(r.status).toBe(201);
      return r.data;
    };
    return { s, ent, base, add, prepare, approve };
  }

  it("keeps the Social Security number sealed and shows only its last four digits", async () => {
    const { s, base, add } = await setup();
    expect((await call(`${base}/employees`, { cookie: s.cookie, body: { ...maya, ssn: "123-45-678" } })).status).toBe(422);
    expect((await call(`${base}/employees`, { cookie: s.cookie, body: { ...maya, ssn: "666-12-3456" } })).status).toBe(422);
    expect((await call(`${base}/employees`, { cookie: s.cookie, body: { ...maya, payType: "hourly", payRate: "25" } })).status).toBe(422);
    const e = await add({ ...maya, ssn: "123-45-6789", email: "Maya@Example.com", address: { line1: "1 Main St", city: "Oakland", zip: "94607" } });
    expect(e).toMatchObject({ ssnLast4: "6789", email: "maya@example.com", status: "active", address: { state: "CA" } });
    expect(JSON.stringify(e)).not.toContain("123456789");

    const { rows } = await pool.query("SELECT ssn_sealed FROM employees WHERE id = $1", [e.id]);
    expect(rows[0].ssn_sealed).toMatch(/^v1\./);
    expect(rows[0].ssn_sealed).not.toContain("6789");
    const audit = await call(`/api/orgs/${s.orgId}/audit`, { cookie: s.cookie });
    const text = JSON.stringify(audit.data.events);
    expect(text).toContain("employee.created");
    expect(text).not.toContain("123456789");
    expect(text).not.toContain("ssn_sealed");

    const changed = await call(`${base}/employees/${e.id}`, { cookie: s.cookie, body: { terminationDate: "2026-09-30", payRate: "80000" } });
    expect(changed.data).toMatchObject({ status: "terminated", payRate: "80000", ssnLast4: "6789" });
    const list = await call(`${base}/employees`, { cookie: s.cookie });
    expect(list.data.employees).toHaveLength(1);
  });

  it("builds runs from saved pay, and works out California overtime from daily hours", async () => {
    const { base, s, add } = await setup();
    const salaried = await add(maya);
    const hourly = await add({ name: "Leo Park", hireDate: "2026-02-01", payType: "hourly", payFrequency: "biweekly", payRate: "30", usualHours: "80",
      w4: { filingStatus: "mfj" }, de4: { filingStatus: "married", regularAllowances: 2 }, sickBalanceHours: "10",
      deductions: [{ kind: "traditional401k", amount: "100" }, { kind: "post_tax", amount: "0" }] });
    expect(hourly.deductions).toEqual([{ kind: "traditional401k", amount: "100", description: "401(k)" }]);

    const preview = await call(`${base}/pay-runs/preview`, { cookie: s.cookie, body: {
      ...runFor([]),
      lines: [{ employeeId: salaried.id, bonus: "500" }, { employeeId: hourly.id, dailyHours: [10, 8, 8, 8, 8, 0, 0, 13, 8, 8, 8, 8, 0, 0] }],
    } });
    expect(preview.status).toBe(200);
    const [m, l] = preview.data.paychecks;
    expect(m.earnings.map((e: any) => [e.code, e.amountMinor])).toEqual([["SALARY", "300000"], ["BONUS", "50000"]]);
    // Week 1: 2 hours over 8 on day one. Week 2: 4 over 8 and 1 over 12 on day one.
    expect(l.earnings.map((e: any) => [e.code, e.hours])).toEqual([["REGULAR", "80"], ["OVERTIME", "6"], ["DOUBLE_TIME", "1"]]);
    expect(l.deductions[0]).toMatchObject({ kind: "traditional401k", amountMinor: "10000" });
    expect(l.sickLeave).toMatchObject({ balanceHours: "12.9" });

    const late = await call(`${base}/pay-runs/preview`, { cookie: s.cookie, body: { ...runFor([salaried.id]), periodStart: "2025-12-01", periodEnd: "2025-12-14", payDate: "2025-12-19" } });
    expect(late.status).toBe(422);
    const twice = await call(`${base}/pay-runs/preview`, { cookie: s.cookie, body: runFor([salaried.id, salaried.id]) });
    expect(twice.status).toBe(422);
  });

  it("checks hourly pay against the minimum wage of the city where they work", async () => {
    const { base, s, add } = await setup();
    const e = await add({ ...maya, overtimeExempt: false, payType: "hourly", payRate: "18", usualHours: "80", workCity: " mountain  view " });
    expect(e.workCity).toBe("Mountain View");
    const list = await call(`${base}/employees`, { cookie: s.cookie });
    expect(list.data.workCities).toContain("Sunnyvale");
    const preview = await call(`${base}/pay-runs/preview`, { cookie: s.cookie, body: runFor([e.id]) });
    expect(preview.status).toBe(200);
    expect(preview.data.paychecks[0].warnings).toContain("hourly rate 18.00 is below the Mountain View minimum wage of 19.70");
    const moved = await call(`${base}/employees/${e.id}`, { cookie: s.cookie, body: { workCity: "Fresno" } });
    expect(moved.data.workCity).toBe("Fresno");
    const again = await call(`${base}/pay-runs/preview`, { cookie: s.cookie, body: runFor([e.id]) });
    expect(again.data.paychecks[0].warnings.some((w: string) => w.includes("minimum wage"))).toBe(false);
  });

  it("stops Social Security, FUTA and UI at their wage bases using earlier pay this year", async () => {
    const { add, prepare } = await setup();
    const e = await add({ ...maya, payRate: "260000", openingYtd: { year: 2026, wages: "183500", federalIncomeTax: "40000", socialSecurityTax: "11377", medicareTax: "2660.75" } });
    const { run } = await prepare(runFor([e.id]));
    const tax = (code: string) => run.paychecks[0].taxes.find((t: any) => t.code === code);
    // 2026 base 184,500: only 1,000 of this 10,000 paycheck is left for Social Security.
    expect(tax("SS_EE")).toMatchObject({ taxableWagesMinor: "100000", amountMinor: "6200" });
    expect(tax("FUTA").amountMinor).toBe("0");
    expect(tax("CA_UI").amountMinor).toBe("0");
    expect(tax("MEDICARE_EE").taxableWagesMinor).toBe("1000000");
  });

  it("counts runs posted after another was prepared, carries sick leave, and shows year to date on stubs", async () => {
    const { s, base, add, prepare, approve } = await setup();
    // 2,000 a pay period with 6,000 already paid: the FUTA base of 7,000 has 1,000 left.
    const e = await add({ ...maya, payRate: "52000", overtimeExempt: false, ssn: "123-45-6789", openingYtd: { year: 2026, wages: "6000" } });
    const h = await add({ name: "Leo Park", hireDate: "2026-02-01", payType: "hourly", payFrequency: "biweekly", payRate: "30", sickBalanceHours: "10" });
    const a = await prepare({ ...runFor([e.id, h.id]), lines: [{ employeeId: e.id }, { employeeId: h.id, regularHours: "60" }] });
    const b = await prepare({ ...runFor([e.id], "2026-07-03"), periodStart: "2026-06-15", periodEnd: "2026-06-28" });
    const futa = (run: any) => run.paychecks[0].taxes.find((t: any) => t.code === "FUTA").taxableWagesMinor;
    expect(futa(a.run)).toBe("100000");
    expect(futa(b.run)).toBe("100000");

    await approve(a.id);
    await approve(b.id);
    const runs = await call(`${base}/pay-runs`, { cookie: s.cookie });
    expect(futa(runs.data.payRuns.find((r: any) => r.id === b.id).result)).toBe("0");
    const leo = (await call(`${base}/employees`, { cookie: s.cookie })).data.employees.find((x: any) => x.id === h.id);
    expect(leo.sickBalanceHours).toBe("12");

    const stub = await call(`${base}/pay-runs/${b.id}`, { cookie: s.cookie });
    expect(stub.status).toBe(200);
    expect(stub.data.employer.name).toBe("API Studio LLC");
    expect(stub.data.stubs[0]).toMatchObject({ ssnLast4: "6789", ytd: { grossMinor: "1000000" } });
    const first = await call(`${base}/pay-runs/${a.id}`, { cookie: s.cookie });
    expect(first.data.stubs[0].ytd.grossMinor).toBe("800000");
  });
});

describe("direct deposit", () => {
  it("seals bank accounts and builds the bank file for an approved run", async () => {
    const s = await signup();
    const ent = await entity(s);
    const base = `/api/orgs/${s.orgId}/entities/${ent}`;
    const approver = await join(s, `approver${Date.now()}${n++}@example.com`, "approver");
    const bookkeeper = await join(s, `books${Date.now()}${n++}@example.com`, "bookkeeper");

    const bad = await call(`${base}/employees`, { cookie: s.cookie, body: { ...maya, directDeposit: { routing: "121000359", account: "12345678" } } });
    expect(bad.status).toBe(422);
    const noAccount = await call(`${base}/employees`, { cookie: s.cookie, body: { ...maya, directDeposit: { routing: "121000358" } } });
    expect(noAccount.status).toBe(422);
    const m = (await call(`${base}/employees`, { cookie: s.cookie, body: { ...maya, directDeposit: { routing: "121000358", accountType: "savings", account: "0001-2345-6789" } } })).data;
    expect(m.directDeposit).toEqual({ routing: "121000358", accountType: "savings", accountLast4: "6789" });
    expect(JSON.stringify(m)).not.toContain("000123456789");
    const leo = (await call(`${base}/employees`, { cookie: s.cookie, body: { ...maya, name: "Leo Park" } })).data;
    expect(leo.directDeposit).toBe(null);

    // Changing the account type keeps the account number on file.
    const changed = await call(`${base}/employees/${m.id}`, { cookie: s.cookie, body: { directDeposit: { routing: "121000358", accountType: "checking" } } });
    expect(changed.data.directDeposit).toEqual({ routing: "121000358", accountType: "checking", accountLast4: "6789" });

    const run = (await call(`${base}/pay-runs`, { cookie: s.cookie, body: runFor([m.id, leo.id]) })).data;
    let detail = await call(`${base}/pay-runs/${run.id}`, { cookie: s.cookie });
    expect(detail.data.directDeposit).toMatchObject({ ready: false, problem: "the run needs to be approved first" });
    expect((await call(`${base}/pay-runs/${run.id}/approve`, { cookie: approver.cookie, body: {} })).status).toBe(201);

    detail = await call(`${base}/pay-runs/${run.id}`, { cookie: s.cookie });
    expect(detail.data.directDeposit).toMatchObject({ ready: false, problem: "add your business's bank details for direct deposit first" });
    expect(detail.data.directDeposit.paperChecks.map((p: any) => p.name)).toEqual(["Leo Park"]);

    // Without an EIN there's no default company ID.
    const noEin = await call(`${base}/direct-deposit-settings`, { cookie: s.cookie, body: { odfiRouting: "121000358", destinationName: "Bank of America" } });
    expect(noEin.status).toBe(422);
    expect((await call(`${base}/settings`, { cookie: s.cookie, body: { ein: "12-3456789" } })).status).toBe(200);
    expect((await call(`${base}/direct-deposit-settings`, { cookie: bookkeeper.cookie, body: { odfiRouting: "121000358", destinationName: "Bank of America" } })).status).toBe(403);
    expect((await call(`${base}/direct-deposit-settings`, { cookie: s.cookie, body: { odfiRouting: "121000358", destinationName: "Bank of America", balanced: true } })).status).toBe(422);
    const settings = await call(`${base}/direct-deposit-settings`, { cookie: s.cookie, body: { odfiRouting: "121000358", destinationName: "Bank of America" } });
    expect(settings.data).toMatchObject({ companyId: "1123456789", immediateOrigin: "1123456789", immediateDestination: "121000358", companyName: "API Studio LLC", balanced: false });

    expect((await call(`${base}/pay-runs/${run.id}/direct-deposit`, { cookie: bookkeeper.cookie })).status).toBe(403);
    const file = await call(`${base}/pay-runs/${run.id}/direct-deposit`, { cookie: approver.cookie });
    expect(file.status).toBe(200);
    const lines = (file.data as string).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(10);
    const entry = lines[2]!;
    expect(entry.slice(0, 12)).toBe("622121000358");
    expect(entry.slice(12, 29).trim()).toBe("000123456789");
    expect(entry.slice(29, 39)).toBe(String(detail.data.directDeposit.totalMinor).padStart(10, "0"));
    expect(entry.slice(54, 76).trim()).toBe("MAYA CHEN");

    // The audit log and the backup never hold the full account number.
    const audit = JSON.stringify((await call(`/api/orgs/${s.orgId}/audit`, { cookie: s.cookie })).data.events);
    expect(audit).toContain("pay_run.direct_deposit_downloaded");
    expect(audit).not.toContain("000123456789");
    expect(audit).not.toContain("dd_account_sealed");
    const backup = await call(`${base}/backup`, { cookie: s.cookie, body: {} });
    expect(backup.data.tables.direct_deposit_settings).toHaveLength(1);
    expect(JSON.stringify(backup.data)).not.toContain("sealed");
    expect(JSON.stringify(backup.data.tables.employees)).toContain("6789");
  });
});

describe("payroll tax deposits", () => {
  it("lists deposits from posted runs, records a payment against the liabilities, and sends reminders once", async () => {
    const s = await signup();
    const ent = await entity(s);
    const base = `/api/orgs/${s.orgId}/entities/${ent}`;
    const approver = await join(s, `approver${Date.now()}${n++}@example.com`, "approver");
    const m = (await call(`${base}/employees`, { cookie: s.cookie, body: maya })).data;
    const run = (await call(`${base}/pay-runs`, { cookie: s.cookie, body: runFor([m.id], "2026-06-19") })).data;
    expect((await call(`${base}/tax-deposits?year=2026`, { cookie: s.cookie })).data.deposits).toEqual([]);
    expect((await call(`${base}/pay-runs/${run.id}/approve`, { cookie: approver.cookie, body: {} })).status).toBe(201);

    const list = await call(`${base}/tax-deposits?year=2026`, { cookie: s.cookie });
    expect(list.data.federalSchedule).toBe("monthly");
    const kinds = list.data.deposits.map((d: any) => [d.kind, d.dueDate]);
    expect(kinds).toEqual(expect.arrayContaining([["federal_941", "2026-07-15"], ["ca_ui_ett", "2026-07-31"]]));
    const fed = list.data.deposits.find((d: any) => d.kind === "federal_941");
    const taxes = run.run.paychecks[0].taxes;
    const sum = (codes: string[]) => taxes.filter((t: any) => codes.includes(t.code)).reduce((s: bigint, t: any) => s + BigInt(t.amountMinor), 0n);
    expect(BigInt(fed.amountMinor)).toBe(sum(["FIT", "SS_EE", "SS_ER", "MEDICARE_EE", "MEDICARE_ER"]));
    expect(fed).toMatchObject({ agency: "IRS", period: "June 2026" });

    expect((await call(`${base}/tax-deposits/pay`, { cookie: s.cookie, body: { key: fed.key, paidDate: "2099-01-01" } })).status).toBe(400);
    expect((await call(`${base}/tax-deposits/pay`, { cookie: s.cookie, body: { key: "federal_941:m:2026-01", paidDate: "2026-07-10" } })).status).toBe(422);
    const paid = await call(`${base}/tax-deposits/pay`, { cookie: s.cookie, body: { key: fed.key, paidDate: "2026-07-10", confirmation: "EFT 27064" } });
    expect(paid.status).toBe(201);
    expect(paid.data).toMatchObject({ amountMinor: fed.amountMinor, late: false });
    expect((await call(`${base}/tax-deposits/pay`, { cookie: s.cookie, body: { key: fed.key, paidDate: "2026-07-10" } })).status).toBe(422);

    const after = (await call(`${base}/tax-deposits?year=2026`, { cookie: s.cookie })).data.deposits.find((d: any) => d.key === fed.key);
    expect(after).toMatchObject({ status: "paid", remainingMinor: "0", payments: [{ paidDate: "2026-07-10", confirmation: "EFT 27064" }] });
    // The liabilities it paid are cleared: FIT and FICA payable are back to zero.
    const { rows: owed } = await pool.query(
      `SELECT a.system_key, sum(l.credit_minor - l.debit_minor)::text AS owed FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.entity_id = $1 AND a.system_key IN ('fit_payable', 'fica_payable', 'ca_ui_payable') GROUP BY a.system_key ORDER BY 1`, [ent]);
    expect(owed.map((r) => [r.system_key, r.owed !== "0"])).toEqual([["ca_ui_payable", true], ["fica_payable", false], ["fit_payable", false]]);
    const entry = (await pool.query("SELECT source_type, memo FROM journal_entries WHERE id = $1", [paid.data.entryId])).rows[0];
    expect(entry).toMatchObject({ source_type: "tax_deposit" });
    expect(entry.memo).toContain("EFT 27064");

    // Reminders: the open deposits are overdue on Aug 5 (due Jul 31) and each is emailed once.
    const sent: { to: string; subject: string; text: string }[] = [];
    const mailer = async (m: { to: string; subject: string; text: string }) => { sent.push(m); };
    const { sendDepositReminders } = await import("../src/payroll/deposit-reminders.js");
    await sendDepositReminders(pool, mailer, "2026-08-05", "https://alt-qbo.test");
    const mine = sent.filter((x) => x.to === s.email);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toContain("past due");
    expect(mine[0]!.text).toContain("California UI and ETT");
    expect(mine[0]!.text).not.toContain("Form 941)");
    expect(sent.some((x) => x.to === approver.email)).toBe(false);
    await sendDepositReminders(pool, mailer, "2026-08-06");
    expect(sent.filter((x) => x.to === s.email)).toHaveLength(1);
  });
});

describe("prepared payroll forms", () => {
  it("prepares 941, 940, DE 9 with DE 9C, and W-2s with the W-3 from posted runs and deposits", async () => {
    const s = await signup();
    const ent = await entity(s);
    const base = `/api/orgs/${s.orgId}/entities/${ent}`;
    const approver = await join(s, `approver${Date.now()}${n++}@example.com`, "approver");
    expect((await call(`${base}/payroll-settings`, { cookie: s.cookie, body: { caEmployerAccount: "123-4567" } })).status).toBe(400);
    expect((await call(`${base}/payroll-settings`, { cookie: s.cookie, body: { caEmployerAccount: "123-4567-8" } })).status).toBe(200);
    const formList = (await call(`${base}/payroll-forms?year=2026`, { cookie: s.cookie })).data;
    expect(formList.stateEmployerAccount).toBe("12345678");
    expect(formList.forms.filter((f: any) => f.quarter === 2).map((f: any) => f.slug)).toEqual(["941", "de9"]);
    // The state's assigned rates go in by tax code; a tax without one is refused.
    expect((await call(`${base}/payroll-settings`, { cookie: s.cookie, body: { stateRatesPercent: { CA_UI: "6.2" } } })).status).toBe(200);
    expect((await call(`${base}/payroll-settings`, { cookie: s.cookie, body: { stateRatesPercent: { CA_SDI: "1" } } })).status).toBe(422);
    const emps = (await call(`${base}/employees`, { cookie: s.cookie })).data;
    expect(emps.stateRates).toEqual({ CA_UI: "0.062" });
    expect(emps.state).toMatchObject({ code: "CA", name: "California", incomeTax: { method: "ca_method_b", certificate: "DE 4" }, forms: ["DE 9"] });
    expect((await call(`${base}/payroll-settings`, { cookie: s.cookie, body: { stateRatesPercent: { CA_UI: "" } } })).status).toBe(200);
    expect((await call(`/api/orgs/${s.orgId}`, { cookie: s.cookie })).data.countries.map((c: any) => c.code)).toEqual(["US", "CA"]);
    await call(`${base}/settings`, { cookie: s.cookie, body: { ein: "12-3456789" } });
    const m = (await call(`${base}/employees`, { cookie: s.cookie, body: {
      ...maya, ssn: "123-45-6789", address: { line1: "1 Main St", city: "Oakland", zip: "94607" },
      deductions: [{ kind: "traditional401k", amount: "150" }, { kind: "section125", amount: "100" }],
    } })).data;
    for (const payDate of ["2026-05-22", "2026-06-05"]) {
      const r = (await call(`${base}/pay-runs`, { cookie: s.cookie, body: { ...runFor([m.id], payDate), periodStart: `${payDate.slice(0, 8)}01`, periodEnd: `${payDate.slice(0, 8)}14` } })).data;
      expect((await call(`${base}/pay-runs/${r.id}/approve`, { cookie: approver.cookie, body: {} })).status).toBe(201);
    }
    const deposits = (await call(`${base}/tax-deposits?year=2026`, { cookie: s.cookie })).data.deposits;
    const may = deposits.find((d: any) => d.key === "federal_941:m:2026-05");
    await call(`${base}/tax-deposits/pay`, { cookie: s.cookie, body: { key: may.key, paidDate: "2026-06-10" } });

    const list = await call(`${base}/payroll-forms?year=2026`, { cookie: s.cookie });
    expect(list.data.forms.map((f: any) => `${f.form} ${f.period}`)).toEqual(expect.arrayContaining(["941 Q2 2026", "DE 9 Q2 2026", "940 2026", "W-2 2026"]));

    const line = (f: any, l: string) => { const x = f.lines.find((y: any) => y.line === l); return x.kind === "money" ? BigInt(x.value ?? 0) : x.value; };
    const r941 = await call(`${base}/payroll-forms/prepared?form=941&year=2026&quarter=2`, { cookie: s.cookie });
    expect(r941.data).not.toHaveProperty("error");
    const f941 = r941.data;
    // Each paycheck: 3,000 gross, 100 section 125, 150 401(k).
    expect(line(f941, "2")).toBe(2n * 275000n);
    expect(line(f941, "5a col 1")).toBe(2n * 290000n);
    expect(line(f941, "5a col 2")).toBe(71920n);
    expect(line(f941, "6") + line(f941, "7")).toBe(line(f941, "12"));
    expect(line(f941, "12")).toBe(deposits.filter((d: any) => d.kind === "federal_941").reduce((s: bigint, d: any) => s + BigInt(d.amountMinor), 0n));
    expect(line(f941, "13")).toBe(BigInt(may.amountMinor));
    expect(line(f941, "14")).toBe(line(f941, "12") - BigInt(may.amountMinor));
    expect(line(f941, "1")).toBe(1);
    expect(f941.dueDate).toBe("2026-07-31");

    const f940 = (await call(`${base}/payroll-forms/prepared?form=940&year=2026`, { cookie: s.cookie })).data;
    expect(line(f940, "3")).toBe(600000n);
    expect(line(f940, "4")).toBe(20000n);
    expect(line(f940, "7")).toBe(580000n);
    expect(line(f940, "8")).toBe(3480n);
    expect(line(f940, "11")).toBe(0n);
    expect(f940.warnings.join(" ")).toMatch(/credit reduction/);

    const de9 = (await call(`${base}/payroll-forms/prepared?form=de9&year=2026&quarter=2`, { cookie: s.cookie })).data;
    expect(line(de9, "C")).toBe(580000n);
    expect(line(de9, "D2")).toBe(580000n);
    expect(line(de9, "H")).toBe(line(de9, "D3") + line(de9, "E2") + line(de9, "F3") + line(de9, "G"));
    expect(de9.employees[0]).toMatchObject({ ssn: "xxx-xx-6789", subjectWagesMinor: "580000", pitWagesMinor: "550000" });

    const w2 = (await call(`${base}/payroll-forms/prepared?form=w2&year=2026&ssn=full`, { cookie: s.cookie })).data;
    expect(w2.employees[0]).toMatchObject({
      ssn: "123-45-6789", box1: "550000", box3: "580000", box5: "580000", box16: "550000",
      box12: [{ code: "D", amountMinor: "30000" }], box15: { state: "CA", employerStateId: "123-4567-8" },
    });
    expect(line(w2, "W-3 c")).toBe(1);
    // Only owners, admins and accountants see full numbers, and each look is in the audit log.
    const masked = (await call(`${base}/payroll-forms/prepared?form=w2&year=2026&ssn=full`, { cookie: approver.cookie })).data;
    expect(masked.employees[0].ssn).toBe("xxx-xx-6789");
    const audit = JSON.stringify((await call(`/api/orgs/${s.orgId}/audit`, { cookie: s.cookie })).data.events);
    expect(audit).toContain("payroll_form.viewed_with_ssn");
    expect(audit).not.toContain("123456789");

    const csv = await call(`${base}/payroll-forms/prepared?form=de9&year=2026&quarter=2&format=csv`, { cookie: s.cookie });
    expect(csv.data).toContain("ssn,name,subjectWagesMinor");
    expect(csv.data).toContain("5800.00");
    expect((await call(`${base}/payroll-forms/prepared?form=nope&year=2026`, { cookie: s.cookie })).status).toBe(404);
  });
});

describe("terms of service", () => {
  it("are accepted at sign-up for the new business, and again by an owner when they change", async () => {
    const { TERMS_VERSION } = await import("../src/app/terms.js");
    const email = `terms${Date.now()}@example.com`;
    const refused = await call("/api/auth/signup", { body: { name: "T", email, password: "long-enough-pw", orgName: "Terms Co", inviteCode: "invite-123" } });
    expect(refused.status).toBe(400);
    expect(refused.data.error).toMatch(/Terms of Service/);

    const s = await signup("Terms Co");
    const me = await call("/api/me", { cookie: s.cookie });
    expect(me.data.termsVersion).toBe(TERMS_VERSION);
    expect(me.data.orgs[0]).toMatchObject({ id: s.orgId, termsAccepted: true });

    // Someone joining through an invitation doesn't accept for the business, and can't.
    const bkEmail = `bk${Date.now()}@example.com`;
    const inv = await call(`/api/orgs/${s.orgId}/invitations`, { cookie: s.cookie, body: { email: bkEmail, role: "bookkeeper" } });
    const bk = await call("/api/auth/signup", { body: { name: "BK", email: bkEmail, password: "member-pass-12", inviteToken: inv.data.token } });
    expect(bk.status).toBe(201);
    expect((await call(`/api/orgs/${s.orgId}/terms/accept`, { cookie: bk.cookie, body: { version: TERMS_VERSION } })).status).toBe(403);

    // The record can't be rewritten; accepting is for the current version only, and safe to repeat.
    const { withSystem } = await import("../src/db/pool.js");
    await expect(withSystem(pool, (tx) => tx.query("UPDATE terms_acceptances SET version = '2020-01-01' WHERE org_id = $1", [s.orgId]))).rejects.toThrow(/IMMUTABLE/);
    expect((await call(`/api/orgs/${s.orgId}/terms/accept`, { cookie: s.cookie, body: { version: "2020-01-01" } })).status).toBe(409);
    expect((await call(`/api/orgs/${s.orgId}/terms/accept`, { cookie: s.cookie, body: { version: TERMS_VERSION } })).data).toEqual({ ok: true, version: TERMS_VERSION });

    const pub = await call("/api/terms");
    expect(pub.data).toEqual({ version: TERMS_VERSION, company: null });
  });
});
