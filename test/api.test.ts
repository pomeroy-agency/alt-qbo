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
