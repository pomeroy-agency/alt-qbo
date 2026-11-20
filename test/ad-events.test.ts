import { describe, expect, it } from "vitest";
import { handleApi } from "../src/app/api.js";
import { adEventsFromEnv, gaClientId, gaSessionId, hashEmail, recordFirstPayment, recordTrialStart, type AdEventsConfig } from "../src/app/ad-events.js";
import { pool } from "./helpers.js";

function fakeAds() {
  const sent: { url: string; body: any }[] = [];
  const cfg: AdEventsConfig = {
    metaPixelId: "909707683290018", metaToken: "meta-test-token", ga4MeasurementId: "G-CEMK8J8PTZ", ga4ApiSecret: "ga-test-secret",
    fetch: (async (url: string, init: RequestInit) => {
      const raw = String(init.body);
      // Meta gets a form (data, access_token, test_event_code); GA4 gets JSON.
      const body = raw.startsWith("{") ? JSON.parse(raw) : (() => {
        const f = new URLSearchParams(raw);
        return { data: JSON.parse(f.get("data")!), access_token: f.get("access_token"), test_event_code: f.get("test_event_code") ?? undefined };
      })();
      sent.push({ url, body });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  };
  return { cfg, sent };
}

let n = 0;
async function signup(cfg: AdEventsConfig | undefined, extra: { headers?: Record<string, string>; body?: Record<string, unknown>; email?: string } = {}) {
  const email = extra.email ?? `ads${Date.now()}${n++}@example.com`;
  const deferred: Promise<unknown>[] = [];
  const res = await handleApi(new Request("https://alt-qbo.test/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", ...extra.headers },
    body: JSON.stringify({ acceptTerms: true, name: "Ad Test", email, password: "long-enough-pw", orgName: "Ad Co", ...extra.body }),
  }), pool, { adEvents: cfg, defer: (p) => { deferred.push(p); } });
  expect(res.status).toBe(201);
  await Promise.all(deferred);
  const user = (await pool.query("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()])).rows[0];
  const org = (await pool.query("SELECT org_id FROM memberships WHERE user_id = $1", [user.id])).rows[0];
  return { userId: user.id as string, orgId: org.org_id as string, email };
}

/** What saving the card does: the trial starts, and is reported once. */
async function startTrial(cfg: AdEventsConfig | undefined, s: { orgId: string; email: string }) {
  const deferred: Promise<unknown>[] = [];
  await recordTrialStart(pool, cfg, { orgId: s.orgId, email: s.email }, (p) => { deferred.push(p); });
  await Promise.all(deferred);
  return deferred.length;
}

const SITE_COOKIES = "_ga=GA1.1.111222333.1761700000; _ga_CEMK8J8PTZ=GS2.1.s1761700500$o2$g1$t1761700600; _fbp=fb.1.1761700000000.987654321; _gcl_aw=GCL.1761700000.Cj0KCQtest";

describe("ad events", () => {
  it("reads the marketing site's Google Analytics cookies", () => {
    expect(gaClientId("GA1.1.111222333.1761700000")).toBe("111222333.1761700000");
    expect(gaClientId("nonsense")).toBeUndefined();
    expect(gaSessionId("GS1.1.1761700500.3.1.1761700600.0.0.0")).toBe("1761700500");
    expect(gaSessionId("GS2.1.s1761700500$o2$g1$t1761700600")).toBe("1761700500");
  });

  it("sends nothing at sign-up, then reports the trial start (card saved) as one StartTrial to Meta and one trial_start to GA4, with the site's IDs and a hashed email", async () => {
    const { cfg, sent } = fakeAds();
    const email = `  Trial${Date.now()}@Example.com `;
    const s = await signup(cfg, {
      email,
      headers: { cookie: SITE_COOKIES, "user-agent": "TestBrowser/1", "x-nf-client-connection-ip": "203.0.113.9" },
      body: { attribution: { fbclid: "IwAR123", utm_source: "google", utm_campaign: "tb-bookkeeping", page: "https://app.pomeroyagency.com/" } },
    });
    // An account that never adds a card is never reported.
    expect(sent).toHaveLength(0);
    await startTrial(cfg, { orgId: s.orgId, email });
    expect(sent).toHaveLength(2);
    const meta = sent.find((x) => x.url.includes("graph.facebook.com"))!;
    const e = meta.body.data[0];
    expect(e.event_name).toBe("StartTrial");
    expect(e.event_id).toBe(s.orgId);
    expect(e.action_source).toBe("website");
    expect(e.event_source_url).toBe("https://app.pomeroyagency.com/");
    expect(e.custom_data).toEqual({ product: "trailbook", value: 0, currency: "USD" });
    expect(e.user_data.em).toEqual([hashEmail(email)]);
    expect(e.user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashEmail(email)).toBe(hashEmail(email.trim().toLowerCase()));
    expect(e.user_data.client_user_agent).toBe("TestBrowser/1");
    // The token travels in the body, never in the address.
    expect(meta.url).toBe("https://graph.facebook.com/v21.0/909707683290018/events");
    expect(meta.body.access_token).toBe("meta-test-token");
    expect(meta.body.test_event_code).toBeUndefined();
    expect(e.user_data.fbp).toBe("fb.1.1761700000000.987654321");
    expect(e.user_data.fbc).toMatch(/^fb\.1\.\d+\.IwAR123$/);
    expect(e.user_data.client_ip_address).toBe("203.0.113.9");
    expect(JSON.stringify(meta.body).toLowerCase()).not.toContain("example.com");
    expect(JSON.stringify(meta.body)).not.toContain("Ad Co");
    const ga = sent.find((x) => x.url.includes("google-analytics.com"))!;
    expect(ga.body.client_id).toBe("111222333.1761700000");
    expect(ga.body.events).toHaveLength(1);
    expect(ga.body.events[0]).toMatchObject({ name: "trial_start", params: { session_id: "1761700500", product: "trailbook" } });
    expect(ga.body.events[0].params.debug_mode).toBeUndefined();
    expect(JSON.stringify(ga.body).toLowerCase()).not.toContain("example.com");
    const row = (await pool.query("SELECT gclid, utm_source, utm_campaign FROM ad_attribution WHERE org_id = $1", [s.orgId])).rows[0];
    expect(row).toEqual({ gclid: "Cj0KCQtest", utm_source: "google", utm_campaign: "tb-bookkeeping" });
  });

  it("reports the first payment once, then forgets the identifiers", async () => {
    const { cfg, sent } = fakeAds();
    const s = await signup(cfg, { headers: { cookie: SITE_COOKIES, "x-nf-client-connection-ip": "203.0.113.9" } });
    await startTrial(cfg, s);
    sent.length = 0;
    await recordFirstPayment(pool, cfg, { orgId: s.orgId, valueMinor: 1500n, plan: "books", invoice: "INV-0001" });
    await recordFirstPayment(pool, cfg, { orgId: s.orgId, valueMinor: 1500n, plan: "books", invoice: "INV-0002" });
    expect(sent).toHaveLength(2);
    const e = sent.find((x) => x.url.includes("graph.facebook.com"))!.body.data[0];
    expect(e).toMatchObject({ event_name: "Subscribe", event_id: `purchase:${s.orgId}`, custom_data: { product: "trailbook", value: 15, currency: "USD" } });
    expect(e.user_data.em).toBeUndefined();
    const ga = sent.find((x) => x.url.includes("google-analytics.com"))!.body.events[0];
    expect(ga).toMatchObject({ name: "purchase", params: { transaction_id: "INV-0001", value: 15, currency: "USD" } });
    const row = (await pool.query("SELECT ip, fbp, purchase_sent_at FROM ad_attribution WHERE org_id = $1", [s.orgId])).rows[0];
    expect(row.ip).toBeNull();
    expect(row.fbp).toBeNull();
    expect(row.purchase_sent_at).not.toBeNull();
  });

  it("sends and keeps nothing for someone who opts out, sends Global Privacy Control, or when the keys aren't set", async () => {
    const { cfg, sent } = fakeAds();
    const boxed = await signup(cfg, { headers: { cookie: SITE_COOKIES }, body: { adOptOut: true } });
    const gpc = await signup(cfg, { headers: { cookie: SITE_COOKIES, "sec-gpc": "1" } });
    const off = await signup(undefined, { headers: { cookie: SITE_COOKIES } });
    for (const s of [boxed, gpc, off]) expect(await startTrial(cfg, s)).toBe(0);
    expect(sent).toHaveLength(0);
    for (const s of [boxed, gpc, off]) {
      await recordFirstPayment(pool, cfg, { orgId: s.orgId, valueMinor: 1500n, plan: "books", invoice: "INV-9" });
      expect((await pool.query("SELECT 1 FROM ad_attribution WHERE org_id = $1", [s.orgId])).rows).toHaveLength(0);
    }
    expect(sent).toHaveLength(0);
  });

  it("sends a trial start only once per account, and test codes and debug mode when they're set", async () => {
    const { cfg, sent } = fakeAds();
    const debug = { ...cfg, metaTestCode: "TEST123", ga4Debug: true };
    const s = await signup(debug, { headers: { cookie: SITE_COOKIES } });
    await startTrial(debug, s);
    expect(sent.filter((x) => x.url.includes("graph.facebook.com"))).toHaveLength(1);
    expect(sent.filter((x) => x.url.includes("google-analytics.com"))).toHaveLength(1);
    expect(sent.find((x) => x.url.includes("graph.facebook.com"))!.body.test_event_code).toBe("TEST123");
    expect(sent.find((x) => x.url.includes("google-analytics.com"))!.body.events[0].params.debug_mode).toBe(true);
    // A repeat for the same account (a card replaced, a retry) sends nothing more.
    expect(await startTrial(cfg, s)).toBe(0);
    const { recordSignup } = await import("../src/app/ad-events.js");
    await recordSignup(pool, cfg, { optedOut: false, userId: s.userId, orgId: s.orgId, email: "x@example.com" });
    expect(await startTrial(cfg, s)).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("never holds up a sign-up or the card step while Meta or Google is slow or down", async () => {
    let release!: () => void;
    const hang = new Promise<void>((r) => { release = r; });
    const cfg: AdEventsConfig = {
      metaPixelId: "1", metaToken: "t", ga4MeasurementId: "G-X", ga4ApiSecret: "s",
      fetch: (async () => { await hang; throw new Error("down"); }) as unknown as typeof fetch,
    };
    const deferred: Promise<unknown>[] = [];
    const email = `slow${Date.now()}@example.com`;
    const res = await handleApi(new Request("https://alt-qbo.test/api/auth/signup", {
      method: "POST", headers: { "content-type": "application/json", cookie: SITE_COOKIES },
      body: JSON.stringify({ acceptTerms: true, name: "Slow", email, password: "long-enough-pw", orgName: "Slow Co" }),
    }), pool, { adEvents: cfg, defer: (p) => { deferred.push(p); } });
    expect(res.status).toBe(201);
    expect(deferred).toHaveLength(0);
    const orgId = (await pool.query("SELECT m.org_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1", [email])).rows[0].org_id;
    await recordTrialStart(pool, cfg, { orgId, email }, (p) => { deferred.push(p); });
    expect(deferred).toHaveLength(1);
    release();
    await expect(deferred[0]).resolves.toBeUndefined();
  });

  it("reads the keys from the environment, with the older Meta names as fallbacks", () => {
    expect(adEventsFromEnv({})).toMatchObject({ metaPixelId: "909707683290018", ga4MeasurementId: "G-CEMK8J8PTZ", ga4Debug: false });
    expect(adEventsFromEnv({}).metaToken).toBeUndefined();
    expect(adEventsFromEnv({ META_CAPI_TOKEN: "new", META_CAPI_ACCESS_TOKEN: "old" }).metaToken).toBe("new");
    expect(adEventsFromEnv({ META_CAPI_ACCESS_TOKEN: "old" }).metaToken).toBe("old");
    expect(adEventsFromEnv({ META_CAPI_TEST_CODE: "T1", META_TEST_EVENT_CODE: "T0" }).metaTestCode).toBe("T1");
    expect(adEventsFromEnv({ META_TEST_EVENT_CODE: "T0" }).metaTestCode).toBe("T0");
    expect(adEventsFromEnv({ GA4_DEBUG_MODE: "1", GA4_API_SECRET: " s " })).toMatchObject({ ga4Debug: true, ga4ApiSecret: "s" });
  });

  it("never reports someone who joins an existing business by invitation", async () => {
    const { cfg, sent } = fakeAds();
    const req = (path: string, body: unknown, cookie?: string) => handleApi(new Request(`https://alt-qbo.test${path}`, {
      method: "POST", headers: { "content-type": "application/json", ...(cookie && { cookie }) }, body: JSON.stringify(body),
    }), pool, { adEvents: cfg });
    const owner = await req("/api/auth/signup", { acceptTerms: true, name: "Owner", email: `owner${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Inv Co" });
    const session = owner.headers.get("set-cookie")!.split(";")[0]!;
    const me = await (await handleApi(new Request("https://alt-qbo.test/api/me", { headers: { cookie: session } }), pool, { adEvents: cfg })).json();
    const inv = await (await req(`/api/orgs/${me.orgs[0].id}/invitations`, { email: `member${Date.now()}@example.com`, role: "bookkeeper" }, session)).json();
    sent.length = 0;
    const joined = await req("/api/auth/signup", { acceptTerms: true, name: "Member", email: inv.email ?? `member@example.com`, password: "long-enough-pw", inviteToken: inv.token }, SITE_COOKIES);
    expect(joined.status).toBe(201);
    expect(sent).toHaveLength(0);
  });
});
