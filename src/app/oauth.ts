import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { withSystem, type Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import type { Role } from "../core/ledger.js";

// TrailBook as an OAuth 2.0 provider (authorization code with refresh
// tokens), so another app can be connected to one business: MilePost first.
//
// An owner or admin approves the app for one business on TrailBook's own
// consent page, after signing in the usual way (with two-factor where it is
// on). The app gets a code, swaps it for an access token (an hour) and a
// refresh token, and calls the /api/v1 endpoints with the access token. Only
// SHA-256 hashes of codes and tokens are stored. Each refresh token works
// once; presenting a spent one again revokes the whole grant, since it means
// the token was copied. A grant only works while the person who approved it
// is still an owner or admin of the organisation, and, if the organisation
// requires two-factor sign-in, still has it on.

export interface OAuthClient {
  id: string;
  /** Which app this is ("milepost"): the source recorded on the customers and invoices it sends. */
  app: string;
  /** The client secret, as configured on the server. */
  secret: string;
  name: string;
  /** The only addresses a code may be sent to, compared exactly. */
  redirectUris: string[];
  /** The app's own address, for the "Open" button. */
  homeUrl?: string;
}

/** What an app may ask for, and how the consent page describes it. */
export const SCOPES: Record<string, string> = {
  "company:read": "See this business's name, currency and whether its TrailBook subscription is active",
  "customers:write": "Find, add and update customers (name, email and phone)",
  "invoices:write": "Issue invoices to customers; each one posts to your books as soon as it is created",
  "invoices:read": "See the invoices it created, with what has been paid",
};

export const ACCESS_SECONDS = 3600;
const REFRESH_DAYS = 90;
const CODE_SECONDS = 600;

/** Who can connect an app to a business. */
export const CAN_CONNECT: Role[] = ["owner", "admin"];

export class OAuthError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
  }
}

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;

function sameSecret(given: string, expected: string): boolean {
  // Hashing first makes the lengths equal, so the comparison takes the same time either way.
  return timingSafeEqual(Buffer.from(hash(given)), Buffer.from(hash(expected)));
}

/** The registered client, or an error the consent page shows without redirecting anywhere. */
export function findClient(clients: OAuthClient[], clientId: unknown, redirectUri?: unknown): OAuthClient {
  const client = clients.find((c) => c.id === clientId);
  if (!client) throw new OAuthError("invalid_client", "that app isn't registered with TrailBook");
  if (redirectUri !== undefined && !client.redirectUris.includes(String(redirectUri))) {
    throw new OAuthError("invalid_request", "that app asked to return to an address TrailBook doesn't know, so the request was stopped");
  }
  return client;
}

export function parseScopes(raw: unknown): string[] {
  const asked = String(raw ?? "").split(/[\s,]+/).filter(Boolean);
  const scopes = [...new Set(asked)];
  if (!scopes.length) throw new OAuthError("invalid_scope", "the app didn't say what it needs access to");
  const unknown = scopes.filter((s) => !SCOPES[s]);
  if (unknown.length) throw new OAuthError("invalid_scope", `unknown scope: ${unknown.join(", ")}`);
  return scopes;
}

/** Where the person goes back to the app, with the result in the query. */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** The consent was given: a code for the app, good for ten minutes and one use. */
export async function issueCode(
  pool: pg.Pool,
  input: { client: OAuthClient; orgId: string; entityId: string; userId: string; role: Role; redirectUri: string; scopes: string[] },
): Promise<string> {
  if (!CAN_CONNECT.includes(input.role)) throw new OAuthError("access_denied", "only an owner or admin can connect an app to a business", 403);
  const code = token("tb_code");
  await pool.query(
    `INSERT INTO oauth_codes (code_hash, client_id, org_id, entity_id, user_id, redirect_uri, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
    [hash(code), input.client.id, input.orgId, input.entityId, input.userId, input.redirectUri, input.scopes, CODE_SECONDS],
  );
  return code;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "Bearer";
  scope: string;
  company_id: string;
}

async function issueTokens(tx: Tx, grantId: string, scopes: string[], entityId: string): Promise<TokenResponse> {
  const access = token("tb_at");
  const refresh = token("tb_rt");
  await tx.query(
    `INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at) VALUES
       ($1, $3, 'access', now() + make_interval(secs => $4)), ($2, $3, 'refresh', now() + make_interval(days => $5))`,
    [hash(access), hash(refresh), grantId, ACCESS_SECONDS, REFRESH_DAYS],
  );
  // Expired tokens are no use to anyone. Spent refresh tokens stay until then, so a replay is recognised.
  await tx.query("DELETE FROM oauth_tokens WHERE grant_id = $1 AND expires_at < now()", [grantId]);
  return { access_token: access, refresh_token: refresh, expires_in: ACCESS_SECONDS, token_type: "Bearer", scope: scopes.join(" "), company_id: entityId };
}

async function revokeGrantTx(tx: Tx, grantId: string, by: string, reason: string): Promise<boolean> {
  const { rows } = await tx.query(
    "UPDATE oauth_grants SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING org_id, entity_id, client_id",
    [grantId, by],
  );
  if (!rows[0]) return false;
  await tx.query("DELETE FROM oauth_tokens WHERE grant_id = $1", [grantId]);
  await appendAudit(tx, {
    orgId: rows[0].org_id, entityId: rows[0].entity_id, actor: by, action: "app.disconnected",
    objectType: "oauth_grant", objectId: grantId, after: { app: rows[0].client_id, reason },
  });
  return true;
}

/** Client authentication from an HTTP Basic header (or, as RFC 6749 also allows, the form body). */
export function authenticateClient(clients: OAuthClient[], authorization: string | null, form: URLSearchParams): OAuthClient {
  let id = form.get("client_id") ?? "";
  let secret = form.get("client_secret") ?? "";
  const basic = /^Basic\s+(.+)$/i.exec(authorization ?? "");
  if (basic) {
    const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i < 0) throw new OAuthError("invalid_client", "client authentication failed", 401);
    id = decodeURIComponent(decoded.slice(0, i));
    secret = decodeURIComponent(decoded.slice(i + 1));
  }
  const client = clients.find((c) => c.id === id);
  if (!client || !secret || !sameSecret(secret, client.secret)) throw new OAuthError("invalid_client", "client authentication failed", 401);
  return client;
}

/** An error returned (not thrown) from a transaction, so what it revoked is committed first. */
function settle(out: TokenResponse | OAuthError): TokenResponse {
  if (out instanceof OAuthError) throw out;
  return out;
}

/** POST /oauth/token: a code or a refresh token in, a fresh pair of tokens out. */
export async function exchangeToken(pool: pg.Pool, client: OAuthClient, form: URLSearchParams): Promise<TokenResponse> {
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    return settle(await withSystem(pool, async (tx): Promise<TokenResponse | OAuthError> => {
      const c = (await tx.query("SELECT * FROM oauth_codes WHERE code_hash = $1 FOR UPDATE", [hash(code)])).rows[0];
      if (!c || c.client_id !== client.id) throw new OAuthError("invalid_grant", "that code isn't valid");
      if (c.used_at) {
        // A code used twice was intercepted somewhere: what it bought is revoked too.
        const g = (await tx.query("SELECT id FROM oauth_grants WHERE code_hash = $1", [c.code_hash])).rows[0];
        if (g) await revokeGrantTx(tx, g.id, `app:${client.id}`, "authorization code used twice");
        return new OAuthError("invalid_grant", "that code was already used");
      }
      if (new Date(c.expires_at) < new Date()) throw new OAuthError("invalid_grant", "that code has expired; connect again");
      if (form.get("redirect_uri") !== c.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri doesn't match the one the code was issued for");
      await tx.query("UPDATE oauth_codes SET used_at = now() WHERE code_hash = $1", [c.code_hash]);
      await tx.query("DELETE FROM oauth_codes WHERE expires_at < now() - interval '1 day'");
      // Approving again replaces the earlier connection for this business.
      const old = (await tx.query("SELECT id FROM oauth_grants WHERE entity_id = $1 AND client_id = $2 AND revoked_at IS NULL", [c.entity_id, client.id])).rows[0];
      const email = (await tx.query("SELECT email FROM users WHERE id = $1", [c.user_id])).rows[0]?.email;
      if (old) await revokeGrantTx(tx, old.id, `user:${email}`, "replaced by a new connection");
      const grant = (await tx.query(
        `INSERT INTO oauth_grants (client_id, org_id, entity_id, user_id, scopes, code_hash, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [client.id, c.org_id, c.entity_id, c.user_id, c.scopes, c.code_hash, JSON.stringify({ taxCategory: "professional_service" })],
      )).rows[0];
      await appendAudit(tx, {
        orgId: c.org_id, entityId: c.entity_id, actor: `user:${email}`, action: "app.connected",
        objectType: "oauth_grant", objectId: grant.id, after: { app: client.id, name: client.name, scopes: c.scopes },
      });
      return issueTokens(tx, grant.id, c.scopes, c.entity_id);
    }));
  }
  if (grantType === "refresh_token") {
    const refresh = form.get("refresh_token") ?? "";
    return settle(await withSystem(pool, async (tx): Promise<TokenResponse | OAuthError> => {
      const t = (await tx.query(
        `SELECT t.*, g.client_id, g.scopes, g.entity_id, g.revoked_at FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
          WHERE t.token_hash = $1 AND t.kind = 'refresh' FOR UPDATE OF t`,
        [hash(refresh)],
      )).rows[0];
      if (!t || t.client_id !== client.id || t.revoked_at) throw new OAuthError("invalid_grant", "that refresh token isn't valid; connect again");
      if (t.used_at) {
        await revokeGrantTx(tx, t.grant_id, `app:${client.id}`, "refresh token used twice");
        return new OAuthError("invalid_grant", "that refresh token was already used, so the connection was closed to be safe; connect again");
      }
      if (new Date(t.expires_at) < new Date()) throw new OAuthError("invalid_grant", "the connection expired; connect again");
      await tx.query("UPDATE oauth_tokens SET used_at = now() WHERE token_hash = $1", [t.token_hash]);
      return issueTokens(tx, t.grant_id, t.scopes, t.entity_id);
    }));
  }
  throw new OAuthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
}

/** POST /oauth/revoke: the app disconnects itself. Unknown tokens are fine (RFC 7009). */
export async function revokeToken(pool: pg.Pool, client: OAuthClient, tokenValue: string): Promise<void> {
  if (!tokenValue) return;
  await withSystem(pool, async (tx) => {
    const t = (await tx.query(
      "SELECT t.grant_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.token_hash = $1 AND g.client_id = $2",
      [hash(tokenValue), client.id],
    )).rows[0];
    if (t) await revokeGrantTx(tx, t.grant_id, `app:${client.id}`, "the app disconnected");
  });
}

/** An owner or admin disconnects an app from TrailBook's side. */
export async function revokeGrant(pool: pg.Pool, input: { grantId: string; orgId: string; entityId: string; actor: string }): Promise<boolean> {
  return withSystem(pool, async (tx) => {
    const g = (await tx.query("SELECT 1 FROM oauth_grants WHERE id = $1 AND org_id = $2 AND entity_id = $3", [input.grantId, input.orgId, input.entityId])).rows[0];
    if (!g) return false;
    return revokeGrantTx(tx, input.grantId, input.actor, "disconnected in TrailBook");
  });
}

export interface Grant {
  id: string;
  clientId: string;
  orgId: string;
  entityId: string;
  userId: string;
  scopes: string[];
  settings: Record<string, any>;
}

/**
 * Resolves "Authorization: Bearer tb_at_..." to its grant, checking the
 * approver may still connect apps to this business.
 */
export async function authenticateBearer(pool: pg.Pool, authorization: string | null): Promise<Grant> {
  const m = /^Bearer\s+(tb_at_[A-Za-z0-9_-]+)$/i.exec(authorization ?? "");
  if (!m) throw new OAuthError("invalid_token", "send an access token as Authorization: Bearer", 401);
  const { rows } = await pool.query(
    `SELECT g.id, g.client_id, g.org_id, g.entity_id, g.user_id, g.scopes, g.settings, t.expires_at,
            m.role, o.require_mfa, u.totp_enabled_at IS NOT NULL AS has_mfa
       FROM oauth_tokens t
       JOIN oauth_grants g ON g.id = t.grant_id AND g.revoked_at IS NULL
       JOIN organizations o ON o.id = g.org_id
       JOIN users u ON u.id = g.user_id
       LEFT JOIN memberships m ON m.user_id = g.user_id AND m.org_id = g.org_id
      WHERE t.token_hash = $1 AND t.kind = 'access'`,
    [hash(m[1]!)],
  );
  const r = rows[0];
  if (!r || new Date(r.expires_at) < new Date()) throw new OAuthError("invalid_token", "the access token is invalid or has expired", 401);
  if (!CAN_CONNECT.includes(r.role)) {
    throw new OAuthError("invalid_token", "the person who connected this app is no longer an owner or admin of the business; connect again", 401);
  }
  if (r.require_mfa && !r.has_mfa) {
    throw new OAuthError("invalid_token", "the business requires two-factor sign-in and the person who connected this app has it off", 401);
  }
  await pool.query("UPDATE oauth_grants SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')", [r.id]);
  return { id: r.id, clientId: r.client_id, orgId: r.org_id, entityId: r.entity_id, userId: r.user_id, scopes: r.scopes, settings: r.settings };
}

/** The apps connected to a business, for its Integrations page. */
export async function listGrants(pool: pg.Pool, orgId: string, entityId: string) {
  const { rows } = await pool.query(
    `SELECT g.id, g.client_id, g.scopes, g.settings, g.created_at, g.last_used_at, u.email AS approved_by
       FROM oauth_grants g JOIN users u ON u.id = g.user_id
      WHERE g.org_id = $1 AND g.entity_id = $2 AND g.revoked_at IS NULL ORDER BY g.created_at`,
    [orgId, entityId],
  );
  return rows.map((r) => ({
    id: r.id as string, clientId: r.client_id as string, scopes: r.scopes as string[], settings: r.settings as Record<string, any>,
    createdAt: r.created_at, lastUsedAt: r.last_used_at, approvedBy: r.approved_by as string,
  }));
}

export async function updateGrantSettings(pool: pg.Pool, input: { grantId: string; orgId: string; entityId: string; settings: Record<string, unknown>; actor: string }) {
  return withSystem(pool, async (tx) => {
    const { rows } = await tx.query(
      `UPDATE oauth_grants SET settings = settings || $4::jsonb
        WHERE id = $1 AND org_id = $2 AND entity_id = $3 AND revoked_at IS NULL RETURNING settings`,
      [input.grantId, input.orgId, input.entityId, JSON.stringify(input.settings)],
    );
    if (!rows[0]) return null;
    await appendAudit(tx, {
      orgId: input.orgId, entityId: input.entityId, actor: input.actor, action: "app.settings_changed",
      objectType: "oauth_grant", objectId: input.grantId, after: input.settings,
    });
    return rows[0].settings as Record<string, unknown>;
  });
}

/** Clients from the server's settings. Without an ID and secret, the app can't connect. */
export function oauthClientsFromEnv(env: Record<string, string | undefined> = process.env): OAuthClient[] {
  const clients: OAuthClient[] = [];
  if (env.MILEPOST_OAUTH_CLIENT_ID && env.MILEPOST_OAUTH_CLIENT_SECRET) {
    const home = (env.MILEPOST_URL || "https://crm.pomeroyagency.com").replace(/\/+$/, "");
    clients.push({
      id: env.MILEPOST_OAUTH_CLIENT_ID,
      app: "milepost",
      secret: env.MILEPOST_OAUTH_CLIENT_SECRET,
      name: "MilePost",
      redirectUris: (env.MILEPOST_OAUTH_REDIRECT_URIS || `${home}/api/integrations/trailbook/callback`).split(",").map((s) => s.trim()).filter(Boolean),
      homeUrl: home,
    });
  }
  return clients;
}
