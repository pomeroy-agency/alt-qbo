import { describe, expect, it } from "vitest";
import { withSystem, withTenant, type Tx } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import { importBankCsv, listBankLines } from "../src/core/bank.js";
import { createBankRule, listBankRules, ruleMatches, switchOffBankRule } from "../src/core/bank-rules.js";
import { addAttachment, attachmentCounts, listAttachments, readAttachment, removeAttachment, sniffType } from "../src/core/attachments.js";
import { memoryStore } from "../src/core/nightly-backups.js";
import { createContact, issueDocument } from "../src/core/documents.js";
import { bookkeeper, pool, setupCaliforniaBusiness } from "./helpers.js";

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

async function business() {
  const { org, entity } = await setupCaliforniaBusiness();
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const base = { orgId: org.id, entityId: entity.id };
  const imp = (csv: string) => t((tx) => importBankCsv(tx, { ...base, bankAccount: "1000", csv, fileName: "s.csv", actor: bookkeeper }));
  const lines = (status?: "new" | "posted") => t((tx) => listBankLines(tx, { entityId: entity.id, bankAccount: "1000", status }));
  return { org, entity, t, base, imp, lines };
}

describe("bank rules", () => {
  it("matches on words, direction, amount and bank account", () => {
    const r = { match_text: "gusto", direction: "out" as const, min_minor: 1000n, max_minor: 50000n, bank_account_id: null };
    expect(ruleMatches(r, { description: "GUSTO PAYROLL FEE", amountMinor: -4500n, bankAccountId: "a" })).toBe(true);
    expect(ruleMatches(r, { description: "GUSTO REFUND", amountMinor: 4500n, bankAccountId: "a" })).toBe(false);
    expect(ruleMatches(r, { description: "GUSTO", amountMinor: -500n, bankAccountId: "a" })).toBe(false);
    expect(ruleMatches(r, { description: "ADOBE", amountMinor: -4500n, bankAccountId: "a" })).toBe(false);
    expect(ruleMatches({ ...r, bank_account_id: "b" }, { description: "GUSTO", amountMinor: -4500n, bankAccountId: "a" })).toBe(false);
  });

  it("suggests, or records on import, and a later rule never overrides an earlier one", async () => {
    const b = await business();
    await b.t((tx) => createBankRule(tx, { ...b.base, matchText: "Adobe", direction: "out", account: "6100", actor: bookkeeper }));
    await b.t((tx) => createBankRule(tx, { ...b.base, matchText: "Shell", direction: "out", account: "6000", autoRecord: true, memo: "Fuel", actor: bookkeeper }));
    await b.t((tx) => createBankRule(tx, { ...b.base, matchText: "Adobe Creative", account: "6000", autoRecord: true, actor: bookkeeper }));
    const r = await b.imp("Date,Description,Amount\n03/02/2026,ADOBE CREATIVE CLOUD,-54.99\n03/03/2026,SHELL OIL 1234,-40.00\n03/04/2026,CLIENT DEPOSIT,500.00\n");
    expect(r).toMatchObject({ added: 3, autoRecorded: 1 });
    const posted = await b.lines("posted");
    expect(posted.map((l) => [l.description, l.categoryAccount])).toEqual([["SHELL OIL 1234", "6000"]]);
    const fresh = await b.lines("new");
    const adobe = fresh.find((l) => l.description.startsWith("ADOBE"))!;
    expect(adobe.suggestion).toMatchObject({ kind: "account", account: "6100" });
    expect(fresh.find((l) => l.description === "CLIENT DEPOSIT")!.suggestion).toBeNull();
    const rules = await b.t((tx) => listBankRules(tx, b.entity.id));
    expect(rules.find((x) => x.matchText === "Shell")!.appliedCount).toBe(1);
  });

  it("leaves a line for review when its month is locked, and can be switched off", async () => {
    const b = await business();
    const rule = await b.t((tx) => createBankRule(tx, { ...b.base, matchText: "Shell", account: "6000", autoRecord: true, actor: bookkeeper }));
    await withSystem(pool, (tx) => tx.query("UPDATE periods SET status = 'locked' WHERE entity_id = $1 AND start_date = '2026-03-01'", [b.entity.id]));
    const r = await b.imp("Date,Description,Amount\n03/03/2026,SHELL OIL,-40.00\n04/03/2026,SHELL OIL,-41.00\n");
    expect(r).toMatchObject({ added: 2, autoRecorded: 1 });
    expect((await b.lines("new")).map((l) => l.date)).toEqual(["2026-03-03"]);
    await b.t((tx) => switchOffBankRule(tx, { ...b.base, ruleId: rule.id, actor: bookkeeper }));
    // With the rule off, the older "same as earlier" suggestion takes over.
    expect((await b.lines("new"))[0]!.suggestion!.label).toMatch(/^Same as earlier/);
  });

  it("refuses bank and receivable accounts", async () => {
    const b = await business();
    await expectLedgerError(b.t((tx) => createBankRule(tx, { ...b.base, matchText: "Transfer", account: "1010", actor: bookkeeper })), "INVALID");
    await expectLedgerError(b.t((tx) => createBankRule(tx, { ...b.base, matchText: "Client", account: "accounts_receivable", actor: bookkeeper })), "INVALID");
    await expectLedgerError(b.t((tx) => createBankRule(tx, { ...b.base, matchText: "x", account: "6000", actor: bookkeeper })), "INVALID");
  });
});

describe("receipts and files", () => {
  const PDF = new TextEncoder().encode("%PDF-1.4\n% a receipt\n");
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  it("knows a file by its bytes, not its name", () => {
    expect(sniffType(PDF)).toBe("application/pdf");
    expect(sniffType(JPEG)).toBe("image/jpeg");
    expect(sniffType(new TextEncoder().encode("<html><script>"))).toBeNull();
  });

  it("attaches a receipt to a bill, checks it on the way out, and removes it", async () => {
    const b = await business();
    const store = memoryStore();
    const vendor = await b.t((tx) => createContact(tx, { ...b.base, kind: "vendor", name: "Staples", actor: bookkeeper }));
    const bill = await b.t((tx) => issueDocument(tx, {
      ...b.base, kind: "bill", contactId: vendor.id, issueDate: "2026-03-01", idempotencyKey: "b1", actor: bookkeeper,
      lines: [{ account: "6000", description: "Paper", quantity: "1", unitPrice: "20.00" }],
    }));
    const a = await b.t((tx) => addAttachment(tx, store, { ...b.base, objectType: "document", objectId: bill.id, fileName: "receipt.pdf", data: PDF, actor: bookkeeper }));
    expect(a).toMatchObject({ contentType: "application/pdf", sizeBytes: PDF.length, fileName: "receipt.pdf" });
    expect(await b.t((tx) => attachmentCounts(tx, b.entity.id, "document"))).toEqual({ [bill.id]: 1 });
    const back = await b.t((tx) => readAttachment(tx, store, b.entity.id, a.id));
    expect(Buffer.from(back.data).toString()).toContain("a receipt");

    // A changed file is caught.
    store.data.set(`${b.org.id}/${a.id}`, new TextEncoder().encode("%PDF-1.4 tampered"));
    await expectLedgerError(b.t((tx) => readAttachment(tx, store, b.entity.id, a.id)), "INVALID");

    await expectLedgerError(b.t((tx) => addAttachment(tx, store, { ...b.base, objectType: "document", objectId: bill.id, fileName: "x.html", data: new TextEncoder().encode("<html>"), actor: bookkeeper })), "INVALID");
    await expectLedgerError(b.t((tx) => addAttachment(tx, store, { ...b.base, objectType: "document", objectId: crypto.randomUUID(), fileName: "r.pdf", data: PDF, actor: bookkeeper })), "INVALID");
    await expectLedgerError(b.t((tx) => addAttachment(tx, store, { ...b.base, objectType: "document", objectId: bill.id, fileName: "r.pdf", data: PDF, actor: { id: "user:v", role: "read_only" } })), "FORBIDDEN");

    await b.t((tx) => removeAttachment(tx, store, { ...b.base, attachmentId: a.id, actor: bookkeeper }));
    expect(await b.t((tx) => listAttachments(tx, b.entity.id, "document", bill.id))).toEqual([]);
    expect(store.data.has(`${b.org.id}/${a.id}`)).toBe(false);
    await expect(b.t((tx) => tx.query("DELETE FROM attachments WHERE id = $1", [a.id]))).rejects.toThrow();
  });
});
