import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { handleApi } from "../src/app/api.js";
import { checkCopy, memoryStore, openBackup, runNightlyBackups, sealBackup } from "../src/core/nightly-backups.js";
import { pool } from "./helpers.js";

const BASE = "https://alt-qbo.test";
const key = randomBytes(32);
const store = memoryStore();
const opts = { signupCode: "c", backups: { store, key } };

async function call(path: string, init: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  const res = await handleApi(
    new Request(BASE + path, { method: init.body !== undefined ? "POST" : "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
    pool, opts,
  );
  return { status: res.status, data: await res.json().catch(() => null), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

describe("nightly backups", () => {
  it("stores an encrypted copy of each business, checks it, and offers it as a restore point", async () => {
    const su = await call("/api/auth/signup", { body: { name: "N", email: `nightly${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Nightly Co", inviteCode: "c" } });
    const cookie = su.cookie!;
    const ex = await call("/api/example", { cookie, body: {} });
    const { orgId, entityId } = ex.data;

    const result = await runNightlyBackups(pool, store, key, "2026-11-02");
    // Other test files deliberately break some organisations' audit chains, and those copies
    // are rightly refused, so only this business's own copy is checked here.
    expect(result.backedUp).toBeGreaterThan(0);

    const k = `${orgId}/${entityId}/2026-11-02.bin`;
    const sealed = store.data.get(k)!;
    // Encrypted: none of the books' text is readable in storage.
    expect(Buffer.from(sealed).toString("latin1")).not.toContain("Sunset Design Studio");
    const copy = openBackup(sealed, key);
    expect(copy.audit.events.at(-1)).toMatchObject({ action: "entity.backup_scheduled" });
    expect(() => openBackup(sealed, randomBytes(32))).toThrow();

    const list = await call(`/api/orgs/${orgId}/entities/${entityId}/backups`, { cookie });
    expect(list.data.restorePoints[0]).toMatchObject({ date: "2026-11-02", verified: true, problem: null });

    const dl = await call(`/api/orgs/${orgId}/entities/${entityId}/backups/${list.data.restorePoints[0].id}/download`, { cookie, body: {} });
    expect(dl.status).toBe(200);
    expect(dl.data.checksum).toBe(copy.checksum);
  });

  it("refuses a copy whose balances don't match the books", async () => {
    const su = await call("/api/auth/signup", { body: { name: "M", email: `mismatch${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Mismatch Co", inviteCode: "c" } });
    const ex = await call("/api/example", { cookie: su.cookie, body: {} });
    await runNightlyBackups(pool, store, key, "2026-11-03");
    const copy = openBackup(store.data.get(`${ex.data.orgId}/${ex.data.entityId}/2026-11-03.bin`)!, key);
    expect(checkCopy(copy, "0".repeat(64))).toMatch(/don't match/);
    // A file changed after it was made fails its checksum.
    const edited = { ...copy, tables: { ...copy.tables, journal_lines: copy.tables.journal_lines!.slice(1) } };
    expect(checkCopy(edited, "x")).toMatch(/changed or damaged/);
    expect(openBackup(sealBackup(copy, key), key).checksum).toBe(copy.checksum);
  });

  it("keeps 30 days of copies", async () => {
    const su = await call("/api/auth/signup", { body: { name: "K", email: `keep${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Keep Co", inviteCode: "c" } });
    const ex = await call("/api/example", { cookie: su.cookie, body: {} });
    const prefix = `${ex.data.orgId}/${ex.data.entityId}/`;
    await runNightlyBackups(pool, store, key, "2026-10-01");
    expect(store.data.has(`${prefix}2026-10-01.bin`)).toBe(true);
    await runNightlyBackups(pool, store, key, "2026-11-01");
    expect(store.data.has(`${prefix}2026-10-01.bin`)).toBe(false);
    const list = await call(`/api/orgs/${ex.data.orgId}/entities/${ex.data.entityId}/backups`, { cookie: su.cookie });
    expect(list.data.restorePoints.map((r: { date: string }) => r.date)).toEqual(["2026-11-01"]);
  });
});

describe("status", () => {
  it("reports the service and last night's backups, without naming anyone", async () => {
    const r = await call("/api/status");
    expect(r.data).toMatchObject({ api: true, database: true });
    expect(r.data.backups.lastNight).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(r.data)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
