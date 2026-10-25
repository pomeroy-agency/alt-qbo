import { describe, expect, it } from "vitest";
import { handleApi } from "../src/app/api.js";
import type { MailMessage } from "../src/app/mail.js";
import { pool } from "./helpers.js";

const sent: MailMessage[] = [];
const opts = { mailer: async (m: MailMessage) => { sent.push(m); }, appUrl: "https://books.example" };

async function call(path: string, init: { body?: unknown; cookie?: string; withoutMail?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  const res = await handleApi(
    new Request(`https://forged-host.example${path}`, { method: init.body !== undefined ? "POST" : "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
    pool,
    init.withoutMail ? {} : opts,
  );
  return { status: res.status, data: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

let n = 0;
const uniq = (p: string) => `${p}${Date.now()}${n++}@example.com`;
/** The last link emailed to an address, and its token. */
function lastLink(to: string) {
  const m = [...sent].reverse().find((x) => x.to === to);
  const link = /https:\/\/\S+/.exec(m?.text ?? "")?.[0] ?? "";
  return { subject: m?.subject, link, token: link.split("/").pop()! };
}

async function signup(email = uniq("ann"), password = "first-password-1") {
  const r = await call("/api/auth/signup", { body: { name: "Ann", email, password, orgName: "Ann Co" } });
  expect(r.status).toBe(201);
  return { email, cookie: r.cookie! };
}

describe("email sign-in, reset and confirmation", () => {
  it("confirms the email from the link sent at sign-up, using the configured site address", async () => {
    const s = await signup();
    const mail = lastLink(s.email);
    expect(mail.subject).toBe("Confirm your email for Alt-QBO");
    expect(mail.link.startsWith("https://books.example/#/verify/")).toBe(true);
    expect((await call("/api/me", { cookie: s.cookie })).data.user.emailVerified).toBe(false);
    expect((await call(`/api/auth/verify/${mail.token}`, { body: {} })).data).toEqual({ ok: true, email: s.email });
    expect((await call("/api/me", { cookie: s.cookie })).data.user.emailVerified).toBe(true);
    expect((await call(`/api/auth/verify/${mail.token}`, { body: {} })).status).toBe(400);
  });

  it("signs in by emailed link, once, and says nothing about unknown addresses", async () => {
    const s = await signup();
    const before = sent.length;
    expect((await call("/api/auth/email-link", { body: { email: uniq("nobody") } })).data).toEqual({ ok: true });
    expect(sent.length).toBe(before);
    expect((await call("/api/auth/email-link", { body: { email: s.email.toUpperCase() } })).status).toBe(200);
    const { token, subject } = lastLink(s.email);
    expect(subject).toBe("Your Alt-QBO sign-in link");
    const r = await call(`/api/auth/email-link/${token}`, { body: {} });
    expect(r.status).toBe(200);
    expect((await call("/api/me", { cookie: r.cookie })).data.user.email).toBe(s.email);
    expect((await call(`/api/auth/email-link/${token}`, { body: {} })).status).toBe(400);
    // A sign-in token can't be used as a reset token.
    await call("/api/auth/email-link", { body: { email: s.email } });
    expect((await call(`/api/auth/reset/${lastLink(s.email).token}`, { body: { password: "another-password-2" } })).status).toBe(400);
  });

  it("resets the password, signing out every other session", async () => {
    const s = await signup();
    await call("/api/auth/reset", { body: { email: s.email } });
    const { token } = lastLink(s.email);
    expect((await call(`/api/auth/reset/${token}`, { body: { password: "short" } })).status).toBe(400);
    const r = await call(`/api/auth/reset/${token}`, { body: { password: "brand-new-password" } });
    expect(r.status).toBe(200);
    expect((await call("/api/me", { cookie: s.cookie })).status).toBe(401);
    expect((await call("/api/me", { cookie: r.cookie })).status).toBe(200);
    expect((await call("/api/auth/login", { body: { email: s.email, password: "first-password-1" } })).status).toBe(401);
    expect((await call("/api/auth/login", { body: { email: s.email, password: "brand-new-password" } })).status).toBe(200);
  });

  it("limits links per hour and needs email to be set up", async () => {
    const s = await signup();
    const before = sent.length;
    for (let i = 0; i < 7; i++) await call("/api/auth/reset", { body: { email: s.email } });
    expect(sent.length - before).toBe(5);
    expect((await call("/api/auth/options", { withoutMail: true })).data).toEqual({ email: false });
    expect((await call("/api/auth/reset", { body: { email: s.email }, withoutMail: true })).status).toBe(503);
  });

  it("emails team invitations", async () => {
    const s = await signup();
    const orgId = (await call("/api/me", { cookie: s.cookie })).data.orgs[0].id;
    const email = uniq("bo");
    const inv = await call(`/api/orgs/${orgId}/invitations`, { cookie: s.cookie, body: { email, role: "bookkeeper" } });
    expect(inv.data.emailed).toBe(true);
    const mail = lastLink(email);
    expect(mail.subject).toBe("Ann invited you to Ann Co on Alt-QBO");
    expect(mail.link).toBe(`https://books.example/#/join/${inv.data.token}`);
  });
});

describe("mail configuration", () => {
  it("prefers SMTP settings, stays off without a sender for them, and falls back to Gmail or nothing", async () => {
    const { mailerFromEnv } = await import("../src/app/mail.js");
    expect(mailerFromEnv({})).toBeUndefined();
    expect(mailerFromEnv({ GMAIL_USER: "a@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" })).toBeTypeOf("function");
    expect(mailerFromEnv({ SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "x@smtp-brevo.com", SMTP_PASSWORD: "key", MAIL_FROM: "Alt-QBO <books@example.com>" })).toBeTypeOf("function");
    expect(mailerFromEnv({ SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "x@smtp-brevo.com", SMTP_PASSWORD: "key" })).toBeUndefined();
  });
});
