import { createHash, randomInt } from "node:crypto";
import type pg from "pg";
import { withSystem } from "../db/pool.js";

// Tells Google and Meta when someone who came from pomeroyagency.com signs up
// for TrailBook, and when that organisation first pays, so ads can be
// measured on real customers instead of button clicks. Sent from the server
// only: the app itself loads no Google or Meta code.
//
// What goes out is the event (sign_up / CompleteRegistration, purchase /
// Subscribe), the IDs the marketing site's own Google Analytics and Meta Pixel
// cookies already hold (they're set on .pomeroyagency.com, so they reach
// app.pomeroyagency.com too), the ad click ID, the IP address and browser,
// and a hash of the user's ID. No name, email, business name or books.
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
  fetch?: typeof fetch;
}

/**
 * META_CAPI_ACCESS_TOKEN and GA4_API_SECRET switch each half on; the pixel and
 * measurement IDs default to pomeroyagency.com's own.
 */
export function adEventsFromEnv(env: Record<string, string | undefined> = process.env): AdEventsConfig {
  return {
    metaPixelId: env.META_PIXEL_ID || "909707683290018",
    metaToken: env.META_CAPI_ACCESS_TOKEN || undefined,
    metaTestCode: env.META_TEST_EVENT_CODE || undefined,
    ga4MeasurementId: env.GA4_MEASUREMENT_ID || "G-CEMK8J8PTZ",
    ga4ApiSecret: env.GA4_API_SECRET || undefined,
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

interface Row {
  user_id: string; org_id: string; ga_client_id: string | null; ga_session_id: string | null; fbp: string | null; fbc: string | null;
  ip: string | null; user_agent: string | null; page_url: string | null;
}

async function send(cfg: AdEventsConfig, row: Row, e: { meta: string; ga4: string; id: string; value?: number; params?: Record<string, unknown> }) {
  const f = cfg.fetch ?? fetch;
  const now = Math.floor(Date.now() / 1000);
  const jobs: Promise<unknown>[] = [];
  if (cfg.metaToken) {
    const event = {
      event_name: e.meta, event_time: now, event_id: e.id, action_source: "website",
      event_source_url: row.page_url ?? "https://app.pomeroyagency.com/",
      user_data: {
        external_id: [sha256(row.user_id)],
        ...(row.ip && { client_ip_address: row.ip }), ...(row.user_agent && { client_user_agent: row.user_agent }),
        ...(row.fbp && { fbp: row.fbp }), ...(row.fbc && { fbc: row.fbc }),
      },
      custom_data: { content_name: "TrailBook", ...(e.value !== undefined && { value: e.value, currency: "USD" }) },
    };
    jobs.push(f(`https://graph.facebook.com/v21.0/${cfg.metaPixelId}/events?access_token=${encodeURIComponent(cfg.metaToken)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: [event], ...(cfg.metaTestCode && { test_event_code: cfg.metaTestCode }) }),
    }).then(async (r) => { if (!r.ok) throw new Error(`Meta ${r.status}: ${(await r.text()).slice(0, 300)}`); }));
  }
  if (cfg.ga4ApiSecret && row.ga_client_id) {
    jobs.push(f(`https://www.google-analytics.com/mp/collect?measurement_id=${cfg.ga4MeasurementId}&api_secret=${encodeURIComponent(cfg.ga4ApiSecret)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: row.ga_client_id,
        events: [{ name: e.ga4, params: { ...(row.ga_session_id && { session_id: row.ga_session_id }), engagement_time_msec: 1, product: "books", ...e.params } }],
      }),
    }).then((r) => { if (!r.ok) throw new Error(`GA4 ${r.status}`); }));
  }
  for (const r of await Promise.allSettled(jobs)) if (r.status === "rejected") console.error(`ad events: ${e.ga4} not sent:`, r.reason);
}

/**
 * Keeps the sign-up's attribution for the organisation it created and, unless
 * the person opted out, reports the sign-up. Never throws: a failure here
 * must not stop anyone signing up.
 */
export async function recordSignup(pool: pg.Pool, cfg: AdEventsConfig | undefined, a: Attribution & { userId: string; orgId: string }): Promise<void> {
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
    if (row) await send(cfg, row, { meta: "CompleteRegistration", ga4: "sign_up", id: `signup:${a.orgId}`, params: { method: "email" } });
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
      meta: "Subscribe", ga4: "purchase", id: `purchase:${p.orgId}`, value,
      params: { transaction_id: p.invoice, value, currency: "USD", items: [{ item_id: p.plan, item_name: `TrailBook ${p.plan}`, price: value, quantity: 1 }] },
    });
    await pool.query("UPDATE ad_attribution SET ip = NULL, user_agent = NULL, fbp = NULL, fbc = NULL, ga_session_id = NULL WHERE org_id = $1", [p.orgId]);
  } catch (err) {
    console.error("ad events: first payment not recorded:", err);
  }
}
