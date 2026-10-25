import { describe, expect, it } from "vitest";
import { withTenant, type Tx } from "../src/db/pool.js";
import { postJournal } from "../src/core/ledger.js";
import { createContact, issueDocument } from "../src/core/documents.js";
import { importBankCsv } from "../src/core/bank.js";
import {
  balanceSheet, balanceSheetCsv, booksHealth, fiscalYearStart, generalLedger, generalLedgerCsv, profitAndLoss, profitAndLossCsv,
} from "../src/core/statements.js";
import { bookkeeper, pool, setupCaliforniaBusiness } from "./helpers.js";

async function business() {
  const { org, entity } = await setupCaliforniaBusiness();
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const post = (date: string, dr: string, cr: string, amount: string, memo = "") => t((tx) => postJournal(tx, {
    orgId: org.id, entityId: entity.id, date, memo, sourceType: "journal_voucher", idempotencyKey: crypto.randomUUID(), actor: bookkeeper,
    lines: [{ account: dr, debit: amount }, { account: cr, credit: amount }],
  }));
  await post("2026-01-02", "1000", "3000", "10000.00", "Owner capital");
  await post("2026-01-15", "1000", "4000", "4000.00", "Website project");
  await post("2026-01-20", "5000", "1000", "1000.00", "Subcontractor");
  await post("2026-02-01", "6400", "2100", "1500.00", "Rent on card");
  await post("2026-02-10", "1000", "4900", "12.34", "Interest");
  await post("2026-03-05", "7900", "1000", "50.00", "Loan interest");
  return { org, entity, t, post };
}

describe("financial statements", () => {
  it("builds a profit and loss with gross, operating and net income", async () => {
    const b = await business();
    const pl = await b.t((tx) => profitAndLoss(tx, b.entity.id, "2026-01-01", "2026-02-28"));
    expect(pl.sections.map((s) => [s.key, s.totalMinor])).toEqual([
      ["revenue", 400000n], ["cost_of_revenue", 100000n], ["operating_expenses", 150000n], ["other_income", 1234n], ["other_expense", 0n],
    ]);
    expect(pl).toMatchObject({ grossProfitMinor: 300000n, operatingIncomeMinor: 150000n, netIncomeMinor: 151234n });
    const jan = await b.t((tx) => profitAndLoss(tx, b.entity.id, "2026-01-01", "2026-01-31"));
    expect(jan.netIncomeMinor).toBe(300000n);
    expect(profitAndLossCsv(pl)).toContain("Net income,,,1512.34");
  });

  it("builds a balance sheet that balances, with this year's earnings in equity", async () => {
    const b = await business();
    const bs = await b.t((tx) => balanceSheet(tx, b.entity.id, "2026-12-31"));
    expect(bs.totalAssetsMinor).toBe(1000000n + 400000n - 100000n + 1234n - 5000n);
    expect(bs.totalLiabilitiesMinor).toBe(150000n);
    expect(bs.currentYearEarningsMinor).toBe(146234n);
    expect(bs.priorYearsEarningsMinor).toBe(0n);
    expect(bs.balanced).toBe(true);
    expect(balanceSheetCsv(bs)).toContain("Current year earnings,1462.34");
  });

  it("starts the fiscal year in the entity's first month", () => {
    expect(fiscalYearStart("2026-03-15", 1)).toBe("2026-01-01");
    expect(fiscalYearStart("2026-03-15", 7)).toBe("2025-07-01");
    expect(fiscalYearStart("2026-07-01", 7)).toBe("2026-07-01");
  });

  it("shows a general ledger with opening and running balances", async () => {
    const b = await business();
    const gl = await b.t((tx) => generalLedger(tx, b.entity.id, "1000", "2026-01-10", "2026-02-28"));
    expect(gl.openingMinor).toBe(1000000n);
    expect(gl.lines.map((l) => l.balanceMinor)).toEqual([1400000n, 1300000n, 1301234n]);
    expect(gl.closingMinor).toBe(1301234n);
    const card = await b.t((tx) => generalLedger(tx, b.entity.id, "2100", "2026-01-01", "2026-12-31"));
    expect(card.closingMinor).toBe(150000n);
    expect(generalLedgerCsv(gl).trim().split("\n")).toHaveLength(6);
  });
});

describe("books health", () => {
  it("flags unreviewed bank lines, unreconciled accounts, overdue invoices and open past months", async () => {
    const b = await business();
    const cust = await b.t((tx) => createContact(tx, { orgId: b.org.id, entityId: b.entity.id, kind: "customer", name: "Acme", actor: bookkeeper }));
    await b.t((tx) => issueDocument(tx, { orgId: b.org.id, entityId: b.entity.id, kind: "invoice", contactId: cust.id, issueDate: "2026-02-01", dueDate: "2026-03-01", idempotencyKey: "i", actor: bookkeeper, lines: [{ account: "4000", quantity: "1", unitPrice: "10.00" }] }));
    await b.t((tx) => importBankCsv(tx, { orgId: b.org.id, entityId: b.entity.id, bankAccount: "1000", csv: "Date,Description,Amount\n2026-03-01,Fee,-5.00\n", actor: bookkeeper }));
    const h = await b.t((tx) => booksHealth(tx, b.entity.id, "2026-06-15"));
    const by = Object.fromEntries(h.map((c) => [c.key, c]));
    expect(by.trial_balance!.ok).toBe(true);
    expect(by.balance_sheet!.ok).toBe(true);
    expect(by.bank_review).toMatchObject({ ok: false, detail: "1 imported bank line still need recording." });
    expect(by.reconciled!.detail).toContain("1000 Operating checking");
    expect(by.overdue_invoices).toMatchObject({ ok: false, warn: true });
    expect(by.periods_closed).toMatchObject({ ok: false, detail: expect.stringContaining("4 months") });
    expect(by.ein!.ok).toBe(false);
  });
});
