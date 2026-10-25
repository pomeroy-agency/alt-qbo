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
    expect((await call(`/api/orgs/${s.orgId}/members`, { cookie: s.cookie, body: { name: "Ava", email: approverEmail, password: "approver-pass-1", role: "approver" } })).status).toBe(201);
    const ava = await call("/api/auth/login", { body: { email: approverEmail, password: "approver-pass-1" } });
    const approved = await call(`/api/orgs/${s.orgId}/entities/${ent}/pay-runs/${prepared.data.id}/approve`, { cookie: ava.cookie, body: {} });
    expect(approved.status).toBe(201);
    expect(approved.data.sourceType).toBe("pay_run");
    const again = await call(`/api/orgs/${s.orgId}/entities/${ent}/pay-runs/${prepared.data.id}/approve`, { cookie: ava.cookie, body: {} });
    expect(again.status).toBe(409);

    const viewerEmail = `viewer${Date.now()}@example.com`;
    await call(`/api/orgs/${s.orgId}/members`, { cookie: s.cookie, body: { name: "Vic", email: viewerEmail, password: "viewer-pass-12", role: "read_only" } });
    const vic = await call("/api/auth/login", { body: { email: viewerEmail, password: "viewer-pass-12" } });
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
