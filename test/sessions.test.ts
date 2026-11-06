import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleApi, needsSecondFactor } from "../src/app/api.js";
import { base32Decode, stepAt, totpAt } from "../src/app/mfa.js";
import { pool } from "./helpers.js";

const BASE = "https://alt-qbo.test";
const opts = { signupCode: "c", appUrl: BASE };

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

const tokenHash = (cookie: string) => createHash("sha256").update(decodeURIComponent(cookie.split("=").slice(1).join("="))).digest("hex");
const session = async (cookie: string) => (await pool.query("SELECT * FROM sessions WHERE token_hash = $1", [tokenHash(cookie)])).rows[0];
const codeNow = (secret: string, offset = 0) => totpAt(base32Decode(secret), stepAt(Date.now()) + offset);

let n = 0;
async function business() {
  const email = `sess${Date.now()}${n++}@example.com`;
  const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Sam", email, password: "long-enough-pw", orgName: "Session Co", inviteCode: "c" } });
  expect(su.status).toBe(201);
  const cookie = su.cookie!;
  const orgId = (await call("/api/me", { cookie })).data.orgs[0].id as string;
  const ent = await call(`/api/orgs/${orgId}/entities`, { cookie, body: { legalName: "Session Studio LLC", entityType: "llc_single", region: "CA", firstFiscalYear: 2026 } });
  expect(ent.status).toBe(201);
  return { email, cookie, orgId, base: `/api/orgs/${orgId}/entities/${ent.data.id}` };
}

describe("session length", () => {
  it("ends a session after 12 hours without use, and 7 days after sign-in at most", async () => {
    const s = await business();
    // Two hours idle is fine, and using the session moves its last-seen time.
    await pool.query("UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE token_hash = $1", [tokenHash(s.cookie)]);
    expect((await call("/api/me", { cookie: s.cookie })).status).toBe(200);
    expect(Date.now() - new Date((await session(s.cookie)).last_seen_at).getTime()).toBeLessThan(60_000);

    await pool.query("UPDATE sessions SET last_seen_at = now() - interval '12 hours 1 minute' WHERE token_hash = $1", [tokenHash(s.cookie)]);
    expect((await call("/api/me", { cookie: s.cookie })).status).toBe(401);

    const again = await call("/api/auth/login", { body: { email: s.email, password: "long-enough-pw" } });
    expect(again.status).toBe(200);
    const row = await session(again.cookie!);
    expect(new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()).toBe(7 * 24 * 3600 * 1000);
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [tokenHash(again.cookie!)]);
    expect((await call("/api/me", { cookie: again.cookie })).status).toBe(401);
  });
});

describe("second factor for payroll, bank details and tax filings", () => {
  it("knows which requests need it", () => {
    const e = "/api/orgs/o/entities/e";
    expect(needsSecondFactor("POST", `${e}/employees`)).toBe(true);
    expect(needsSecondFactor("POST", `${e}/employees/x`)).toBe(true);
    expect(needsSecondFactor("POST", `${e}/pay-runs`)).toBe(true);
    expect(needsSecondFactor("POST", `${e}/pay-runs/x/approve`)).toBe(true);
    expect(needsSecondFactor("POST", `${e}/direct-deposit-settings`)).toBe(true);
    expect(needsSecondFactor("POST", `${e}/tax-deposits/pay`)).toBe(true);
    expect(needsSecondFactor("POST", `${e}/sales-tax-settings`)).toBe(true);
    expect(needsSecondFactor("GET", `${e}/pay-runs/x/direct-deposit`)).toBe(true);
    expect(needsSecondFactor("GET", `${e}/payroll-forms/prepared`)).toBe(true);
    expect(needsSecondFactor("GET", `${e}/sales-tax/return`)).toBe(true);
    // Reading payroll pages, previews and the books stay open.
    expect(needsSecondFactor("GET", `${e}/employees`)).toBe(false);
    expect(needsSecondFactor("GET", `${e}/pay-runs`)).toBe(false);
    expect(needsSecondFactor("POST", `${e}/pay-runs/preview`)).toBe(false);
    expect(needsSecondFactor("POST", `${e}/invoices`)).toBe(false);
  });

  it("asks someone without two-factor to turn it on, and lets them through once they have", async () => {
    const s = await business();
    const refused = await call(`${s.base}/payroll-settings`, { cookie: s.cookie, body: { sickLeavePolicy: "front_load" } });
    expect(refused.status).toBe(403);
    expect(refused.data).toMatchObject({ code: "second_factor_required" });
    expect(refused.data.error).toMatch(/turn it on/);
    expect((await call(`${s.base}/employees`, { cookie: s.cookie })).status).toBe(200);

    // Turning it on counts as this session's second factor.
    const setup = await call("/api/me/mfa/setup", { cookie: s.cookie, body: {} });
    expect((await call("/api/me/mfa/enable", { cookie: s.cookie, body: { code: codeNow(setup.data.secret) } })).status).toBe(200);
    expect((await call("/api/me", { cookie: s.cookie })).data.user.secondFactor).toBe(true);
    expect((await call(`${s.base}/payroll-settings`, { cookie: s.cookie, body: { sickLeavePolicy: "front_load" } })).status).toBe(200);

    // Every new sign-in asks for the code, and the session it gives counts.
    const login = await call("/api/auth/login", { body: { email: s.email, password: "long-enough-pw" } });
    expect(login.data).toMatchObject({ mfaRequired: true });
    expect(login.cookie).toBeUndefined();
    const done = await call("/api/auth/mfa", { body: { ticket: login.data.ticket, code: codeNow(setup.data.secret, 1) } });
    expect(done.status).toBe(200);
    expect((await call("/api/me", { cookie: done.cookie })).data.user.secondFactor).toBe(true);
    expect((await call(`${s.base}/payroll-settings`, { cookie: done.cookie, body: { sickLeavePolicy: "front_load" } })).status).toBe(200);

    // A session that didn't pass the code (opened before it was on) is sent back to sign in.
    await pool.query("UPDATE sessions SET mfa_at = NULL WHERE token_hash = $1", [tokenHash(done.cookie!)]);
    const stale = await call(`${s.base}/payroll-settings`, { cookie: done.cookie, body: { sickLeavePolicy: "front_load" } });
    expect(stale.status).toBe(403);
    expect(stale.data.error).toMatch(/sign in again/);
  });
});
