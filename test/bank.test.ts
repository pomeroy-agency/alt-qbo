import { describe, expect, it } from "vitest";
import { withSystem, withTenant, type Tx } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import {
  categorizeBankLine, importBankCsv, listBankLines, matchBankLine, parseCsv, parseStatementAmount, parseStatementDate,
  readStatement, setBankLineExcluded, undoBankLine,
} from "../src/core/bank.js";
import { createContact, getDocument, issueDocument } from "../src/core/documents.js";
import { accountBalance } from "../src/core/reports.js";
import { bookkeeper, pool, setupCaliforniaBusiness } from "./helpers.js";

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

const STATEMENT = `Date,Description,Amount
03/02/2026,ACME CORP ACH DEPOSIT,"1,500.00"
03/03/2026,ADOBE CREATIVE CLOUD,-59.99
03/03/2026,ADOBE CREATIVE CLOUD,-59.99
03/05/2026,PIXEL FREELANCE,(850.00)
03/06/2026,Coffee,abc
`;

async function business() {
  const { org, entity } = await setupCaliforniaBusiness();
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const imp = (csv = STATEMENT, bankAccount = "1000") =>
    t((tx) => importBankCsv(tx, { orgId: org.id, entityId: entity.id, bankAccount, csv, fileName: "march.csv", actor: bookkeeper }));
  const lines = (status?: "new" | "posted" | "excluded") => t((tx) => listBankLines(tx, { entityId: entity.id, bankAccount: "1000", status }));
  return { org, entity, t, imp, lines };
}

describe("statement parsing", () => {
  it("reads quoted CSV, US dates and the usual amount formats", () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n\r\n1,2,3')).toEqual([["a", "b,c", 'd "e"'], ["1", "2", "3"]]);
    expect(parseStatementDate("3/2/26")).toBe("2026-03-02");
    expect(parseStatementDate("2026-03-02")).toBe("2026-03-02");
    expect(parseStatementDate("02/03/2026", "DMY")).toBe("2026-03-02");
    expect(parseStatementDate("13/45/2026")).toBeNull();
    expect(parseStatementDate("02/30/2026")).toBeNull();
    expect(parseStatementAmount("1,234.50")).toBe(123450n);
    expect(parseStatementAmount("$45")).toBe(4500n);
    expect(parseStatementAmount("(45.00)")).toBe(-4500n);
    expect(parseStatementAmount("-$3.1")).toBe(-310n);
    expect(parseStatementAmount("12.345")).toBeNull();
  });

  it("handles separate withdrawal and deposit columns", () => {
    const { rows, unreadable } = readStatement("Posted Date,Payee,Withdrawals,Deposits\n2026-04-01,Rent,2000.00,\n2026-04-02,Client,,300.00\n2026-04-03,Nothing,,\n");
    expect(rows.map((r) => r.amountMinor)).toEqual([-200000n, 30000n]);
    expect(unreadable).toEqual([4]);
  });
});

describe("bank import", () => {
  it("imports lines, keeps genuine same-day repeats, and skips them on re-import", async () => {
    const b = await business();
    const first = await b.imp();
    expect(first).toMatchObject({ added: 4, duplicates: 0, unreadableRows: [6] });
    const again = await b.imp(STATEMENT + "03/07/2026,CLIENT B,200.00\n");
    expect(again).toMatchObject({ added: 1, duplicates: 4 });
    expect(await b.lines("new")).toHaveLength(5);
  });

  it("refuses a non-bank account and read-only users", async () => {
    const b = await business();
    await expectLedgerError(b.imp(STATEMENT, "4000"), "INVALID");
    await expectLedgerError(b.t((tx) => importBankCsv(tx, { orgId: b.org.id, entityId: b.entity.id, bankAccount: "1000", csv: STATEMENT, actor: { id: "user:v", role: "read_only" } })), "FORBIDDEN");
  });
});

describe("bank review", () => {
  it("suggests and matches open invoices and bills, and learns categories", async () => {
    const b = await business();
    const [cust, vend] = await b.t(async (tx) => [
      await createContact(tx, { orgId: b.org.id, entityId: b.entity.id, kind: "customer", name: "Acme Corp", actor: bookkeeper }),
      await createContact(tx, { orgId: b.org.id, entityId: b.entity.id, kind: "vendor", name: "Pixel Freelance", actor: bookkeeper }),
    ]);
    const [inv, bill] = await b.t(async (tx) => [
      await issueDocument(tx, { orgId: b.org.id, entityId: b.entity.id, kind: "invoice", contactId: cust!.id, issueDate: "2026-02-15", idempotencyKey: "i", actor: bookkeeper, lines: [{ account: "4000", quantity: "1", unitPrice: "1500.00" }] }),
      await issueDocument(tx, { orgId: b.org.id, entityId: b.entity.id, kind: "bill", contactId: vend!.id, issueDate: "2026-03-01", idempotencyKey: "b", actor: bookkeeper, lines: [{ account: "5000", quantity: "1", unitPrice: "850.00" }] }),
    ]);
    await b.imp();
    const lines = await b.lines("new");
    const deposit = lines.find((l) => l.amountMinor === 150000n)!;
    const withdrawal = lines.find((l) => l.amountMinor === -85000n)!;
    expect(deposit.suggestion).toMatchObject({ kind: "invoice", documentId: inv!.id });
    expect(withdrawal.suggestion).toMatchObject({ kind: "bill", documentId: bill!.id });

    // A deposit can't pay a bill.
    await expectLedgerError(b.t((tx) => matchBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: deposit.id, documentId: bill!.id, actor: bookkeeper })), "INVALID");
    const m = await b.t((tx) => matchBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: deposit.id, documentId: inv!.id, actor: bookkeeper }));
    expect(m).toMatchObject({ status: "posted", documentNumber: "INV-1001" });
    await b.t((tx) => matchBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: withdrawal.id, documentId: bill!.id, actor: bookkeeper }));
    expect((await b.t((tx) => getDocument(tx, inv!.id))).status).toBe("paid");
    // Recording the same line twice is refused.
    await expectLedgerError(b.t((tx) => matchBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: deposit.id, documentId: inv!.id, actor: bookkeeper })), "INVALID");

    const [adobe1, adobe2] = lines.filter((l) => l.description.startsWith("ADOBE"));
    await expectLedgerError(b.t((tx) => categorizeBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: adobe1!.id, account: "1000", actor: bookkeeper })), "INVALID");
    await expectLedgerError(b.t((tx) => categorizeBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: adobe1!.id, account: "accounts_receivable", actor: bookkeeper })), "INVALID");
    await b.t((tx) => categorizeBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: adobe1!.id, account: "6000", actor: bookkeeper }));
    const next = (await b.lines("new")).find((l) => l.id === adobe2!.id)!;
    expect(next.suggestion).toMatchObject({ kind: "account", account: "6000" });

    const bal = await b.t(async (tx) => ({
      cash: await accountBalance(tx, b.entity.id, "1000", "2026-12-31"),
      ar: await accountBalance(tx, b.entity.id, "accounts_receivable", "2026-12-31"),
      ap: await accountBalance(tx, b.entity.id, "accounts_payable", "2026-12-31"),
      exp: await accountBalance(tx, b.entity.id, "6000", "2026-12-31"),
    }));
    expect(bal).toEqual({ cash: 150000n - 85000n - 5999n, ar: 0n, ap: 0n, exp: 5999n });
  });

  it("excludes and restores unrecorded lines, and undoes a categorisation by reversal", async () => {
    const b = await business();
    await b.imp();
    const [line] = (await b.lines("new")).filter((l) => l.description.startsWith("ADOBE"));
    const ex = await b.t((tx) => setBankLineExcluded(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: line!.id, excluded: true, actor: bookkeeper }));
    expect(ex.status).toBe("excluded");
    await expectLedgerError(b.t((tx) => categorizeBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: line!.id, account: "6000", actor: bookkeeper })), "INVALID");
    await b.t((tx) => setBankLineExcluded(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: line!.id, excluded: false, actor: bookkeeper }));
    await b.t((tx) => categorizeBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: line!.id, account: "6000", actor: bookkeeper }));
    await expectLedgerError(b.t((tx) => setBankLineExcluded(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: line!.id, excluded: true, actor: bookkeeper })), "INVALID");
    const undone = await b.t((tx) => undoBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: line!.id, date: "2026-03-10", reason: "Wrong category", actor: bookkeeper }));
    expect(undone.status).toBe("new");
    const again = await b.t((tx) => categorizeBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: line!.id, account: "6500", actor: bookkeeper }));
    expect(again).toMatchObject({ status: "posted", categoryAccount: "6500" });
    expect(await b.t((tx) => accountBalance(tx, b.entity.id, "6000", "2026-12-31"))).toBe(0n);
  });
});

describe("database rules, bypassing the service", () => {
  it("refuses edits, deletes, a mismatched entry, and re-imports of the same line", async () => {
    const b = await business();
    await b.imp();
    const [line, other] = await b.lines("new");
    const sys = <T>(fn: (tx: Tx) => Promise<T>) => withSystem(pool, fn);
    await expect(sys((tx) => tx.query("UPDATE bank_lines SET amount_minor = 1 WHERE id = $1", [line!.id]))).rejects.toThrow(/IMMUTABLE/);
    await expect(sys((tx) => tx.query("DELETE FROM bank_lines WHERE id = $1", [line!.id]))).rejects.toThrow(/IMMUTABLE/);
    // Pointing a line at an entry for a different amount.
    const posted = await b.t((tx) => categorizeBankLine(tx, { orgId: b.org.id, entityId: b.entity.id, lineId: other!.id, account: "6000", actor: bookkeeper }));
    await expect(sys((tx) => tx.query("UPDATE bank_lines SET status = 'posted', entry_id = $2 WHERE id = $1", [line!.id, posted.entryId]))).rejects.toThrow(/INVALID|duplicate key/);
    await expect(sys((tx) => tx.query("UPDATE bank_lines SET status = 'new', entry_id = NULL, category_account_id = NULL WHERE id = $1", [other!.id]))).rejects.toThrow(/reverse its entry first/);
    const dup = await sys((tx) => tx.query("SELECT import_id, bank_account_id, dedupe_key FROM bank_lines WHERE id = $1", [line!.id]));
    await expect(sys((tx) => tx.query(
      `INSERT INTO bank_lines (org_id, entity_id, bank_account_id, import_id, txn_date, description, amount_minor, dedupe_key)
       VALUES ($1, $2, $3, $4, '2026-03-02', 'x', 1, $5)`,
      [b.org.id, b.entity.id, dup.rows[0].bank_account_id, dup.rows[0].import_id, dup.rows[0].dedupe_key],
    ))).rejects.toThrow(/duplicate key/);
  });
});
