import { describe, expect, it } from "vitest";
import { withSystem, withTenant, type Tx } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import { aging, createContact, getDocument, issueDocument, listDocuments, priceLine, recordPayment, voidDocument, type IssueDocumentInput } from "../src/core/documents.js";
import { accountBalance } from "../src/core/reports.js";
import { bookkeeper, pool, setupCaliforniaBusiness } from "./helpers.js";

const readOnly = { id: "user:viewer", role: "read_only" as const };

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

async function business() {
  const { org, entity } = await setupCaliforniaBusiness();
  const [customer, vendor] = await withTenant(pool, org.id, async (tx) => [
    await createContact(tx, { orgId: org.id, entityId: entity.id, kind: "customer", name: "Acme Corp", email: "ap@acme.example", actor: bookkeeper }),
    await createContact(tx, { orgId: org.id, entityId: entity.id, kind: "vendor", name: "Pixel Freelance", actor: bookkeeper }),
  ]);
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const invoice = (over: Partial<IssueDocumentInput> = {}): IssueDocumentInput => ({
    orgId: org.id, entityId: entity.id, kind: "invoice", contactId: customer!.id, issueDate: "2026-03-01", dueDate: "2026-03-31",
    tax: { rate: "0.0725", source: "manual", note: "test rate" }, idempotencyKey: crypto.randomUUID(), actor: bookkeeper,
    lines: [
      { account: "4000", description: "Brand workshop", quantity: "1", unitPrice: "1200.00", taxable: false },
      { account: "4000", description: "Printed style guides", quantity: "3", unitPrice: "33.33", taxable: true },
    ],
    ...over,
  });
  return { org, entity, customer: customer!, vendor: vendor!, t, invoice };
}

describe("line pricing", () => {
  it("rounds quantity x price and tax half-up to the cent", () => {
    expect(priceLine("3", 3333n, true, "0.0725")).toEqual({ amountMinor: 9999n, taxableMinor: null, taxMinor: 725n });
    expect(priceLine("2.5", 101n, true, "0.1")).toEqual({ amountMinor: 253n, taxableMinor: null, taxMinor: 25n });
    expect(priceLine("1", 50n, true, "0.1")).toEqual({ amountMinor: 50n, taxableMinor: null, taxMinor: 5n });
    expect(priceLine("1", 1000n, false, "0.0725")).toEqual({ amountMinor: 1000n, taxableMinor: null, taxMinor: 0n });
    // Only a share taxed (a multiple-points-of-use certificate): tax on that share.
    expect(priceLine("1", 1000n, true, "0.0725", "0.6")).toEqual({ amountMinor: 1000n, taxableMinor: 600n, taxMinor: 44n });
  });
});

describe("invoices", () => {
  it("issues an invoice with gapless numbers and posts receivables, revenue and sales tax", async () => {
    const b = await business();
    const [a, c] = await b.t(async (tx) => [await issueDocument(tx, b.invoice()), await issueDocument(tx, b.invoice())]);
    expect(a!.number).toBe("INV-1001");
    expect(c!.number).toBe("INV-1002");
    expect(a).toMatchObject({ subtotalMinor: 129999n, taxMinor: 725n, totalMinor: 130724n, status: "overdue", dueMinor: 130724n });
    expect(a!.lines).toHaveLength(2);

    const bal = await b.t(async (tx) => ({
      ar: await accountBalance(tx, b.entity.id, "accounts_receivable", "2026-12-31"),
      rev: await accountBalance(tx, b.entity.id, "4000", "2026-12-31"),
      tax: await accountBalance(tx, b.entity.id, "sales_tax_payable", "2026-12-31"),
    }));
    expect(bal).toEqual({ ar: 261448n, rev: -259998n, tax: -1450n });
  });

  it("returns the original invoice when a request is retried, and refuses a reused key", async () => {
    const b = await business();
    const input = b.invoice();
    const first = await b.t((tx) => issueDocument(tx, input));
    const again = await b.t((tx) => issueDocument(tx, input));
    expect(again.id).toBe(first.id);
    expect(again.replayed).toBe(true);
    await expectLedgerError(b.t((tx) => issueDocument(tx, { ...input, memo: "different" })), "IDEMPOTENCY_CONFLICT");
    expect(await b.t((tx) => listDocuments(tx, b.entity.id, "invoice", "2026-12-31"))).toHaveLength(1);
  });

  it("refuses bad input: no customer, vendor as customer, non-revenue account, zero total, read-only role", async () => {
    const b = await business();
    await expectLedgerError(b.t((tx) => issueDocument(tx, b.invoice({ contactId: crypto.randomUUID() }))), "INVALID");
    await expectLedgerError(b.t((tx) => issueDocument(tx, b.invoice({ contactId: b.vendor.id }))), "INVALID");
    await expectLedgerError(b.t((tx) => issueDocument(tx, b.invoice({ lines: [{ account: "6000", quantity: "1", unitPrice: "10.00" }] }))), "INVALID");
    await expectLedgerError(b.t((tx) => issueDocument(tx, b.invoice({ lines: [{ account: "1100", quantity: "1", unitPrice: "10.00" }] }))), "INVALID");
    await expectLedgerError(b.t((tx) => issueDocument(tx, b.invoice({ lines: [{ account: "4000", quantity: "1", unitPrice: "0.00" }] }))), "INVALID");
    await expectLedgerError(b.t((tx) => issueDocument(tx, b.invoice({ actor: readOnly }))), "FORBIDDEN");
    // Nothing above consumed an invoice number.
    expect((await b.t((tx) => issueDocument(tx, b.invoice()))).number).toBe("INV-1001");
  });

  it("takes partial payments, refuses overpayment, and reports status", async () => {
    const b = await business();
    const inv = await b.t((tx) => issueDocument(tx, b.invoice({ tax: undefined, lines: [{ account: "4000", quantity: "1", unitPrice: "1000.00" }] })));
    const pay = (amount: string, date = "2026-03-10") => b.t((tx) => recordPayment(tx, {
      orgId: b.org.id, entityId: b.entity.id, documentId: inv.id, date, amount, idempotencyKey: crypto.randomUUID(), actor: bookkeeper,
    }));
    const after = await pay("400.00");
    expect(after).toMatchObject({ paidMinor: 40000n, dueMinor: 60000n });
    await expectLedgerError(pay("600.01"), "OVERPAID");
    await expectLedgerError(pay("10.00", "2026-02-01"), "INVALID");
    const paid = await pay("600.00");
    expect(paid).toMatchObject({ status: "paid", dueMinor: 0n });
    expect(paid.payments).toHaveLength(2);

    const asOf = await b.t((tx) => listDocuments(tx, b.entity.id, "invoice", "2026-03-05"));
    expect(asOf[0]).toMatchObject({ status: "open", paidMinor: 0n });
    const cash = await b.t((tx) => accountBalance(tx, b.entity.id, "cash_operating", "2026-12-31"));
    expect(cash).toBe(100000n);
  });

  it("voids an unpaid invoice by reversal and refuses to void one with payments", async () => {
    const b = await business();
    const [inv, paidInv] = await b.t(async (tx) => [await issueDocument(tx, b.invoice()), await issueDocument(tx, b.invoice())]);
    await b.t((tx) => recordPayment(tx, { orgId: b.org.id, entityId: b.entity.id, documentId: paidInv!.id, date: "2026-03-02", amount: "1.00", idempotencyKey: "p1", actor: bookkeeper }));
    const v = await b.t((tx) => voidDocument(tx, { orgId: b.org.id, entityId: b.entity.id, documentId: inv!.id, date: "2026-03-05", reason: "Wrong client", actor: bookkeeper }));
    expect(v).toMatchObject({ status: "void", voidReason: "Wrong client" });
    expect(v.voidEntryId).toBeTruthy();
    await expectLedgerError(b.t((tx) => voidDocument(tx, { orgId: b.org.id, entityId: b.entity.id, documentId: paidInv!.id, date: "2026-03-05", reason: "x", actor: bookkeeper })), "INVALID");
    await expectLedgerError(b.t((tx) => recordPayment(tx, { orgId: b.org.id, entityId: b.entity.id, documentId: inv!.id, date: "2026-03-06", amount: "1.00", idempotencyKey: "p2", actor: bookkeeper })), "INVALID");
    const ar = await b.t((tx) => accountBalance(tx, b.entity.id, "accounts_receivable", "2026-12-31"));
    expect(ar).toBe(130724n - 100n);
  });
});

describe("bills", () => {
  it("records a bill against expense accounts and pays it from the bank", async () => {
    const b = await business();
    const bill = await b.t((tx) => issueDocument(tx, {
      orgId: b.org.id, entityId: b.entity.id, kind: "bill", contactId: b.vendor.id, issueDate: "2026-04-02", dueDate: "2026-05-02",
      reference: "PF-778", idempotencyKey: "bill-1", actor: bookkeeper,
      lines: [{ account: "5000", description: "Illustration", quantity: "10", unitPrice: "85.00", taxable: true }],
    }));
    expect(bill).toMatchObject({ number: "BILL-1", reference: "PF-778", taxMinor: 0n, totalMinor: 85000n });
    await b.t((tx) => recordPayment(tx, { orgId: b.org.id, entityId: b.entity.id, documentId: bill.id, date: "2026-04-20", amount: "850.00", bankAccount: "1000", idempotencyKey: "pay-bill-1", actor: bookkeeper }));
    const bal = await b.t(async (tx) => ({
      ap: await accountBalance(tx, b.entity.id, "accounts_payable", "2026-12-31"),
      cash: await accountBalance(tx, b.entity.id, "1000", "2026-12-31"),
      exp: await accountBalance(tx, b.entity.id, "5000", "2026-12-31"),
    }));
    expect(bal).toEqual({ ap: 0n, cash: -85000n, exp: 85000n });
    await expectLedgerError(b.t((tx) => issueDocument(tx, {
      orgId: b.org.id, entityId: b.entity.id, kind: "bill", contactId: b.customer.id, issueDate: "2026-04-02",
      idempotencyKey: "bill-2", actor: bookkeeper, lines: [{ account: "5000", quantity: "1", unitPrice: "1.00" }],
    })), "INVALID");
  });
});

describe("aging", () => {
  it("buckets what is still due by days past due", async () => {
    const b = await business();
    const mk = (due: string, price: string) => b.t((tx) => issueDocument(tx, b.invoice({ issueDate: "2026-01-02", dueDate: due, tax: undefined, lines: [{ account: "4000", quantity: "1", unitPrice: price }] })));
    await mk("2026-06-30", "100.00");
    await mk("2026-06-15", "200.00");
    await mk("2026-04-01", "300.00");
    const paid = await mk("2026-03-01", "400.00");
    await b.t((tx) => recordPayment(tx, { orgId: b.org.id, entityId: b.entity.id, documentId: paid.id, date: "2026-02-01", amount: "400.00", idempotencyKey: "a1", actor: bookkeeper }));
    const ag = await b.t((tx) => aging(tx, b.entity.id, "invoice", "2026-06-20"));
    expect(ag.buckets).toEqual({ current: 10000n, d1_30: 20000n, d31_60: 0n, d61_90: 30000n, over_90: 0n });
    expect(ag.totalMinor).toBe(60000n);
    expect(ag.rows.map((r) => r.daysPastDue)).toEqual([80, 5, 0]);
  });
});

describe("database rules, bypassing the service", () => {
  it("refuses edits to an issued invoice, its lines and its payments", async () => {
    const b = await business();
    const inv = await b.t((tx) => issueDocument(tx, b.invoice()));
    await b.t((tx) => recordPayment(tx, { orgId: b.org.id, entityId: b.entity.id, documentId: inv.id, date: "2026-03-02", amount: "5.00", idempotencyKey: "x1", actor: bookkeeper }));
    // Run as the owner connection, so only the triggers stand in the way.
    const sys = <T>(fn: (tx: Tx) => Promise<T>) => withSystem(pool, fn);
    await expect(sys((tx) => tx.query("UPDATE documents SET total_minor = 1, subtotal_minor = 1, tax_minor = 0 WHERE id = $1", [inv.id]))).rejects.toThrow(/IMMUTABLE/);
    await expect(sys((tx) => tx.query("UPDATE documents SET due_date = '2026-12-31' WHERE id = $1", [inv.id]))).rejects.toThrow(/IMMUTABLE/);
    await expect(sys((tx) => tx.query("UPDATE document_lines SET amount_minor = 1 WHERE document_id = $1", [inv.id]))).rejects.toThrow(/IMMUTABLE/);
    await expect(sys((tx) => tx.query("DELETE FROM document_payments WHERE document_id = $1", [inv.id]))).rejects.toThrow(/IMMUTABLE/);
    await expect(sys((tx) => tx.query("DELETE FROM documents WHERE id = $1", [inv.id]))).rejects.toThrow(/IMMUTABLE/);
    // A void that doesn't point at a reversal of the invoice's entry.
    await expect(sys((tx) => tx.query(
      "UPDATE documents SET status = 'void', void_entry_id = entry_id, void_date = '2026-03-03', void_reason = 'x' WHERE id = $1", [inv.id],
    ))).rejects.toThrow(/payments|reversal/);
    const after = await b.t((tx) => getDocument(tx, inv.id));
    expect(after.totalMinor).toBe(130724n);
  });

  it("refuses a document that is not in the books, or whose totals don't match its lines", async () => {
    const b = await business();
    const insertDoc = (tx: Tx, total: number) => tx.query(
      `INSERT INTO documents (org_id, entity_id, kind, number, contact_id, issue_date, due_date, currency,
          subtotal_minor, tax_minor, total_minor, idempotency_key, created_by)
       VALUES ($1, $2, 'invoice', $3, $4, '2026-03-01', '2026-03-01', 'USD', $5, 0, $5, $3, 'raw') RETURNING id`,
      [b.org.id, b.entity.id, `RAW-${total}`, b.customer.id, total],
    );
    // No lines and no entry: refused at commit.
    await expect(b.t((tx) => insertDoc(tx, 100))).rejects.toThrow(/no lines/);
    // Lines that don't add up to the total.
    const acct = (await b.t((tx) => tx.query("SELECT id FROM accounts WHERE entity_id = $1 AND code = '4000'", [b.entity.id]))).rows[0].id;
    await expect(b.t(async (tx) => {
      const { rows } = await insertDoc(tx, 200);
      await tx.query(
        `INSERT INTO document_lines (org_id, entity_id, document_id, line_no, account_id, quantity, unit_price_minor, amount_minor, tax_rate, tax_minor)
         VALUES ($1, $2, $3, 1, $4, 1, 150, 150, 0, 0)`,
        [b.org.id, b.entity.id, rows[0].id, acct],
      );
    })).rejects.toThrow(/totals do not match/);
    // A line whose amount isn't quantity x price.
    await expect(b.t(async (tx) => {
      const { rows } = await insertDoc(tx, 300);
      await tx.query(
        `INSERT INTO document_lines (org_id, entity_id, document_id, line_no, account_id, quantity, unit_price_minor, amount_minor, tax_rate, tax_minor)
         VALUES ($1, $2, $3, 1, $4, 2, 100, 300, 0, 0)`,
        [b.org.id, b.entity.id, rows[0].id, acct],
      );
    })).rejects.toThrow(/check constraint/);
    // Matching lines but never posted to the ledger.
    await expect(b.t(async (tx) => {
      const { rows } = await insertDoc(tx, 400);
      await tx.query(
        `INSERT INTO document_lines (org_id, entity_id, document_id, line_no, account_id, quantity, unit_price_minor, amount_minor, tax_rate, tax_minor)
         VALUES ($1, $2, $3, 1, $4, 1, 400, 400, 0, 0)`,
        [b.org.id, b.entity.id, rows[0].id, acct],
      );
    })).rejects.toThrow(/not posted/);
  });

  it("refuses a payment above what is due even when inserted directly", async () => {
    const b = await business();
    const inv = await b.t((tx) => issueDocument(tx, b.invoice({ tax: undefined, lines: [{ account: "4000", quantity: "1", unitPrice: "10.00" }] })));
    const bank = (await b.t((tx) => tx.query("SELECT id FROM accounts WHERE entity_id = $1 AND code = '1000'", [b.entity.id]))).rows[0].id;
    await expect(b.t((tx) => tx.query(
      `INSERT INTO document_payments (org_id, entity_id, document_id, payment_date, amount_minor, bank_account_id, entry_id, idempotency_key, created_by)
       VALUES ($1, $2, $3, '2026-03-02', 1001, $4, $5, 'raw', 'raw')`,
      [b.org.id, b.entity.id, inv.id, bank, inv.entryId],
    ))).rejects.toThrow(/OVERPAID/);
    // Within the amount due, but not backed by a payment entry.
    await expect(b.t((tx) => tx.query(
      `INSERT INTO document_payments (org_id, entity_id, document_id, payment_date, amount_minor, bank_account_id, entry_id, idempotency_key, created_by)
       VALUES ($1, $2, $3, '2026-03-02', 500, $4, $5, 'raw', 'raw')`,
      [b.org.id, b.entity.id, inv.id, bank, inv.entryId],
    ))).rejects.toThrow(/payment entry/);
  });

  it("keeps another organisation's invoices out of sight", async () => {
    const a = await business();
    const other = await business();
    const inv = await a.t((tx) => issueDocument(tx, a.invoice()));
    const seen = await other.t((tx) => tx.query("SELECT count(*)::int AS n FROM documents WHERE id = $1", [inv.id]));
    expect(seen.rows[0].n).toBe(0);
  });
});
