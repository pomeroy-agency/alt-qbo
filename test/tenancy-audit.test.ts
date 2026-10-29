import { describe, expect, it } from "vitest";
import { withSystem, withTenant } from "../src/db/pool.js";
import { postJournal } from "../src/core/ledger.js";
import { addConnection, createEntity, getEntity } from "../src/core/tenancy.js";
import { verifyAuditChain } from "../src/core/audit.js";
import { JurisdictionError } from "../src/rules/index.js";
import { bookkeeper, owner, pool, setupCaliforniaBusiness } from "./helpers.js";

describe("entity setup from principal place of business", () => {
  it("picks US GAAP, USD, the service chart of accounts and Schedule C tax lines for a California single-member LLC", async () => {
    const { entity } = await setupCaliforniaBusiness();
    expect(entity).toMatchObject({
      framework: "US_GAAP",
      functionalCurrency: "USD",
      coaTemplate: "us-service",
      taxReturnType: "sch_c",
      ledgerRetentionYears: 7,
      payrollRetentionYears: 4,
    });
  });

  it("uses S-corp tax lines for an S corporation", async () => {
    const { org } = await setupCaliforniaBusiness();
    const scorp = await withTenant(pool, org.id, (tx) =>
      createEntity(tx, {
        orgId: org.id, legalName: "Sunset Holdings Inc", entityType: "s_corp",
        place: { country: "US", region: "CA" }, firstFiscalYear: 2026, actor: owner,
      }),
    );
    const { rows } = await withTenant(pool, org.id, (tx) =>
      tx.query("SELECT tax_line FROM accounts WHERE entity_id = $1 AND code = '7010'", [scorp.id]),
    );
    expect(rows[0].tax_line).toBe("1120S.L7");
  });

  it("refuses places that are not launched", async () => {
    const { org } = await setupCaliforniaBusiness();
    await expect(
      withTenant(pool, org.id, (tx) =>
        createEntity(tx, {
          orgId: org.id, legalName: "Gem State LLC", entityType: "llc_single",
          place: { country: "US", region: "ME" }, firstFiscalYear: 2026, actor: owner,
        }),
      ),
    ).rejects.toBeInstanceOf(JurisdictionError);
  });
});

describe("tenant isolation (row-level security)", () => {
  it("hides another organisation's data entirely", async () => {
    const a = await setupCaliforniaBusiness("Tenant A");
    const b = await setupCaliforniaBusiness("Tenant B");
    await withTenant(pool, a.org.id, (tx) =>
      postJournal(tx, {
        orgId: a.org.id, entityId: a.entity.id, date: "2026-02-01", idempotencyKey: "a-1",
        sourceType: "journal_voucher", actor: bookkeeper,
        lines: [{ account: "1000", debit: "50.00" }, { account: "3000", credit: "50.00" }],
      }),
    );
    const seenByB = await withTenant(pool, b.org.id, async (tx) => ({
      orgs: (await tx.query("SELECT id FROM organizations")).rows.map((r) => r.id),
      entities: (await tx.query("SELECT id FROM entities")).rows.map((r) => r.id),
      entries: (await tx.query("SELECT count(*)::int AS n FROM journal_entries")).rows[0].n,
      audit: (await tx.query("SELECT DISTINCT org_id FROM audit_events")).rows.map((r) => r.org_id),
    }));
    expect(seenByB.orgs).toEqual([b.org.id]);
    expect(seenByB.entities).toEqual([b.entity.id]);
    expect(seenByB.entries).toBe(0);
    expect(seenByB.audit).toEqual([b.org.id]);
    await expect(withTenant(pool, b.org.id, (tx) => getEntity(tx, a.entity.id))).rejects.toThrow(/not found/);
  });

  it("refuses writes into another organisation", async () => {
    const a = await setupCaliforniaBusiness("Tenant A2");
    const b = await setupCaliforniaBusiness("Tenant B2");
    // B tries to post into A's entity: A's accounts are invisible, so nothing can be referenced.
    await expect(
      withTenant(pool, b.org.id, (tx) =>
        postJournal(tx, {
          orgId: a.org.id, entityId: a.entity.id, date: "2026-02-01", idempotencyKey: "steal",
          sourceType: "journal_voucher", actor: bookkeeper,
          lines: [{ account: "1000", debit: "1.00" }, { account: "3000", credit: "1.00" }],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(pool, b.org.id, (tx) =>
        tx.query("INSERT INTO periods (org_id, entity_id, start_date, end_date) VALUES ($1, $2, '2030-01-01', '2030-01-31')",
          [a.org.id, a.entity.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("with no tenant set, the app role sees nothing", async () => {
    await setupCaliforniaBusiness();
    const n = await withSystem(pool, async (tx) => {
      await tx.query("SET LOCAL ROLE altqbo_app");
      return (await tx.query("SELECT count(*)::int AS n FROM entities")).rows[0].n;
    });
    expect(n).toBe(0);
  });
});

describe("connections", () => {
  it("stores vault references, never raw credentials", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    await withTenant(pool, org.id, (tx) =>
      addConnection(tx, {
        orgId: org.id, entityId: entity.id, kind: "bank", displayName: "First Coast Bank checking",
        scopes: ["transactions", "balances"], tokenRef: "vault:plaid/item-123", actor: owner,
      }),
    );
    await expect(
      withTenant(pool, org.id, (tx) =>
        addConnection(tx, {
          orgId: org.id, entityId: entity.id, kind: "bank", displayName: "bad",
          tokenRef: "access-sandbox-abc123", actor: owner,
        }),
      ),
    ).rejects.toThrow(/vault reference/);
  });
});

describe("audit log", () => {
  it("records every change in one verifiable hash chain per organisation", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    await withTenant(pool, org.id, (tx) =>
      postJournal(tx, {
        orgId: org.id, entityId: entity.id, date: "2026-02-01", idempotencyKey: "au-1",
        sourceType: "journal_voucher", actor: bookkeeper,
        lines: [{ account: "1000", debit: "50.00" }, { account: "3000", credit: "50.00" }],
      }),
    );
    const { rows } = await withTenant(pool, org.id, (tx) =>
      tx.query("SELECT seq, action, actor FROM audit_events WHERE org_id = $1 ORDER BY seq", [org.id]),
    );
    expect(rows.map((r) => r.action)).toEqual(["organization.created", "entity.created", "journal.posted"]);
    expect(rows.map((r) => r.seq)).toEqual([1n, 2n, 3n]);
    expect(rows[2].actor).toBe("user:bookkeeper");
    const v = await withTenant(pool, org.id, (tx) => verifyAuditChain(tx, org.id));
    expect(v).toEqual({ ok: true, events: 3 });
  });

  it("an audit event rolls back with the change it records", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    await expect(
      withTenant(pool, org.id, (tx) =>
        postJournal(tx, {
          orgId: org.id, entityId: entity.id, date: "2026-02-01", idempotencyKey: "au-rb",
          sourceType: "journal_voucher", actor: bookkeeper,
          lines: [{ account: "1000", debit: "50.00" }, { account: "3000", credit: "40.00" }, { account: "3100", credit: "10.00" }],
        }).then(() => { throw new Error("caller failed after posting"); }),
      ),
    ).rejects.toThrow(/caller failed/);
    const v = await withTenant(pool, org.id, (tx) => verifyAuditChain(tx, org.id));
    expect(v).toEqual({ ok: true, events: 2 });
  });

  it("detects tampering even by someone who can bypass the immutability triggers", async () => {
    const { org } = await setupCaliforniaBusiness();
    // Simulate a database administrator disabling triggers and editing history.
    await withSystem(pool, async (tx) => {
      await tx.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable");
      await tx.query("UPDATE audit_events SET actor = 'user:someone-else' WHERE org_id = $1 AND seq = 1", [org.id]);
      await tx.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable");
    });
    const v = await withTenant(pool, org.id, (tx) => verifyAuditChain(tx, org.id));
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1n);
    expect(v.reason).toMatch(/hash does not match/);
  });

  it("detects a deleted tail event", async () => {
    const { org } = await setupCaliforniaBusiness();
    await withSystem(pool, async (tx) => {
      await tx.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable");
      await tx.query("DELETE FROM audit_events WHERE org_id = $1 AND seq = 2", [org.id]);
      await tx.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable");
    });
    const v = await withTenant(pool, org.id, (tx) => verifyAuditChain(tx, org.id));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/events missing/);
  });

  it("the head can only move forward", async () => {
    const { org } = await setupCaliforniaBusiness();
    await expect(
      withTenant(pool, org.id, (tx) => tx.query("UPDATE audit_heads SET last_seq = 1 WHERE org_id = $1", [org.id])),
    ).rejects.toThrow(/AUDIT_CHAIN/);
  });
});
