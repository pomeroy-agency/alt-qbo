import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { withSystem, type Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { endAllSessions } from "./auth.js";
import { pacificToday } from "../payroll/business-days.js";
import { BillingError, accessFor, clearComp, compActive, peoplePaid, setComp, type BillingConfig } from "../billing/billing.js";
import { addDays, type Plan } from "../billing/plans.js";

// The Pomeroy account hub (account.pomeroyagency.com) keeps one list of what
// each business has paid for. TrailBook stays its own billing engine, so it
// tells the hub where each organisation stands:
//
// - a signed POST to the hub's /api/trailbook/status whenever that changes,
//   from a billing action in the app or from the daily billing run, which
//   also catches changes that happen by date (a trial or grace period ending);
// - a signed GET /api/hub/status here, which the hub's nightly check reads;
// - a signed POST /api/hub/comp here, which sets or ends a complimentary
//   period: dated (The Install, 12 months) or open-ended (the agency plans,
//   until the hub ends it);
// - a signed POST /api/hub/entitlements-changed here, when what an
//   organisation holds at the hub changes. TrailBook records the hub's access
//   version and answers with its own status; its memberships and billing
//   still decide access on every request;
// - a signed POST /api/hub/signout here, the hub's back-channel sign-out,
//   which ends every TrailBook session the person has.
//
// Every request either way carries `x-pomeroy-signature: t=<unix seconds>,v1=<hex>`,
// an HMAC-SHA256 with the shared ACCOUNT_HUB_SECRET over "<t>.<payload>",
// where the payload is the JSON body, or "GET <path and query>" for a GET.
// A signature more than five minutes old is refused, so a captured request
// can't be replayed later.
//
// What the hub learns: the organisation's and its businesses' names, plan,
// access, people paid this month, and where the first business is based.
// Never employees, pay, bank or card details, or anyone's email address.

export interface HubOptions {
  /** The hub's address, like https://account.pomeroyagency.com. */
  url: string;
  /** Shared with the hub; at least 32 characters. */
  secret: string;
  /** For tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

export const SIGNATURE_HEADER = "x-pomeroy-signature";
const MAX_SKEW_SECONDS = 300;
/** After a subscription ends, its books stay readable this long (Terms, section 10). */
const READ_ONLY_YEARS = 7;

export function hubFromEnv(env: Record<string, string | undefined> = process.env): HubOptions | undefined {
  const url = env.ACCOUNT_HUB_URL?.trim();
  const secret = env.ACCOUNT_HUB_SECRET?.trim();
  if (!url || !secret) return undefined;
  if (secret.length < 32) {
    console.error("ACCOUNT_HUB_SECRET is shorter than 32 characters; the account hub link is off");
    return undefined;
  }
  return { url: url.replace(/\/+$/, ""), secret };
}

const nowSeconds = (hub: HubOptions) => Math.floor((hub.now ?? Date.now)() / 1000);

function hmac(secret: string, t: number, payload: string): string {
  return createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
}

export function signPayload(hub: HubOptions, payload: string): string {
  const t = nowSeconds(hub);
  return `t=${t},v1=${hmac(hub.secret, t, payload)}`;
}

export function verifySignature(hub: HubOptions, header: string | null, payload: string): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowSeconds(hub) - t) > MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(hmac(hub.secret, t, payload), "hex");
  return timingSafeEqual(expected, Buffer.from(m[2]!, "hex"));
}

// ------------------------------------------------------------------ status

export type HubAccess = "full" | "grace" | "read_only" | "ended";

export interface TrailBookStatus {
  trailbook_org_id: string;
  name: string;
  kind: string;
  business_names: string[];
  /** Includes the first business. */
  businesses: number;
  plan_key: "trailbook_books" | "trailbook_books_payroll";
  /** TrailBook's own subscription status. "not_started" until the organisation first makes a change. "free" for TrailBook's own books. */
  status: string;
  access: HubAccess;
  trial_ends_on: string | null;
  period_end: string | null;
  /** Whether a complimentary period covers today. */
  comped: boolean;
  /** Its last day while comped; null while comped means open-ended (until the hub ends it). */
  comp_until: string | null;
  comp_reason: string | null;
  /** Different people paid in posted pay runs so far this calendar month. */
  people: number;
  /** Where the first business is based. */
  country: string | null;
  region_code: string | null;
}

const PLAN_KEYS: Record<Plan, TrailBookStatus["plan_key"]> = { books: "trailbook_books", books_payroll: "trailbook_books_payroll" };

/** The plan a hub plan_key names, or null. */
function planFromKey(key: unknown): Plan | null {
  return key === "trailbook_books" ? "books" : key === "trailbook_books_payroll" ? "books_payroll" : null;
}

/** Practice organisations never reach the hub; TrailBook's own books do, as free. */
function isExample(orgId: string, name: string, cfg: BillingConfig): boolean {
  return cfg.seller?.orgId !== orgId && (cfg.freeOrgNames ?? []).includes(name);
}

/** One organisation's status as the hub sees it, or null for a practice organisation or one that doesn't exist. */
export async function orgStatus(tx: Tx, orgId: string, cfg: BillingConfig, today: string): Promise<TrailBookStatus | null> {
  const org = (await tx.query("SELECT id, name, kind FROM organizations WHERE id = $1", [orgId])).rows[0];
  if (!org || isExample(orgId, org.name, cfg)) return null;
  const ents = (await tx.query("SELECT legal_name, country, region FROM entities WHERE org_id = $1 ORDER BY created_at, id", [orgId])).rows;
  // Reading never starts a trial: an organisation that hasn't made a change yet has no subscription row.
  const sub = (await tx.query("SELECT * FROM subscriptions WHERE org_id = $1", [orgId])).rows[0];
  const people = await peoplePaid(tx, orgId, `${today.slice(0, 8)}01`, today);
  const base = {
    trailbook_org_id: org.id as string, name: org.name as string, kind: org.kind as string,
    business_names: ents.map((e) => e.legal_name as string), businesses: ents.length, people,
    country: (ents[0]?.country as string | undefined)?.trim() ?? null, region_code: (ents[0]?.region as string | null | undefined) ?? null,
  };
  if (cfg.seller?.orgId === orgId) {
    return { ...base, plan_key: "trailbook_books_payroll", status: "free", access: "full", trial_ends_on: null, period_end: null, comped: false, comp_until: null, comp_reason: null };
  }
  if (!sub) {
    return { ...base, plan_key: "trailbook_books", status: "not_started", access: "full", trial_ends_on: null, period_end: null, comped: false, comp_until: null, comp_reason: null };
  }
  const a = accessFor(sub, today);
  let access: HubAccess = a.level === "read_only" ? "read_only" : a.warning ? "grace" : "full";
  if (access === "read_only") {
    // The last paid day, or the day a trial was cancelled.
    const ended = sub.status === "canceled" ? (sub.period_end ?? (sub.canceled_at ? new Date(sub.canceled_at).toISOString().slice(0, 10) : null)) : null;
    if (ended && addDays(ended, READ_ONLY_YEARS * 365 + 2) < today) access = "ended";
  }
  const comped = compActive(sub, today);
  return {
    ...base, plan_key: PLAN_KEYS[sub.plan as Plan], status: sub.status, access,
    // An open-ended comp's internal trial end is never shown.
    trial_ends_on: sub.status === "trialing" && !(comped && !sub.comp_until) ? sub.trial_ends_on : null, period_end: sub.period_end,
    comped, comp_until: comped ? sub.comp_until : null, comp_reason: comped ? sub.comp_reason : null,
  };
}

const hashOf = (s: TrailBookStatus) => createHash("sha256").update(JSON.stringify(s)).digest("hex");

export type PushResult = "sent" | "unchanged" | "failed" | "skipped";

/** Sends one organisation's status to the hub if it changed since the hub last accepted one. */
export async function pushStatus(pool: pg.Pool, hub: HubOptions, cfg: BillingConfig, orgId: string, today = pacificToday()): Promise<PushResult> {
  const status = await withSystem(pool, (tx) => orgStatus(tx, orgId, cfg, today));
  if (!status) return "skipped";
  const hash = hashOf(status);
  const last = (await pool.query("SELECT payload_hash FROM hub_pushes WHERE org_id = $1", [orgId])).rows[0]?.payload_hash;
  if (last === hash) return "unchanged";
  const body = JSON.stringify({ ...status, reported_at: new Date((hub.now ?? Date.now)()).toISOString() });
  let error: string | null = null;
  try {
    const res = await (hub.fetch ?? fetch)(`${hub.url}/api/trailbook/status`, {
      method: "POST",
      headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signPayload(hub, body) },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) error = `the hub answered ${res.status}`;
  } catch (err) {
    error = `the hub didn't answer: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (error) {
    // The last accepted status is kept, so the next run tries again.
    await pool.query(
      `INSERT INTO hub_pushes (org_id, last_error, last_error_at) VALUES ($1, $2, now())
       ON CONFLICT (org_id) DO UPDATE SET last_error = $2, last_error_at = now()`,
      [orgId, error],
    );
    console.error(`account hub: status for ${orgId} not sent: ${error}`);
    return "failed";
  }
  await pool.query(
    `INSERT INTO hub_pushes (org_id, payload_hash, pushed_at) VALUES ($1, $2, now())
     ON CONFLICT (org_id) DO UPDATE SET payload_hash = $2, pushed_at = now(), last_error = NULL, last_error_at = NULL`,
    [orgId, hash],
  );
  return "sent";
}

/** Never lets a hub problem fail the billing action that came before it. */
export async function pushStatusQuietly(pool: pg.Pool, hub: HubOptions | undefined, cfg: BillingConfig, orgId: string): Promise<void> {
  if (!hub) return;
  try {
    await pushStatus(pool, hub, cfg, orgId);
  } catch (err) {
    console.error("account hub: status push failed", err);
  }
}

export interface PushRunResult { sent: number; unchanged: number; failed: number }

/** Sends every organisation whose status changed: the daily run, which also catches changes that happen by date. */
export async function pushChanged(pool: pg.Pool, hub: HubOptions, cfg: BillingConfig, today = pacificToday()): Promise<PushRunResult> {
  const out: PushRunResult = { sent: 0, unchanged: 0, failed: 0 };
  const orgs = (await pool.query("SELECT id FROM organizations ORDER BY created_at, id")).rows.map((r) => r.id as string);
  for (const orgId of orgs) {
    const r = await pushStatus(pool, hub, cfg, orgId, today);
    if (r === "sent") out.sent++;
    else if (r === "failed") out.failed++;
    else if (r === "unchanged") out.unchanged++;
  }
  return out;
}

// ------------------------------------------------------- requests from the hub

export interface HubRouteOptions {
  hub?: HubOptions;
  billing?: BillingConfig;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** /api/hub/status and /api/hub/comp. Null when the path isn't one of them. */
export async function handleHub(req: Request, path: string, pool: pg.Pool, opts: HubRouteOptions): Promise<Response | null> {
  if (!path.startsWith("/api/hub/")) return null;
  const hub = opts.hub;
  if (!hub) return fail(503, "not_configured", "the account hub link isn't switched on");
  const cfg = opts.billing ?? {};
  const url = new URL(req.url);
  const today = pacificToday();

  if (req.method === "GET" && path === "/api/hub/status") {
    if (!verifySignature(hub, req.headers.get(SIGNATURE_HEADER), `GET ${url.pathname}${url.search}`)) return fail(401, "bad_signature", "the request isn't signed by the account hub");
    const one = url.searchParams.get("org");
    if (one !== null) {
      if (!UUID.test(one)) return fail(404, "not_found", "no such TrailBook organisation");
      const s = await withSystem(pool, (tx) => orgStatus(tx, one, cfg, today));
      return s ? json({ org: s }) : fail(404, "not_found", "no such TrailBook organisation");
    }
    const orgs = await withSystem(pool, async (tx) => {
      const ids = (await tx.query("SELECT id FROM organizations ORDER BY created_at, id")).rows.map((r) => r.id as string);
      const out: TrailBookStatus[] = [];
      for (const id of ids) {
        const s = await orgStatus(tx, id, cfg, today);
        if (s) out.push(s);
      }
      return out;
    });
    return json({ generated_at: new Date().toISOString(), orgs });
  }

  if (req.method !== "POST") return fail(404, "not_found", "no such account hub endpoint");
  const raw = await req.text();
  if (!verifySignature(hub, req.headers.get(SIGNATURE_HEADER), raw)) return fail(401, "bad_signature", "the request isn't signed by the account hub");
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
  } catch {
    return fail(400, "invalid", "the body isn't a JSON object");
  }

  if (path === "/api/hub/entitlements-changed") {
    const orgId = typeof b.trailbook_org_id === "string" && UUID.test(b.trailbook_org_id) ? b.trailbook_org_id : null;
    if (!orgId) return fail(404, "not_found", "no such TrailBook organisation");
    const version = b.ent_version;
    if (!Number.isSafeInteger(version) || (version as number) < 1) return fail(400, "invalid", "ent_version is a whole number from 1");
    const hubOrg = typeof b.org_id === "string" && b.org_id.length >= 1 && b.org_id.length <= 100 ? b.org_id : null;
    const status = await withSystem(pool, (tx) => orgStatus(tx, orgId, cfg, today));
    if (!status) return fail(404, "not_found", "no such TrailBook organisation");
    // A notice that arrives after a newer one is kept out, so the version only goes up.
    await pool.query(
      `INSERT INTO hub_pushes (org_id, hub_org_id, ent_version, ent_changed_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (org_id) DO UPDATE SET hub_org_id = coalesce($2, hub_pushes.hub_org_id), ent_version = $3, ent_changed_at = now()
        WHERE hub_pushes.ent_version IS NULL OR hub_pushes.ent_version < $3`,
      [orgId, hubOrg, version],
    );
    return json({ ok: true, org: status });
  }

  if (path === "/api/hub/signout") {
    const userId = typeof b.trailbook_user_id === "string" && UUID.test(b.trailbook_user_id) ? b.trailbook_user_id : null;
    const email = typeof b.email === "string" && b.email.length <= 320 ? b.email.trim().toLowerCase() : null;
    if (!userId && !email) return fail(400, "invalid", "send trailbook_user_id or email");
    const user = (await pool.query(
      "SELECT id FROM users WHERE ($1::uuid IS NOT NULL AND id = $1::uuid) OR ($1::uuid IS NULL AND email = $2)",
      [userId, email],
    )).rows[0];
    // Someone with no TrailBook account has nothing to sign out of.
    const ended = user ? await endAllSessions(pool, user.id) : 0;
    return json({ ok: true, sessions_ended: ended });
  }

  if (path === "/api/hub/comp") {
    const orgId = typeof b.trailbook_org_id === "string" && UUID.test(b.trailbook_org_id) ? b.trailbook_org_id : null;
    if (!orgId) return fail(404, "not_found", "no such TrailBook organisation");
    try {
      const status = await withSystem(pool, async (tx) => {
        const before = await orgStatus(tx, orgId, cfg, today);
        if (!before) throw new BillingError("no such TrailBook organisation", 404);
        if (before.status === "free") throw new BillingError("TrailBook's own books are always free", 409);
        if (typeof b.comped !== "boolean") throw new BillingError("comped is true (set) or false (end today)");
        if (!b.comped) {
          await clearComp(tx, orgId, today);
        } else {
          const plan = planFromKey(b.plan_key);
          if (!plan) throw new BillingError("plan_key is trailbook_books or trailbook_books_payroll");
          await setComp(tx, orgId, today, { until: b.comp_until ?? null, reason: b.reason, plan });
        }
        const after = await orgStatus(tx, orgId, cfg, today);
        await appendAudit(tx, {
          orgId, actor: "app:account-hub", action: b.comped ? "billing.comp_set" : "billing.comp_ended",
          objectType: "organization", objectId: orgId,
          before: { comped: before.comped, comp_until: before.comp_until, comp_reason: before.comp_reason, plan_key: before.plan_key },
          after: { comped: after!.comped, comp_until: after!.comp_until, comp_reason: after!.comp_reason, plan_key: after!.plan_key },
        });
        return after!;
      });
      await pushStatusQuietly(pool, hub, cfg, orgId);
      return json({ org: status });
    } catch (err) {
      if (err instanceof BillingError) return fail(err.status, err.status === 404 ? "not_found" : err.status === 409 ? "conflict" : "invalid", err.message);
      throw err;
    }
  }
  return fail(404, "not_found", "no such account hub endpoint");
}
