import { describe, expect, it } from "vitest";
import { withSystem, withTenant, type Tx } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import { postJournal, type Actor } from "../src/core/ledger.js";
import { createAccount, suggestedTaxLine, taxLineOptions, updateAccount } from "../src/core/accounts.js";
import { profitAndLoss } from "../src/core/statements.js";
import { bookkeeper, pool, setupCaliforniaBusiness } from "./helpers.js";

const accountant: Actor = { id: "user:acct", role: "accountant" };

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

async function business() {
  const { org, entity } = await setupCaliforniaBusiness();
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const add = (code: string, name: string, kind: string, taxLine: string | null = null, actor = accountant) =>
    t((tx) => createAccount(tx, { orgId: org.id, entityId: entity.id, code, name, kind, taxLine, actor }));
  const update = (accountId: string, patch: { name?: string; taxLine?: string | null; active?: boolean }, actor = accountant) =>
    t((tx) => updateAccount(tx, { orgId: org.id, entityId: entity.id, accountId, ...patch, actor }));
  const post = (dr: string, cr: string, amount: string) => t((tx) => postJournal(tx, {
    orgId: org.id, entityId: entity.id, date: "2026-03-01", sourceType: "journal_voucher", idempotencyKey: crypto.randomUUID(), actor: bookkeeper,
    lines: [{ account: dr, debit: amount }, { account: cr, credit: amount }],
  }));
  const idOf = async (code: string) => (await t((tx) => tx.query("SELECT id FROM accounts WHERE entity_id = $1 AND code = $2", [entity.id, code]))).rows[0].id as string;
  return { org, entity, t, add, update, post, idOf };
}

describe("chart of accounts", () => {
  it("offers only the template's tax lines for the entity's return, by account type", () => {
    const opts = taxLineOptions("us-service", "sch_c");
    expect(opts.expense.find((o) => o.code === "SchC.L8")?.usedBy).toEqual(["Advertising"]);
    expect(opts.expense.some((o) => o.code.startsWith("1120"))).toBe(false);
    expect(suggestedTaxLine("us-service", "sch_c", "operating_expense")).toBe("SchC.L8");
    expect(suggestedTaxLine("us-service", "f1120s", "bank")).toBe("1120S.L.L1");
  });

  it("adds accounts that post and report on their statement line", async () => {
    const b = await business();
    await b.add("6550", "Continuing education", "operating_expense", "SchC.L27a");
    await b.add("1020", "Payroll checking", "bank");
    await b.post("6550", "1020", "250.00");
    const pl = await b.t((tx) => profitAndLoss(tx, b.entity.id, "2026-01-01", "2026-12-31"));
    expect(pl.sections.find((s) => s.key === "operating_expenses")!.rows).toEqual([expect.objectContaining({ code: "6550", amountMinor: 25000n })]);
    const row = (await b.t((tx) => tx.query("SELECT type, subtype, statement_line, tax_line FROM accounts WHERE entity_id = $1 AND code = '1020'", [b.entity.id]))).rows[0];
    expect(row).toEqual({ type: "asset", subtype: "bank", statement_line: "BS.CurrentAssets.Cash", tax_line: null });

    await expectLedgerError(b.add("6550", "Again", "operating_expense"), "INVALID");
    await expectLedgerError(b.add("65a", "Bad code", "operating_expense"), "INVALID");
    await expectLedgerError(b.add("6560", "Wrong return", "operating_expense", "1120.L26"), "INVALID");
    await expectLedgerError(b.add("6570", "Revenue line on expense", "operating_expense", "SchC.L1"), "INVALID");
    await expectLedgerError(b.add("6580", "No kind", "receivable"), "INVALID");
    await expectLedgerError(b.add("6590", "By bookkeeper", "operating_expense", null, bookkeeper), "FORBIDDEN");
  });

  it("renames, remaps, and deactivates only at a zero balance", async () => {
    const b = await business();
    const ads = await b.idOf("6000");
    await b.update(ads, { name: "Marketing", taxLine: null });
    expect((await b.t((tx) => tx.query("SELECT name, tax_line FROM accounts WHERE id = $1", [ads]))).rows[0]).toEqual({ name: "Marketing", tax_line: null });

    await b.post("6000", "1000", "40.00");
    await expectLedgerError(b.update(ads, { active: false }), "INVALID");
    await b.post("1000", "6000", "40.00");
    await b.update(ads, { active: false });
    await expectLedgerError(b.post("6000", "1000", "1.00"), "INACTIVE_ACCOUNT");
    await b.update(ads, { active: true });
    await b.post("6000", "1000", "1.00");

    // Accounts the system posts to stay on.
    await expectLedgerError(b.update(await b.idOf("1100"), { active: false }), "INVALID");
    const audit = await b.t((tx) => tx.query("SELECT action FROM audit_events WHERE entity_id = $1 AND object_type = 'account' ORDER BY seq", [b.entity.id]));
    expect(audit.rows.map((r) => r.action)).toEqual(["account.updated", "account.deactivated", "account.reactivated"]);
  });

  it("holds in the database: statement lines suit the type, identity never changes, no deletes", async () => {
    const b = await business();
    const sys = <T>(fn: (tx: Tx) => Promise<T>) => withSystem(pool, fn);
    const insert = (code: string, type: string, line: string) => sys((tx) => tx.query(
      `INSERT INTO accounts (org_id, entity_id, code, name, type, subtype, statement_line, cash_flow_class) VALUES ($1, $2, $3, 'x', $4, 'x', $5, 'operating')`,
      [b.org.id, b.entity.id, code, type, line],
    ));
    await expect(insert("6999", "expense", "BS.CurrentAssets.Cash")).rejects.toThrow(/does not suit/);
    await expect(insert("1999", "asset", "IS.Revenue")).rejects.toThrow(/does not suit/);
    await expect(insert("x1", "expense", "IS.OperatingExpenses")).rejects.toThrow(/3 to 6 digits/);
    const ads = await b.idOf("6000");
    await expect(sys((tx) => tx.query("UPDATE accounts SET code = '6001' WHERE id = $1", [ads]))).rejects.toThrow(/IMMUTABLE/);
    await expect(sys((tx) => tx.query("UPDATE accounts SET type = 'asset', statement_line = 'BS.CurrentAssets.Other' WHERE id = $1", [ads]))).rejects.toThrow(/IMMUTABLE/);
    await expect(sys((tx) => tx.query("UPDATE accounts SET statement_line = 'BS.CurrentAssets.Cash' WHERE id = $1", [ads]))).rejects.toThrow(/does not suit/);
    await expect(sys((tx) => tx.query("DELETE FROM accounts WHERE id = $1", [ads]))).rejects.toThrow(/IMMUTABLE/);
    await b.post("6000", "1000", "5.00");
    await expect(sys((tx) => tx.query("UPDATE accounts SET is_active = false WHERE id = $1", [ads]))).rejects.toThrow(/has a balance/);
    await expect(sys((tx) => tx.query("UPDATE accounts SET is_active = false WHERE entity_id = $1 AND code = '1000'", [b.entity.id]))).rejects.toThrow(/used by the system/);
  });
});
