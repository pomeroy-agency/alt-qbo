import { createHash, createPublicKey, randomBytes, verify as verifySig, type JsonWebKey } from "node:crypto";
import type pg from "pg";
import type { HubOptions } from "./hub.js";

// Signing in to TrailBook with a Pomeroy Account (plan phase 6).
//
// TrailBook is a "jwt" app at the hub. "Sign in with Pomeroy Account" sends
// the person to the hub's /authorize with a one-time state and a PKCE
// challenge. The hub sends them back here with a one-time code, which this
// server swaps at the hub's /token for a short-lived ES256 token naming
// TrailBook as its audience. The token is checked against the hub's
// published key (/.well-known/jwks.json), and then TrailBook sets its own
// HttpOnly session cookie, as for any other sign-in. TrailBook's own second
// factor is still asked for.
//
// A Pomeroy Account opens TrailBook only once it's connected to a TrailBook
// login: by a one-time link emailed to the TrailBook address, or from Your
// account while signed in.

const REQUEST_MINUTES = 10;
/** Clock difference allowed between the hub and TrailBook. */
const SKEW_SECONDS = 60;
const JWKS_CACHE_MS = 10 * 60_000;

export const HUB_STATE_COOKIE = "tb_hub_state";
export const HUB_CALLBACK_PATH = "/api/auth/hub/callback";

export class HubSignInError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "HubSignInError";
  }
}

/** Sign-in through the hub needs TrailBook's client id and secret at the hub, on top of the hub's address. */
export function hubSignInOn(hub: HubOptions | undefined): hub is HubOptions & { clientId: string; clientSecret: string } {
  return Boolean(hub?.clientId && hub.clientSecret);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const b64url = (buf: Buffer) => buf.toString("base64url");

/** Starts a sign-in: the address at the hub to send the person to, and the state for their cookie. */
export async function startHubSignIn(
  pool: pg.Pool, hub: HubOptions & { clientId: string }, appUrl: string,
  opts: { linkUserId?: string; signup?: boolean } = {},
): Promise<{ location: string; state: string }> {
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  await pool.query(
    `INSERT INTO hub_sign_in_requests (state_hash, code_verifier, link_user_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [sha(state), verifier, opts.linkUserId ?? null, REQUEST_MINUTES],
  );
  const u = new URL(`${hub.url}/authorize`);
  u.searchParams.set("client_id", hub.clientId);
  u.searchParams.set("redirect_uri", `${appUrl}${HUB_CALLBACK_PATH}`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (opts.signup) u.searchParams.set("screen", "signup");
  return { location: u.toString(), state };
}

/** Spends the waiting request for this state, once, before it expires. */
export async function takeHubSignIn(pool: pg.Pool, state: string): Promise<{ verifier: string; linkUserId: string | null }> {
  const row = (await pool.query(
    `UPDATE hub_sign_in_requests SET used_at = now()
      WHERE state_hash = $1 AND used_at IS NULL AND expires_at > now()
      RETURNING code_verifier, link_user_id`,
    [sha(state)],
  )).rows[0];
  if (!row) throw new HubSignInError("expired", "that sign-in took too long or was already used; try again");
  return { verifier: row.code_verifier, linkUserId: row.link_user_id };
}

export interface HubIdentity {
  /** The person's Pomeroy Account id. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/** Swaps the one-time code for the hub's token and checks it. */
export async function redeemHubCode(
  hub: HubOptions & { clientId: string; clientSecret: string }, appUrl: string, code: string, verifier: string,
): Promise<HubIdentity> {
  const doFetch = hub.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${hub.url}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code", code, redirect_uri: `${appUrl}${HUB_CALLBACK_PATH}`, code_verifier: verifier,
        client_id: hub.clientId, client_secret: hub.clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new HubSignInError("unreachable", `Pomeroy Account didn't answer: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { id_token?: unknown; error?: unknown };
  if (!res.ok || typeof body.id_token !== "string") {
    throw new HubSignInError("refused", `Pomeroy Account refused the sign-in (${typeof body.error === "string" ? body.error : res.status})`);
  }
  return verifyHubToken(hub, body.id_token);
}

let jwksCache: { url: string; at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;

async function hubKey(hub: HubOptions, kid: string, now: number): Promise<JsonWebKey | null> {
  const url = `${hub.url}/.well-known/jwks.json`;
  const find = () => jwksCache?.url === url ? jwksCache.keys.find((k) => k.kid === kid) ?? null : null;
  // A key we haven't seen (the hub made a new one) fetches the list again.
  if (find() && now - jwksCache!.at < JWKS_CACHE_MS) return find();
  const res = await (hub.fetch ?? fetch)(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new HubSignInError("unreachable", `Pomeroy Account's signing key isn't available (${res.status})`);
  const body = (await res.json()) as { keys?: unknown };
  jwksCache = { url, at: now, keys: Array.isArray(body.keys) ? body.keys : [] };
  return find();
}

/** Checks an ES256 token from the hub: its key, issuer, audience and time. */
export async function verifyHubToken(hub: HubOptions & { clientId: string }, token: string): Promise<HubIdentity> {
  const bad = (why: string) => new HubSignInError("bad_token", `Pomeroy Account's answer couldn't be trusted (${why})`);
  const parts = token.split(".");
  if (parts.length !== 3) throw bad("not a token");
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: unknown; kid?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    throw bad("unreadable");
  }
  if (header.alg !== "ES256" || typeof header.kid !== "string") throw bad("signing method");
  const nowMs = (hub.now ?? Date.now)();
  const jwk = await hubKey(hub, header.kid, nowMs);
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") throw bad("unknown key");
  const ok = verifySig("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  if (!ok) throw bad("signature");
  const now = Math.floor(nowMs / 1000);
  const aud = claims.aud;
  if (typeof claims.iss !== "string" || claims.iss.replace(/\/+$/, "") !== hub.url) throw bad("issuer");
  if (!(aud === hub.clientId || (Array.isArray(aud) && aud.includes(hub.clientId)))) throw bad("audience");
  if (typeof claims.exp !== "number" || claims.exp < now - SKEW_SECONDS) throw bad("expired");
  if (typeof claims.nbf === "number" && claims.nbf > now + SKEW_SECONDS) throw bad("not yet valid");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 100) throw bad("person");
  if (typeof claims.email !== "string" || !claims.email.includes("@")) throw bad("email");
  return {
    sub: claims.sub,
    email: claims.email.trim().toLowerCase(),
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === "string" ? claims.name : undefined,
  };
}

/**
 * Connects a TrailBook person to a Pomeroy Account. Refused when either is
 * already connected to someone else.
 */
export async function connectHubAccount(db: { query: pg.Pool["query"] }, userId: string, hubUserId: string): Promise<void> {
  const taken = (await db.query("SELECT id FROM users WHERE hub_user_id = $1 AND id <> $2", [hubUserId, userId])).rows[0];
  if (taken) throw new HubSignInError("taken", "that Pomeroy Account is already connected to another TrailBook login");
  const r = await db.query(
    `UPDATE users SET hub_user_id = $2, hub_linked_at = coalesce(hub_linked_at, now())
      WHERE id = $1 AND (hub_user_id IS NULL OR hub_user_id = $2)`,
    [userId, hubUserId],
  );
  if (!r.rowCount) throw new HubSignInError("taken", "this TrailBook login is already connected to a different Pomeroy Account");
}
