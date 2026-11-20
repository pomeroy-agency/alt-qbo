import { createHash, randomInt } from "node:crypto";
import type pg from "pg";
import { withSystem } from "../db/pool.js";

// Tells Google and Meta when someone who came from pomeroyagency.com signs up
// for TrailBook, and when that organisation first pays, so ads can be
// measured on real customers instead of button clicks. Sent from the server
// only: the app itself loads no Google or Meta code.
//
// What goes out is the event (trial_start / StartTrial when an account is
// created, purchase / Subscribe on its first payment), the IDs the marketing
// site's own Google Analytics and Meta Pixel cookies already hold (they're set
// on .pomeroyagency.com, so they reach app.pomeroyagency.com too), the ad
// click ID, the IP address and browser, a hash of the user's ID and, to Meta
// only, a SHA-256 hash of the email (lowercased, trimmed). Never the email
// itself, a name, the business name or anything in the books.
//
// Sending never holds up a sign-up: the click IDs are saved with the new
// account first, then the two requests go out in the background (Netlify's
// waitUntil), with a 5 second limit, and a failure is only logged.
//
// Nobody is reported who opted out at sign-up or whose browser sends Global
// Privacy Control, and only organisations created after this shipped are ever
// reported. Without the keys below, nothing is sent at all.

export interface AdEventsConfig {
  metaPixelId: string;
  metaToken?: string;
  /** Meta's Test Events code, so a check shows up under Test Events instead of counting. */
  metaTestCode?: string;
  ga4MeasurementId: string;
  ga4ApiSecret?: string;
  /** Marks GA4 events debug_mode, so they show in GA4 DebugView. */
  ga4Debug?: boolean;
  fetch?: typeof fetch;
}

const envVal = (env: Record<string, string | undefined>, ...keys: string[]) => {
  for (const k of keys) { const v = env[k]?.trim(); if (v) return v; }
  return undefined;
};

/**
 * META_CAPI_TOKEN and GA4_API_SECRET switch each half on (META_CAPI_ACCESS_TOKEN,
 * the name first used, still works). META_CAPI_TEST_CODE sends Meta events as
 * Test Events and GA4_DEBUG_MODE=1 sends GA4 events to DebugView; remove both
 * after testing. The pixel and measurement IDs default to pomeroyagency.com's own.
 */
export function adEventsFromEnv(env: Record<string, string | undefined> = process.env): AdEventsConfig {
  return {
    metaPixelId: envVal(env, "META_PIXEL_ID") ?? "909707683290018",
    metaToken: envVal(env, "META_CAPI_TOKEN", "META_CAPI_ACCESS_TOKEN"),
    metaTestCode: envVal(env, "META_CAPI_TEST_CODE", "META_TEST_EVENT_CODE"),
    ga4MeasurementId: envVal(env, "GA4_MEASUREMENT_ID") ?? "G-CEMK8J8PTZ",
    ga4ApiSecret: envVal(env, "GA4_API_SECRET"),
    ga4Debug: /^(1|true|on)$/i.test(envVal(env, "GA4_DEBUG_MODE") ?? ""),
  };
}

const on = (cfg?: AdEventsConfig): cfg is AdEventsConfig => Boolean(cfg && (cfg.metaToken || cfg.ga4ApiSecret));

export interface Attribution {
  gaClientId?: string; gaSessionId?: string; fbp?: string; fbc?: string; gclid?: string;
  utmSource?: string; utmMedium?: string; utmCampaign?: string; utmTerm?: string; utmContent?: string;
  ip?: string; userAgent?: string; pageUrl?: string;
  /** Global Privacy Control, or the sign-up form's opt-out box. */
  optedOut: boolean;
}

function readCookie(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

// Values from the browser are only ever kept if they look like what they claim to be.
const clip = (v: unknown, re: RegExp, max = 200): string | undefined =>
  typeof v === "string" && v.length <= max && re.test(v) ? v : undefined;
const TOKEN = /^[\w.\-~]+$/;
const UTM = /^[\w .\-+~%|:/]+$/;

/** GA1.1.123456789.1690000000 → 123456789.1690000000 */
export function gaClientId(cookie?: string): string | undefined {
  const m = cookie && /^GA\d\.\d\.(\d+\.\d+)$/.exec(cookie);
  return m ? m[1] : undefined;
}

/** GS1.1.1690000000.3.1… or GS2.1.s1690000000$o3$g1… → 1690000000 */
export function gaSessionId(cookie?: string): string | undefined {
  const m = cookie && (/^GS1\.\d\.(\d+)\./.exec(cookie) ?? /^GS2\.\d\.s(\d+)/.exec(cookie));
  return m ? m[1] : undefined;
}

/** What the sign-up request carries: the site's cookies, and the landing page's click ID and UTMs the app kept. */
export function attributionFromRequest(req: Request, sent: unknown, optOutBox: unknown, ga4MeasurementId = "G-CEMK8J8PTZ"): Attribution {
  const cookies = req.headers.get("cookie") ?? "";
  const b = (sent && typeof sent === "object" ? sent : {}) as Record<string, unknown>;
  const gpc = req.headers.get("sec-gpc") === "1";
  const gclAw = readCookie(cookies, "_gcl_aw");
  const fbclid = clip(b.fbclid, TOKEN, 500);
  return {
    gaClientId: gaClientId(readCookie(cookies, "_ga")),
    gaSessionId: gaSessionId(readCookie(cookies, `_ga_${ga4MeasurementId.replace(/^G-/, "")}`)),
    fbp: clip(readCookie(cookies, "_fbp"), /^fb\.\d\.\d+\.\d+$/),
    fbc: clip(readCookie(cookies, "_fbc"), /^fb\.\d\.\d+\.[\w.\-~]+$/, 600) ?? (fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined),
    gclid: clip(b.gclid, TOKEN, 500) ?? clip(gclAw?.split(".").slice(2).join("."), TOKEN, 500),
    utmSource: clip(b.utm_source, UTM), utmMedium: clip(b.utm_medium, UTM), utmCampaign: clip(b.utm_campaign, UTM),
    utmTerm: clip(b.utm_term, UTM), utmContent: clip(b.utm_content, UTM),
    ip: (req.headers.get("x-nf-client-connection-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0])?.trim() || undefined,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) || undefined,
    pageUrl: clip(b.page, /^https:\/\/[\w.\-]+\.pomeroyagency\.com\/[^\s]*$/, 500),
    optedOut: gpc || optOutBox === true,
  };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Meta's normalisation for an email before hashing: trimmed, lowercased. */
export const hashEmail = (email: string) => sha256(email.trim().toLowerCase());
const TIMEOUT_MS = 5000;

interface Row {
  user_id: string; org_id: string; ga_client_id: string | null; ga_session_id: string | null; fbp: string | null; fbc: string | null;
  ip: string | null; user_agent: string | null; page_url: string | null;
}

interface AdEvent {
  meta: string; ga4: string; id: string;
  /** Meta custom_data beyond product. */
  custom?: Record<string, unknown>;
  /** GA4 params beyond product. */
  params?: Record<string, unknown>;
  emailHash?: string;
}

async function send(cfg: AdEventsConfig, row: Row, e: AdEvent) {
  const f = cfg.fetch ?? fetch;
  const now = Math.floor(Date.now() / 1000);
  const jobs: Promise<unknown>[] = [];
  if (cfg.metaToken) {
    const event = {
      event_name: e.meta, event_time: now, event_id: e.id, action_source: "website",
      event_source_url: row.page_url ?? "https://app.pomeroyagency.com/",
      user_data: {
        ...(e.emailHash && { em: [e.emailHash] }),
        external_id: [sha256(row.user_id)],
        ...(row.ip && { client_ip_address: row.ip }), ...(row.user_agent && { client_user_agent: row.user_agent }),
        ...(row.fbp && { fbp: row.fbp }), ...(row.fbc && { fbc: row.fbc }),
      },
      custom_data: { product: "trailbook", ...e.custom },
    };
    // The token goes in the body, not the address, so it stays out of logs.
    jobs.push(f(`https://graph.facebook.com/v21.0/${encodeURIComponent(cfg.metaPixelId)}/events`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ data: [event], access_token: cfg.metaToken, ...(cfg.metaTestCode && { test_event_code: cfg.metaTestCode }) }),
    }).then(async (r) => {
      // Logged, never shown: Meta's error bodies can echo the request.
      if (!r.ok) throw new Error(`Meta ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }));
  }
  if (cfg.ga4ApiSecret && row.ga_client_id) {
    jobs.push(f(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(cfg.ga4MeasurementId)}&api_secret=${encodeURIComponent(cfg.ga4ApiSecret)}`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        client_id: row.ga_client_id,
        events: [{ name: e.ga4, params: {
          ...(row.ga_session_id && { session_id: row.ga_session_id }), engagement_time_msec: 1, product: "trailbook", ...e.params,
          ...(cfg.ga4Debug && { debug_mode: true }),
        } }],
      }),
    }).then((r) => { if (!r.ok) throw new Error(`GA4 ${r.status}`); }));
  }
  for (const r of await Promise.allSettled(jobs)) if (r.status === "rejected") console.error(`ad events: ${e.ga4} not sent:`, String(r.reason).slice(0, 400));
}

/** Runs work after the response has gone (Netlify's context.waitUntil); tests pass a collector. */
export type Defer = (work: Promise<unknown>) => void;

/**
 * Keeps the sign-up's attribution for the organisation it created and, unless
 * the person opted out, reports the trial start: once per organisation, with
 * the organisation's ID as Meta's event_id. Only the database write is
 * awaited; the reports go to `defer`. Never throws: a failure here must not
 * stop anyone signing up.
 */
export async function recordSignup(
  pool: pg.Pool, cfg: AdEventsConfig | undefined, a: Attribution & { userId: string; orgId: string; email: string }, defer: Defer = () => {},
): Promise<void> {
  if (!on(cfg) || a.optedOut) return;
  try {
    // A visitor who never touched the marketing site has no _ga cookie; GA4 still counts the sign-up under a new ID.
    const gaClient = a.gaClientId ?? `${randomInt(1e9)}.${Math.floor(Date.now() / 1000)}`;
    const row = (await withSystem(pool, (tx) => tx.query(
      `INSERT INTO ad_attribution (user_id, org_id, ga_client_id, ga_session_id, fbp, fbc, gclid,
         utm_source, utm_medium, utm_campaign, utm_term, utm_content, ip, user_agent, page_url, signup_sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
       ON CONFLICT (org_id) DO NOTHING RETURNING *`,
      [a.userId, a.orgId, gaClient, a.gaSessionId ?? null, a.fbp ?? null, a.fbc ?? null, a.gclid ?? null,
        a.utmSource ?? null, a.utmMedium ?? null, a.utmCampaign ?? null, a.utmTerm ?? null, a.utmContent ?? null,
        a.ip ?? null, a.userAgent ?? null, a.pageUrl ?? null],
    ))).rows[0] as Row | undefined;
    // Identifiers of sign-ups that never paid are cleared after 120 days.
    await pool.query("UPDATE ad_attribution SET ip = NULL, user_agent = NULL, fbp = NULL, fbc = NULL, ga_session_id = NULL WHERE purchase_sent_at IS NULL AND created_at < now() - interval '120 days' AND ip IS NOT NULL");
    if (row) {
      defer(send(cfg, row, {
        meta: "StartTrial", ga4: "trial_start", id: a.orgId, emailHash: hashEmail(a.email),
        custom: { value: 0, currency: "USD" },
      }).catch((err) => console.error("ad events: trial_start not sent:", err)));
    }
  } catch (err) {
    console.error("ad events: sign-up not recorded:", err);
  }
}

/**
 * Reports an organisation's first payment, once, if its sign-up was recorded.
 * The IP, browser and cookie IDs are cleared once it's sent; nothing more is
 * ever reported for that organisation. Never throws.
 */
export async function recordFirstPayment(pool: pg.Pool, cfg: AdEventsConfig | undefined, p: { orgId: string; valueMinor: bigint; plan: string; invoice: string }): Promise<void> {
  if (!on(cfg)) return;
  try {
    const row = (await withSystem(pool, (tx) => tx.query(
      "UPDATE ad_attribution SET purchase_sent_at = now() WHERE org_id = $1 AND purchase_sent_at IS NULL RETURNING *", [p.orgId],
    ))).rows[0] as Row | undefined;
    if (!row) return;
    const value = Number(p.valueMinor) / 100;
    await send(cfg, row, {
      meta: "Subscribe", ga4: "purchase", id: `purchase:${p.orgId}`, custom: { value, currency: "USD" },
      params: { transaction_id: p.invoice, value, currency: "USD", items: [{ item_id: p.plan, item_name: `TrailBook ${p.plan}`, price: value, quantity: 1 }] },
    });
    await pool.query("UPDATE ad_attribution SET ip = NULL, user_agent = NULL, fbp = NULL, fbc = NULL, ga_session_id = NULL WHERE org_id = $1", [p.orgId]);
  } catch (err) {
    console.error("ad events: first payment not recorded:", err);
  }
}
