import { describe, expect, it } from "vitest";
import { withSystem, withTenant } from "../src/db/pool.js";
import { clientOverview } from "../src/core/firm.js";
import { importBankCsv } from "../src/core/bank.js";
import { createContact, issueDocument } from "../src/core/documents.js";
import { bookkeeper, pool, setupCaliforniaBusiness } from "./helpers.js";

describe("firm console", () => {
  it("lists each client the person belongs to, with what their books need, and nothing else", async () => {
    const a = await setupCaliforniaBusiness(`Alpine Co ${Date.now()}`);
    const b = await setupCaliforniaBusiness(`Birch Co ${Date.now()}`);
    const locked = await setupCaliforniaBusiness(`Cedar Co ${Date.now()}`);
    const other = await setupCaliforniaBusiness(`Not Mine ${Date.now()}`);
    const userId = await withSystem(pool, async (tx) => {
      const u = (await tx.query("INSERT INTO users (email, name, password_hash) VALUES ($1, 'CPA', 'x') RETURNING id", [`cpa-${Date.now()}@example.com`])).rows[0].id;
      for (const [org, role] of [[a.org.id, "accountant"], [b.org.id, "bookkeeper"], [locked.org.id, "accountant"]]) {
        await tx.query("INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, $3)", [u, org, role]);
      }
      await tx.query("UPDATE organizations SET require_mfa = true WHERE id = $1", [locked.org.id]);
      return u;
    });

    // Alpine has two bank lines to review and an overdue invoice.
    const base = { orgId: a.org.id, entityId: a.entity.id };
    await withTenant(pool, a.org.id, async (tx) => {
      await importBankCsv(tx, { ...base, bankAccount: "1000", csv: "Date,Description,Amount\n03/02/2026,ADOBE,-54.99\n03/03/2026,SHELL,-40.00\n", fileName: "s.csv", actor: bookkeeper });
      const c = await createContact(tx, { ...base, kind: "customer", name: "Client", address: { line1: "1 Main St", city: "Fresno", state: "CA", zip: "93701" }, actor: bookkeeper });
      await issueDocument(tx, {
        ...base, kind: "invoice", contactId: c.id, issueDate: "2026-03-01", dueDate: "2026-03-31", idempotencyKey: "i1", actor: bookkeeper,
        lines: [{ account: "4000", description: "Design", quantity: "1", unitPrice: "500.00", taxCategory: "service" }],
      });
    });

    const clients = await clientOverview(pool, { id: userId }, { today: "2026-06-15", exampleOrgName: "Example: Sunset Design Studio" });
    expect(clients.map((c) => c.id)).toEqual([a.org.id, b.org.id, locked.org.id]);
    expect(clients.some((c) => c.id === other.org.id)).toBe(false);

    const [alpine, birch, cedar] = clients;
    expect(alpine!.role).toBe("accountant");
    expect(alpine!.entities[0]).toMatchObject({ bankToReview: 2, overdueInvoices: 1, payRunsToApprove: 0, closedThrough: null });
    // Bank lines, the overdue invoice and months left open. Nothing has reached the bank account yet, so it needs no reconciling.
    expect(alpine!.entities[0]).toMatchObject({ unreconciled: 0, tasks: 3 });
    expect(alpine!.entities[0]!.monthsToClose).toBeGreaterThan(0);
    expect(alpine!.entities[0]!.lastActivity).not.toBeNull();
    expect(birch!.entities[0]).toMatchObject({ bankToReview: 0, overdueInvoices: 0, unreconciled: 0 });
    expect(cedar!.locked).toMatch(/two-factor/);
    expect(cedar!.entities).toEqual([]);
  });
});
