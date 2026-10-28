import { describe, expect, it } from "vitest";
import { handleApi } from "../src/app/api.js";
import { base32Decode, base32Encode, matchTotp, stepAt, totpAt } from "../src/app/mfa.js";
import { pool } from "./helpers.js";

const BASE = "https://alt-qbo.test";
const sent: { to: string; subject: string; text: string }[] = [];
const opts = { signupCode: "invite-123", mailer: async (m: { to: string; subject: string; text: string }) => { sent.push(m); }, appUrl: BASE };

async function call(path: string, init: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  const res = await handleApi(
    new Request(BASE + path, { method: init.body !== undefined ? "POST" : "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
    pool, opts,
  );
  return { status: res.status, data: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

let n = 0;
async function signup() {
  const email = `mfa${Date.now()}${n++}@example.com`;
  const r = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Pat", email, password: "long-enough-pw", orgName: "MFA Co", inviteCode: "invite-123" } });
  expect(r.status).toBe(201);
  const me = await call("/api/me", { cookie: r.cookie });
  return { cookie: r.cookie!, email, orgId: me.data.orgs[0].id as string };
}

const codeNow = (secret: string, offsetSteps = 0) => totpAt(base32Decode(secret), stepAt(Date.now()) + offsetSteps);

/** Turns two-factor on and returns the secret and recovery codes. */
async function turnOn(s: { cookie: string }) {
  const setup = await call("/api/me/mfa/setup", { cookie: s.cookie, body: {} });
  expect(setup.status).toBe(200);
  expect(setup.data.qrSvg).toContain("<svg");
  expect(setup.data.uri).toMatch(/^otpauth:\/\/totp\/Alt-QBO/);
  const on = await call("/api/me/mfa/enable", { cookie: s.cookie, body: { code: codeNow(setup.data.secret) } });
  expect(on.status).toBe(200);
  return { secret: setup.data.secret as string, recoveryCodes: on.data.recoveryCodes as string[] };
}

describe("TOTP", () => {
  it("matches the RFC 6238 test vector", () => {
    // RFC 6238 appendix B, SHA-1, T = 59 s: 94287082 (last six digits 287082).
    const secret = Buffer.from("12345678901234567890");
    expect(totpAt(secret, stepAt(59_000))).toBe("287082");
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
  });

  it("accepts one step of drift, and never the same step twice", () => {
    const secret = Buffer.from("12345678901234567890");
    const now = 1_800_000_000_000;
    const step = stepAt(now);
    expect(matchTotp(secret, totpAt(secret, step - 1), now, null)).toBe(step - 1);
    expect(matchTotp(secret, totpAt(secret, step - 2), now, null)).toBeNull();
    expect(matchTotp(secret, totpAt(secret, step), now, step)).toBeNull();
    expect(matchTotp(secret, "12345", now, null)).toBeNull();
  });
});

describe("two-factor sign-in", () => {
  it("asks for a code after the password, and signs in only with a right one", async () => {
    const s = await signup();
    const { secret } = await turnOn(s);
    expect(sent.at(-1)?.subject).toMatch(/Two-factor sign-in is on/);

    const login = await call("/api/auth/login", { body: { email: s.email, password: "long-enough-pw" } });
    expect(login.status).toBe(200);
    expect(login.data.mfaRequired).toBe(true);
    expect(login.cookie).toBeUndefined();

    const wrong = await call("/api/auth/mfa", { body: { ticket: login.data.ticket, code: "000000" } });
    expect(wrong.status).toBe(401);
    // The code from the step used to enable it was spent, so use the next one.
    const right = await call("/api/auth/mfa", { body: { ticket: login.data.ticket, code: codeNow(secret, 1) } });
    expect(right.status).toBe(200);
    expect(right.cookie).toMatch(/^altqbo_session=/);
    const me = await call("/api/me", { cookie: right.cookie });
    expect(me.data.user.mfa).toEqual({ enabled: true, recoveryCodesLeft: 10 });

    // A ticket works once.
    expect((await call("/api/auth/mfa", { body: { ticket: login.data.ticket, code: codeNow(secret, 1) } })).status).toBe(401);
  });

  it("locks a ticket after five wrong codes", async () => {
    const s = await signup();
    const { secret } = await turnOn(s);
    const login = await call("/api/auth/login", { body: { email: s.email, password: "long-enough-pw" } });
    for (let i = 0; i < 5; i++) expect((await call("/api/auth/mfa", { body: { ticket: login.data.ticket, code: "111111" } })).status).toBe(401);
    const late = await call("/api/auth/mfa", { body: { ticket: login.data.ticket, code: codeNow(secret, 1) } });
    expect(late.status).toBe(401);
    expect(late.data.error).toMatch(/sign in again/);
  });

  it("takes each recovery code once", async () => {
    const s = await signup();
    const { recoveryCodes } = await turnOn(s);
    const first = await call("/api/auth/login", { body: { email: s.email, password: "long-enough-pw" } });
    const ok = await call("/api/auth/mfa", { body: { ticket: first.data.ticket, code: recoveryCodes[0]!.toUpperCase() } });
    expect(ok.status).toBe(200);
    const again = await call("/api/auth/login", { body: { email: s.email, password: "long-enough-pw" } });
    expect((await call("/api/auth/mfa", { body: { ticket: again.data.ticket, code: recoveryCodes[0] } })).status).toBe(401);
    const me = await call("/api/me", { cookie: ok.cookie });
    expect(me.data.user.mfa.recoveryCodesLeft).toBe(9);
  });

  it("also guards emailed sign-in links", async () => {
    const s = await signup();
    await turnOn(s);
    await call("/api/auth/email-link", { body: { email: s.email } });
    const token = /#\/email-link\/([\w-]+)/.exec(sent.at(-1)!.text)![1]!;
    const r = await call(`/api/auth/email-link/${token}`, { body: {} });
    expect(r.data.mfaRequired).toBe(true);
    expect(r.cookie).toBeUndefined();
  });

  it("needs the password and a code to turn off", async () => {
    const s = await signup();
    const { secret } = await turnOn(s);
    expect((await call("/api/me/mfa/disable", { cookie: s.cookie, body: { password: "wrong-password", code: codeNow(secret, 1) } })).status).toBe(403);
    expect((await call("/api/me/mfa/disable", { cookie: s.cookie, body: { password: "long-enough-pw", code: "123456" } })).status).toBe(403);
    expect((await call("/api/me/mfa/disable", { cookie: s.cookie, body: { password: "long-enough-pw", code: codeNow(secret, 1) } })).status).toBe(200);
    const login = await call("/api/auth/login", { body: { email: s.email, password: "long-enough-pw" } });
    expect(login.cookie).toMatch(/^altqbo_session=/);
  });

  it("lets an owner require it for everyone", async () => {
    const s = await signup();
    expect((await call(`/api/orgs/${s.orgId}/security`, { cookie: s.cookie, body: { requireMfa: true } })).status).toBe(400);
    await turnOn(s);
    expect((await call(`/api/orgs/${s.orgId}/security`, { cookie: s.cookie, body: { requireMfa: true } })).status).toBe(200);

    const inv = await call(`/api/orgs/${s.orgId}/invitations`, { cookie: s.cookie, body: { email: `member${Date.now()}@example.com`, role: "bookkeeper" } });
    const member = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Sam", email: inv.data.email, password: "member-pass-12", inviteToken: inv.data.token } });
    const blocked = await call(`/api/orgs/${s.orgId}`, { cookie: member.cookie });
    expect(blocked.status).toBe(403);
    expect(blocked.data.error).toMatch(/requires two-factor/);
    await turnOn({ cookie: member.cookie! });
    expect((await call(`/api/orgs/${s.orgId}`, { cookie: member.cookie })).status).toBe(200);
  });
});
