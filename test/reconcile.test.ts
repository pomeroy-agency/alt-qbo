import { describe, expect, it } from "vitest";
import { withSystem, withTenant, type Tx } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import { postJournal } from "../src/core/ledger.js";
import { completeReconciliation, listReconciliations, reconciliationItems } from "../src/core/reconcile.js";
import { bookkeeper, pool, setupCaliforniaBusiness } from "./helpers.js";

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

async function business() {
  const { org, entity } = await setupCaliforniaBusiness();
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const post = (date: string, account: string, amount: string, inflow: boolean) => t((tx) => postJournal(tx, {
    orgId: org.id, entityId: entity.id, date, sourceType: "journal_voucher", idempotencyKey: crypto.randomUUID(), actor: bookkeeper,
    lines: inflow ? [{ account: "1000", debit: amount }, { account, credit: amount }] : [{ account, debit: amount }, { account: "1000", credit: amount }],
  }));
  await post("2026-01-02", "3000", "5000.00", true);
  await post("2026-01-10", "6000", "300.00", false);
  await post("2026-01-28", "6400", "1200.00", false);
  await post("2026-02-03", "4000", "800.00", true);
  const items = (statementDate: string) => t((tx) => reconciliationItems(tx, { entityId: entity.id, bankAccount: "1000", statementDate }));
  const complete = (statementDate: string, statementBalance: string, ids: string[], actor = bookkeeper) =>
    t((tx) => completeReconciliation(tx, { orgId: org.id, entityId: entity.id, bankAccount: "1000", statementDate, statementBalance, clearedLineIds: ids, actor }));
  return { org, entity, t, items, complete };
}

describe("reconciliation", () => {
  it("completes only at zero difference, then carries the balance forward", async () => {
    const b = await business();
    const jan = await b.items("2026-01-31");
    expect(jan.beginningMinor).toBe(0n);
    expect(jan.items.map((i) => i.amountMinor)).toEqual([500000n, -30000n, -120000n]);
    // The rent cheque hasn't cleared the bank yet.
    const cleared = jan.items.filter((i) => i.amountMinor !== -120000n).map((i) => i.lineId);
    await expectLedgerError(b.complete("2026-01-31", "4800.00", cleared), "UNBALANCED");
    const r = await b.complete("2026-01-31", "4,700.00", cleared);
    expect(r).toMatchObject({ beginningMinor: 0n, clearedMinor: 470000n, statementMinor: 470000n, lines: 2 });

    const feb = await b.items("2026-02-28");
    expect(feb.beginningMinor).toBe(470000n);
    expect(feb.items.map((i) => i.amountMinor)).toEqual([-120000n, 80000n]);
    await expectLedgerError(b.complete("2026-01-15", "4700.00", []), "INVALID");
    await expectLedgerError(b.complete("2026-02-28", "4300.00", [...cleared, feb.items[0]!.lineId]), "INVALID");
    await b.complete("2026-02-28", "4300.00", feb.items.map((i) => i.lineId));
    expect(await b.t((tx) => listReconciliations(tx, b.entity.id, "1000"))).toHaveLength(2);
  });

  it("refuses read-only users and non-bank accounts", async () => {
    const b = await business();
    await expectLedgerError(b.complete("2026-01-31", "0.00", [], { id: "user:v", role: "read_only" }), "FORBIDDEN");
    await expectLedgerError(b.t((tx) => reconciliationItems(tx, { entityId: b.entity.id, bankAccount: "4000", statementDate: "2026-01-31" })), "INVALID");
  });

  it("holds in the database: no unbalanced, backdated, edited or double-cleared reconciliations", async () => {
    const b = await business();
    const jan = await b.items("2026-01-31");
    const bank = (await b.t((tx) => tx.query("SELECT id FROM accounts WHERE entity_id = $1 AND code = '1000'", [b.entity.id]))).rows[0].id;
    const sys = <T>(fn: (tx: Tx) => Promise<T>) => withSystem(pool, fn);
    const raw = (tx: Tx, date: string, begin: number, cleared: number, end: number) => tx.query(
      `INSERT INTO reconciliations (org_id, entity_id, bank_account_id, statement_date, beginning_balance_minor, cleared_total_minor, statement_balance_minor, completed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'raw') RETURNING id`,
      [b.org.id, b.entity.id, bank, date, begin, cleared, end],
    );
    // Claims a cleared total its lines don't add up to.
    await expect(sys((tx) => raw(tx, "2026-01-31", 0, 500000, 500000))).rejects.toThrow(/UNBALANCED/);
    // Starts from the wrong beginning balance.
    await expect(sys((tx) => raw(tx, "2026-01-31", 100, 0, 100))).rejects.toThrow(/beginning balance/);
    await b.complete("2026-01-31", "5000.00", [jan.items[0]!.lineId]);
    await expect(sys((tx) => raw(tx, "2026-01-20", 500000, 0, 500000))).rejects.toThrow(/already reconciled/);
    await expect(sys((tx) => tx.query("UPDATE reconciliations SET statement_balance_minor = 1 WHERE entity_id = $1", [b.entity.id]))).rejects.toThrow(/IMMUTABLE/);
    await expect(sys((tx) => tx.query("DELETE FROM reconciliation_lines WHERE entity_id = $1", [b.entity.id]))).rejects.toThrow(/IMMUTABLE/);
    // The same ledger line can't be cleared a second time.
    await expect(sys(async (tx) => {
      const { rows } = await raw(tx, "2026-02-28", 500000, 500000, 1000000);
      await tx.query("INSERT INTO reconciliation_lines (reconciliation_id, org_id, entity_id, journal_line_id) VALUES ($1, $2, $3, $4)",
        [rows[0].id, b.org.id, b.entity.id, jan.items[0]!.lineId]);
    })).rejects.toThrow(/duplicate key/);
  });
});
