import { describe, expect, it } from "vitest";
import { handleApi } from "../src/app/api.js";
import { gaClientId, gaSessionId, recordFirstPayment, type AdEventsConfig } from "../src/app/ad-events.js";
import { pool } from "./helpers.js";

function fakeAds() {
  const sent: { url: string; body: any }[] = [];
  const cfg: AdEventsConfig = {
    metaPixelId: "909707683290018", metaToken: "meta-test-token", ga4MeasurementId: "G-CEMK8J8PTZ", ga4ApiSecret: "ga-test-secret",
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
  };
  return { cfg, sent };
}

let n = 0;
async function signup(cfg: AdEventsConfig | undefined, extra: { headers?: Record<string, string>; body?: Record<string, unknown> } = {}) {
  const email = `ads${Date.now()}${n++}@example.com`;
  const res = await handleApi(new Request("https://alt-qbo.test/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", ...extra.headers },
    body: JSON.stringify({ acceptTerms: true, name: "Ad Test", email, password: "long-enough-pw", orgName: "Ad Co", ...extra.body }),
  }), pool, { adEvents: cfg });
  expect(res.status).toBe(201);
  const user = (await pool.query("SELECT id FROM users WHERE email = $1", [email])).rows[0];
  const org = (await pool.query("SELECT org_id FROM memberships WHERE user_id = $1", [user.id])).rows[0];
  return { userId: user.id as string, orgId: org.org_id as string };
}

const SITE_COOKIES = "_ga=GA1.1.111222333.1761700000; _ga_CEMK8J8PTZ=GS2.1.s1761700500$o2$g1$t1761700600; _fbp=fb.1.1761700000000.987654321; _gcl_aw=GCL.1761700000.Cj0KCQtest";

describe("ad events", () => {
  it("reads the marketing site's Google Analytics cookies", () => {
    expect(gaClientId("GA1.1.111222333.1761700000")).toBe("111222333.1761700000");
    expect(gaClientId("nonsense")).toBeUndefined();
    expect(gaSessionId("GS1.1.1761700500.3.1.1761700600.0.0.0")).toBe("1761700500");
    expect(gaSessionId("GS2.1.s1761700500$o2$g1$t1761700600")).toBe("1761700500");
  });

  it("reports a new organisation's sign-up to Meta and GA4 with the site's IDs, and nothing personal", async () => {
    const { cfg, sent } = fakeAds();
    const s = await signup(cfg, {
      headers: { cookie: SITE_COOKIES, "user-agent": "TestBrowser/1", "x-nf-client-connection-ip": "203.0.113.9" },
      body: { attribution: { fbclid: "IwAR123", utm_source: "google", utm_campaign: "tb-bookkeeping", page: "https://app.pomeroyagency.com/" } },
    });
    expect(sent).toHaveLength(2);
    const meta = sent.find((x) => x.url.includes("graph.facebook.com"))!;
    const e = meta.body.data[0];
    expect(e.event_name).toBe("CompleteRegistration");
    expect(e.event_id).toBe(`signup:${s.orgId}`);
    expect(e.user_data.fbp).toBe("fb.1.1761700000000.987654321");
    expect(e.user_data.fbc).toMatch(/^fb\.1\.\d+\.IwAR123$/);
    expect(e.user_data.client_ip_address).toBe("203.0.113.9");
    expect(JSON.stringify(meta.body)).not.toContain("example.com");
    expect(JSON.stringify(meta.body)).not.toContain("Ad Co");
    const ga = sent.find((x) => x.url.includes("google-analytics.com"))!;
    expect(ga.body.client_id).toBe("111222333.1761700000");
    expect(ga.body.events[0]).toMatchObject({ name: "sign_up", params: { session_id: "1761700500", product: "books" } });
    const row = (await pool.query("SELECT gclid, utm_source, utm_campaign FROM ad_attribution WHERE org_id = $1", [s.orgId])).rows[0];
    expect(row).toEqual({ gclid: "Cj0KCQtest", utm_source: "google", utm_campaign: "tb-bookkeeping" });
  });

  it("reports the first payment once, then forgets the identifiers", async () => {
    const { cfg, sent } = fakeAds();
    const s = await signup(cfg, { headers: { cookie: SITE_COOKIES, "x-nf-client-connection-ip": "203.0.113.9" } });
    sent.length = 0;
    await recordFirstPayment(pool, cfg, { orgId: s.orgId, valueMinor: 1500n, plan: "books", invoice: "INV-0001" });
    await recordFirstPayment(pool, cfg, { orgId: s.orgId, valueMinor: 1500n, plan: "books", invoice: "INV-0002" });
    expect(sent).toHaveLength(2);
    const e = sent.find((x) => x.url.includes("graph.facebook.com"))!.body.data[0];
    expect(e).toMatchObject({ event_name: "Subscribe", event_id: `purchase:${s.orgId}`, custom_data: { value: 15, currency: "USD" } });
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
    expect(sent).toHaveLength(0);
    for (const s of [boxed, gpc, off]) {
      await recordFirstPayment(pool, cfg, { orgId: s.orgId, valueMinor: 1500n, plan: "books", invoice: "INV-9" });
      expect((await pool.query("SELECT 1 FROM ad_attribution WHERE org_id = $1", [s.orgId])).rows).toHaveLength(0);
    }
    expect(sent).toHaveLength(0);
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
