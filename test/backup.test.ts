import { describe, expect, it } from "vitest";
import { withTenant } from "../src/db/pool.js";
import { handleApi } from "../src/app/api.js";
import { backupEntity, verifyBackup } from "../src/core/backup.js";
import { LedgerError } from "../src/core/errors.js";
import { bookkeeper, owner, pool } from "./helpers.js";

const BASE = "https://alt-qbo.test";
async function call(path: string, init: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  const res = await handleApi(
    new Request(BASE + path, { method: init.body !== undefined ? "POST" : "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
    pool, { signupCode: "c" },
  );
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => null), cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

describe("backup", () => {
  it("downloads the whole example business as one checked file, without secrets", async () => {
    const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "B", email: `backup${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Backup Co", inviteCode: "c" } });
    const cookie = su.cookie!;
    const ex = await call("/api/example", { cookie, body: {} });
    expect(ex.status).toBe(201);
    const { orgId, entityId } = ex.data;

    const r = await call(`/api/orgs/${orgId}/entities/${entityId}/backup`, { cookie, body: {} });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="alt-qbo-backup-sunset-design-studio-llc-\d{4}-\d{2}-\d{2}\.json"/);
    const b = r.data;
    expect(b).toMatchObject({ format: "alt-qbo-backup", version: 1, organization: { id: orgId } });
    expect(b.counts).toMatchObject({ contacts: 6, items: 2, bank_lines: 5, employees: 2 });
    expect(b.counts.documents).toBeGreaterThan(10);
    expect(b.tables.journal_lines.length).toBeGreaterThan(b.tables.journal_entries.length);
    expect(b.audit.verification).toMatchObject({ ok: true });
    expect(b.audit.events.at(-1)).toMatchObject({ action: "entity.backup_downloaded" });
    expect(verifyBackup(b)).toEqual({ ok: true });

    // Nothing secret in the file.
    const text = JSON.stringify(b);
    for (const secret of ["password_hash", "token_hash", "token_ref", "ssn_sealed"]) expect(text).not.toContain(secret);

    // An edited file is caught.
    b.tables.journal_lines[0].debit_minor = "999999";
    expect(verifyBackup(b)).toMatchObject({ ok: false, reason: expect.stringMatching(/changed or damaged/) });
    expect(verifyBackup({ format: "something else" })).toMatchObject({ ok: false });
  });

  it("is for owners, admins and accountants", async () => {
    const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "B", email: `backup2${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Backup Co 2", inviteCode: "c" } });
    const ex = await call("/api/example", { cookie: su.cookie!, body: {} });
    await expect(withTenant(pool, ex.data.orgId, (tx) => backupEntity(tx, { orgId: ex.data.orgId, entityId: ex.data.entityId, actor: bookkeeper })))
      .rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === "FORBIDDEN");
    const ok = await withTenant(pool, ex.data.orgId, (tx) => backupEntity(tx, { orgId: ex.data.orgId, entityId: ex.data.entityId, actor: owner }));
    expect(ok.counts.accounts).toBeGreaterThan(10);
  });
});
