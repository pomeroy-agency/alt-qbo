import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleApi } from "../src/app/api.js";
import { signPayload, SIGNATURE_HEADER, type HubOptions } from "../src/app/hub.js";
import { verifyHubToken } from "../src/app/hub-signin.js";
import { base32Decode, stepAt, totpAt } from "../src/app/mfa.js";
import { pool } from "./helpers.js";

const BASE = "https://alt-qbo.test";
const HUB = "https://account.example";
const CLIENT = "trailbook-test";
const CLIENT_SECRET = "trailbook-client-secret";

// The hub, as TrailBook sees it: a P-256 key pair, a JWKS, and /token.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const KID = "test-key";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, use: "sig", alg: "ES256" };

function token(claims: Record<string, unknown>, opts: { kid?: string; key?: typeof privateKey } = {}) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "ES256", typ: "JWT", kid: opts.kid ?? KID });
  const p = b64({ iss: HUB, aud: CLIENT, iat: now, nbf: now, exp: now + 300, ...claims });
  const s = sign("sha256", Buffer.from(`${h}.${p}`), { key: opts.key ?? privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${h}.${p}.${s}`;
}

/** Codes the fake hub has issued: code → who signed in and the PKCE challenge. */
const codes = new Map<string, { claims: Record<string, unknown>; challenge: string; redirect: string }>();
let tokenCalls = 0;
const hub: HubOptions = {
  url: HUB,
  secret: "test-secret-that-is-at-least-32-characters-long",
  clientId: CLIENT,
  clientSecret: CLIENT_SECRET,
  fetch: async (input, init) => {
    const url = String(input);
    if (url === `${HUB}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    if (url === `${HUB}/token`) {
      tokenCalls++;
      const b = JSON.parse(String(init!.body));
      if (b.client_id !== CLIENT || b.client_secret !== CLIENT_SECRET) return Response.json({ error: "invalid_client" }, { status: 401 });
      const c = codes.get(b.code);
      codes.delete(b.code);
      const verifierOk = c && createHash("sha256").update(b.code_verifier).digest("base64url") === c.challenge;
      if (!c || !verifierOk || b.redirect_uri !== c.redirect || b.grant_type !== "authorization_code") return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ token_type: "Bearer", id_token: token(c.claims), expires_in: 300 });
    }
    // The status push after billing changes isn't part of these tests.
    return new Response("{}", { status: 200 });
  },
};

const sent: { to: string; subject: string; text: string }[] = [];
const opts = { signupCode: "c", appUrl: BASE, hub, mailer: async (m: { to: string; subject: string; text: string }) => { sent.push(m); } };

async function call(path: string, init: { body?: unknown; cookie?: string; headers?: Record<string, string>; raw?: string } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  const payload = init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined);
  if (payload !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  const res = await handleApi(new Request(BASE + path, { method: payload !== undefined ? "POST" : "GET", headers, body: payload }), pool, opts);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]!);
  return {
    status: res.status, location: res.headers.get("location"), data: await res.json().catch(() => null),
    session: cookies.find((c) => c.startsWith("altqbo_session=") && c !== "altqbo_session="),
    hubState: cookies.find((c) => c.startsWith("tb_hub_state=")),
  };
}

let n = 0;
async function person() {
  const email = `hubin${Date.now()}${n++}@example.com`;
  const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "Robin", email, password: "long-enough-pw", orgName: "Hub Sign-in Co", inviteCode: "c" } });
  expect(su.status).toBe(201);
  const me = await call("/api/me", { cookie: su.session });
  return { email, cookie: su.session!, id: me.data.user.id as string, sub: `hub-user-${n}-${Date.now()}` };
}

/** Clicks "Sign in with Pomeroy Account", signs in at the hub as `claims`, and comes back. */
async function viaHub(claims: Record<string, unknown>, o: { cookie?: string; link?: boolean; tamperState?: boolean } = {}) {
  const start = await call(`/api/auth/hub/start${o.link ? "?link=1" : ""}`, { cookie: o.cookie });
  expect(start.status).toBe(302);
  const at = new URL(start.location!);
  expect(at.origin + at.pathname).toBe(`${HUB}/authorize`);
  expect(Object.fromEntries(at.searchParams)).toMatchObject({ client_id: CLIENT, response_type: "code", code_challenge_method: "S256", redirect_uri: `${BASE}/api/auth/hub/callback` });
  const state = at.searchParams.get("state")!;
  const code = `code-${Math.random().toString(36).slice(2)}`;
  codes.set(code, { claims, challenge: at.searchParams.get("code_challenge")!, redirect: at.searchParams.get("redirect_uri")! });
  const cookie = [start.hubState, o.cookie].filter(Boolean).join("; ");
  return call(`/api/auth/hub/callback?code=${code}&state=${o.tamperState ? "x" + state.slice(1) : state}`, { cookie });
}

const lastLink = () => /#\/hub-link\/([\w-]+)/.exec(sent.at(-1)!.text)![1]!;

describe("signing in with a Pomeroy Account", () => {
  it("says it's available, and connects a TrailBook login through an emailed link before it signs in", async () => {
    expect((await call("/api/auth/options")).data).toMatchObject({ hub: true });
    const p = await person();
    const first = await viaHub({ sub: p.sub, email: p.email.toUpperCase(), email_verified: true });
    expect(first.location).toBe(`${BASE}/#/hub/check-email`);
    expect(first.session).toBeUndefined();
    expect(sent.at(-1)).toMatchObject({ to: p.email, subject: "Connect your Pomeroy Account to TrailBook" });

    const linked = await call(`/api/auth/hub-link/${lastLink()}`, { body: {} });
    expect(linked.status).toBe(200);
    expect(linked.session).toBeDefined();
    expect((await call("/api/me", { cookie: linked.session })).data.user.hubConnected).toBe(true);
    // The link works once.
    expect((await call(`/api/auth/hub-link/${lastLink()}`, { body: {} })).status).toBe(400);

    // From now on the Pomeroy Account opens the books straight away.
    const again = await viaHub({ sub: p.sub, email: p.email, email_verified: true });
    expect(again.location).toBe(`${BASE}/#/`);
    const me = await call("/api/me", { cookie: again.session });
    expect(me.data.user).toMatchObject({ id: p.id, secondFactor: false });
  });

  it("still asks for TrailBook's own second factor", async () => {
    const p = await person();
    const setup = await call("/api/me/mfa/setup", { cookie: p.cookie, body: {} });
    expect((await call("/api/me/mfa/enable", { cookie: p.cookie, body: { code: totpAt(base32Decode(setup.data.secret), stepAt(Date.now())) } })).status).toBe(200);
    await viaHub({ sub: p.sub, email: p.email, email_verified: true });
    const linked = await call(`/api/auth/hub-link/${lastLink()}`, { body: {} });
    expect(linked.data).toMatchObject({ mfaRequired: true });
    expect(linked.session).toBeUndefined();

    const back = await viaHub({ sub: p.sub, email: p.email, email_verified: true });
    expect(back.session).toBeUndefined();
    const ticket = /#\/hub\/code\/([\w-]+)$/.exec(back.location!)![1]!;
    const done = await call("/api/auth/mfa", { body: { ticket, code: totpAt(base32Decode(setup.data.secret), stepAt(Date.now()) + 1) } });
    expect(done.status).toBe(200);
    expect((await call("/api/me", { cookie: done.session })).data.user.secondFactor).toBe(true);
  });

  it("connects from Your account while signed in, even with a different email, and the hub's sign-out ends those sessions", async () => {
    const p = await person();
    const r = await viaHub({ sub: p.sub, email: "someone-else@example.com", email_verified: true }, { cookie: p.cookie, link: true });
    expect(r.location).toBe(`${BASE}/#/hub/connected`);
    const signedIn = await viaHub({ sub: p.sub, email: "someone-else@example.com" });
    expect(signedIn.session).toBeDefined();

    // The hub's own sign-out body: its user id and email.
    const raw = JSON.stringify({ event: "signout", user_id: p.sub, email: "someone-else@example.com", at: new Date().toISOString() });
    const out = await call("/api/hub/signout", { raw, headers: { [SIGNATURE_HEADER]: signPayload(hub, raw) } });
    expect(out.data).toEqual({ ok: true, sessions_ended: 2 });
    expect((await call("/api/me", { cookie: signedIn.session })).status).toBe(401);

    // One Pomeroy Account opens one TrailBook login.
    const other = await person();
    expect((await viaHub({ sub: p.sub, email: other.email }, { cookie: other.cookie, link: true })).location).toBe(`${BASE}/#/hub/taken`);
  });

  it("turns away a sign-in it didn't start, a reused state, an unknown email, and a token that isn't for TrailBook", async () => {
    const p = await person();
    expect((await viaHub({ sub: p.sub, email: p.email }, { tamperState: true })).location).toBe(`${BASE}/#/hub/expired`);
    expect((await viaHub({ sub: "nobody", email: "nobody-here@example.com" })).location).toBe(`${BASE}/#/hub/no-account`);

    const start = await call("/api/auth/hub/start");
    const state = new URL(start.location!).searchParams.get("state")!;
    expect((await call(`/api/auth/hub/callback?error=access_denied&state=${state}`, { cookie: start.hubState })).location).toBe(`${BASE}/#/hub/cancelled`);
    expect((await call(`/api/auth/hub/callback?code=x&state=${state}`, { cookie: start.hubState })).location).toBe(`${BASE}/#/hub/expired`);

    expect((await viaHub({ sub: p.sub, email: p.email, aud: "milepost" })).location).toBe(`${BASE}/#/hub/bad_token`);
    expect((await viaHub({ sub: p.sub, email: p.email, iss: "https://evil.example" })).location).toBe(`${BASE}/#/hub/bad_token`);
    expect((await viaHub({ sub: p.sub, email: p.email, exp: Math.floor(Date.now() / 1000) - 600 })).location).toBe(`${BASE}/#/hub/bad_token`);
  });

  it("checks the token's signature against the hub's published key", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    await expect(verifyHubToken(hub as HubOptions & { clientId: string }, token({ sub: "s", email: "a@b.co" }, { key: other }))).rejects.toThrow(/signature/);
    await expect(verifyHubToken(hub as HubOptions & { clientId: string }, token({ sub: "s", email: "a@b.co" }, { kid: "unknown" }))).rejects.toThrow(/unknown key/);
    const ok = await verifyHubToken(hub as HubOptions & { clientId: string }, token({ sub: "s", email: "A@B.co", email_verified: true }));
    expect(ok).toEqual({ sub: "s", email: "a@b.co", emailVerified: true, name: undefined });
    expect(tokenCalls).toBeGreaterThan(0);
  });
});
