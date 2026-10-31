import { describe, expect, it } from "vitest";
import { withSystem, withTenant, type Tx } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import { createContact, getDocument, listDocuments, recordPayment } from "../src/core/documents.js";
import {
  acceptEstimate, createEstimate, createRecurring, declineEstimate, emailDocument, emailEstimate, formatAmount, listEstimates, listRecurring,
  nextDate, reminderStage, runRecurring, sendInvoiceReminders, setCustomerEmailSettings, stopRecurring, viewByToken,
} from "../src/core/invoicing.js";
import type { RateLookup } from "../src/core/sales-tax.js";
import type { MailMessage } from "../src/app/mail.js";
import { handleApi } from "../src/app/api.js";
import { bookkeeper, owner, pool, setupCaliforniaBusiness } from "./helpers.js";

const SF = { line1: "1 Market St", city: "San Francisco", state: "CA", zip: "94105" };
const lookup: RateLookup = async () => ({ rate: "0.08625", jurisdiction: "San Francisco, San Francisco County" });

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

async function business() {
  const { org, entity } = await setupCaliforniaBusiness();
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const base = { orgId: org.id, entityId: entity.id };
  const [customer, vendor] = await t(async (tx) => [
    await createContact(tx, { ...base, kind: "customer", name: "Acme Corp", email: "ap@acme.example", address: SF, actor: bookkeeper }),
    await createContact(tx, { ...base, kind: "vendor", name: "Office Landlord", actor: bookkeeper }),
  ]);
  const sent: MailMessage[] = [];
  const mailer = async (m: MailMessage) => { sent.push(m); };
  return { org, entity, t, base, customer: customer!, vendor: vendor!, sent, mailer };
}

const lines = [
  { account: "4000", description: "Brand workshop", quantity: "1", unitPrice: "1200.00", taxCategory: "professional_service" },
  { account: "4000", description: "Printed style guides", quantity: "2", unitPrice: "50.00", taxCategory: "printed_materials" },
];

describe("schedules", () => {
  it("keeps to the anchor day through short months", () => {
    expect(nextDate("2026-01-31", "monthly", 31)).toBe("2026-02-28");
    expect(nextDate("2026-02-28", "monthly", 31)).toBe("2026-03-31");
    expect(nextDate("2026-11-15", "quarterly", 15)).toBe("2027-02-15");
    expect(nextDate("2028-02-29", "yearly", 29)).toBe("2029-02-28");
    expect(nextDate("2026-12-28", "weekly", 28)).toBe("2027-01-04");
  });

  it("picks the latest reminder stage reached, so a late start sends one, not a backlog", () => {
    expect(reminderStage("2026-05-10", "2026-05-06")).toBeNull();
    expect(reminderStage("2026-05-10", "2026-05-07")).toBe("due-3");
    expect(reminderStage("2026-05-10", "2026-05-10")).toBe("due-3");
    expect(reminderStage("2026-05-10", "2026-05-11")).toBe("over-1");
    expect(reminderStage("2026-05-10", "2026-05-24")).toBe("over-14");
    expect(reminderStage("2026-01-10", "2026-05-24")).toBe("over-30");
  });

  it("formats money for customers", () => {
    expect(formatAmount(130724n)).toBe("$1,307.24");
    expect(formatAmount(5n, "CAD")).toBe("CA$0.05");
  });
});

describe("estimates", () => {
  it("prices an estimate with sales tax, without touching the books, and turns it into an invoice", async () => {
    const b = await business();
    const est = await b.t((tx) => createEstimate(tx, { ...b.base, contactId: b.customer.id, issueDate: "2026-04-01", lines, lookup, actor: bookkeeper }));
    expect(est).toMatchObject({ number: "EST-1001", expiryDate: "2026-05-01", subtotalMinor: 130000n, taxMinor: 863n, totalMinor: 130863n });
    expect(await b.t((tx) => listDocuments(tx, b.entity.id, "invoice"))).toHaveLength(0);

    const { estimate, invoice } = await b.t((tx) => acceptEstimate(tx, { ...b.base, estimateId: est.id, issueDate: "2026-04-10", lookup, actor: bookkeeper }));
    expect(estimate).toMatchObject({ status: "accepted", invoiceId: invoice.id, invoiceNumber: invoice.number });
    expect(invoice).toMatchObject({ totalMinor: 130863n, issueDate: "2026-04-10", dueDate: "2026-05-10", memo: "From estimate EST-1001" });
    // Once decided, it stays decided.
    await expectLedgerError(b.t((tx) => declineEstimate(tx, { ...b.base, estimateId: est.id, actor: bookkeeper })), "INVALID");
    await expectLedgerError(b.t((tx) => acceptEstimate(tx, { ...b.base, estimateId: est.id, issueDate: "2026-04-11", lookup, actor: bookkeeper })), "INVALID");
  });

  it("shows no tax when it can't be worked out yet, and marks old open estimates expired", async () => {
    const b = await business();
    const noAddress = await b.t((tx) => createContact(tx, { ...b.base, kind: "customer", name: "Walk-in", actor: bookkeeper }));
    const est = await b.t((tx) => createEstimate(tx, { ...b.base, contactId: noAddress.id, issueDate: "2026-01-02", expiryDate: "2026-01-20", lines, actor: bookkeeper }));
    expect(est).toMatchObject({ taxMinor: 0n, totalMinor: 130000n });
    const [listed] = await b.t((tx) => listEstimates(tx, b.entity.id, "2026-02-01"));
    expect(listed!.status).toBe("expired");
    const declined = await b.t((tx) => declineEstimate(tx, { ...b.base, estimateId: est.id, actor: bookkeeper }));
    expect(declined.status).toBe("declined");
  });

  it("can't be edited, and needs a customer and a writer", async () => {
    const b = await business();
    await expectLedgerError(b.t((tx) => createEstimate(tx, { ...b.base, contactId: b.vendor.id, issueDate: "2026-04-01", lines, actor: bookkeeper })), "INVALID");
    await expectLedgerError(b.t((tx) => createEstimate(tx, { ...b.base, contactId: b.customer.id, issueDate: "2026-04-01", lines, actor: { id: "user:v", role: "read_only" } })), "FORBIDDEN");
    const est = await b.t((tx) => createEstimate(tx, { ...b.base, contactId: b.customer.id, issueDate: "2026-04-01", lines, lookup, actor: bookkeeper }));
    await expect(b.t((tx) => tx.query("UPDATE estimates SET memo = 'changed' WHERE id = $1", [est.id]))).rejects.toThrow(/IMMUTABLE/);
  });

  it("emails an estimate with a view link the customer can open", async () => {
    const b = await business();
    const est = await b.t((tx) => createEstimate(tx, { ...b.base, contactId: b.customer.id, issueDate: "2026-04-01", lines, lookup, actor: bookkeeper }));
    await emailEstimate(pool, { orgId: b.org.id, estimateId: est.id, mailer: b.mailer, appUrl: "https://app.example", actor: bookkeeper });
    expect(b.sent[0]).toMatchObject({ to: "ap@acme.example", fromName: "Sunset Design Studio LLC", subject: "Estimate EST-1001 from Sunset Design Studio LLC: $1,308.63" });
    const token = /view\.html#([\w-]+)/.exec(b.sent[0]!.text)![1]!;
    const view = await viewByToken(pool, token);
    expect(view).toMatchObject({ kind: "estimate", number: "EST-1001", customer: "Acme Corp", totalMinor: 130863n });
  });
});

describe("emailing invoices", () => {
  async function invoiced() {
    // Dated in the past on purpose: reminders run with their own "today".
    const b = await business();
    const { invoice } = await b.t(async (tx) => {
      const est = await createEstimate(tx, { ...b.base, contactId: b.customer.id, issueDate: "2026-03-01", lines, lookup, actor: bookkeeper });
      return acceptEstimate(tx, { ...b.base, estimateId: est.id, issueDate: "2026-03-01", dueDate: "2026-03-31", lookup, actor: bookkeeper });
    });
    return { ...b, invoice };
  }

  it("sends the invoice from the business's name, replies to its owner, and logs it", async () => {
    const b = await invoiced();
    await withSystem(pool, async (tx) => {
      const u = (await tx.query("INSERT INTO users (email, name, password_hash) VALUES ($1, 'Owner', 'x') RETURNING id", [`owner-${b.org.id}@example.com`])).rows[0];
      await tx.query("INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')", [u.id, b.org.id]);
    });
    const r = await emailDocument(pool, { orgId: b.org.id, documentId: b.invoice.id, mailer: b.mailer, appUrl: "https://app.example", actor: bookkeeper });
    expect(r.sentTo).toBe("ap@acme.example");
    const m = b.sent[0]!;
    expect(m.subject).toBe(`Invoice ${b.invoice.number} from Sunset Design Studio LLC: $1,308.63 due March 31, 2026`);
    expect(m.replyTo).toBe(`owner-${b.org.id}@example.com`);
    expect(m.html).toContain("View or print invoice");
    // A business's own reply-to address wins.
    await b.t((tx) => setCustomerEmailSettings(tx, { ...b.base, replyTo: "billing@sunset.example", actor: owner }));
    await emailDocument(pool, { orgId: b.org.id, documentId: b.invoice.id, mailer: b.mailer, to: "someone@else.example", actor: bookkeeper });
    expect(b.sent[1]).toMatchObject({ to: "someone@else.example", replyTo: "billing@sunset.example" });
    const logged = await b.t((tx) => tx.query("SELECT kind, sent_to FROM customer_emails WHERE document_id = $1 ORDER BY sent_at", [b.invoice.id]));
    expect(logged.rows.map((x) => x.sent_to)).toEqual(["ap@acme.example", "someone@else.example"]);

    const token = /view\.html#([\w-]+)/.exec(m.text)![1]!;
    expect(await viewByToken(pool, token)).toMatchObject({ kind: "invoice", number: b.invoice.number, dueMinor: 130863n, business: { name: "Sunset Design Studio LLC" } });
    expect(await viewByToken(pool, "not-a-real-token-at-all-000")).toBeNull();
  });

  it("refuses without email set up, or without an address for the customer", async () => {
    const b = await invoiced();
    await expectLedgerError(emailDocument(pool, { orgId: b.org.id, documentId: b.invoice.id, actor: bookkeeper }), "INVALID");
    await b.t((tx) => tx.query("UPDATE contacts SET email = NULL WHERE id = $1", [b.customer.id]));
    await expectLedgerError(emailDocument(pool, { orgId: b.org.id, documentId: b.invoice.id, mailer: b.mailer, actor: bookkeeper }), "INVALID");
  });

  it("sends each reminder stage once, only when turned on, and stops when the invoice is paid", async () => {
    const b = await invoiced();
    const run = (today: string) => sendInvoiceReminders(pool, { today, mailer: b.mailer, appUrl: "https://app.example" });
    expect((await run("2026-03-29")).sent).toBe(0); // off by default
    await b.t((tx) => setCustomerEmailSettings(tx, { ...b.base, reminders: true, actor: owner }));
    await expectLedgerError(b.t((tx) => setCustomerEmailSettings(tx, { ...b.base, reminders: false, actor: bookkeeper })), "FORBIDDEN");
    const mine = () => b.sent.filter((m) => m.subject.includes(b.invoice.number));
    await run("2026-03-29");
    await run("2026-03-29");
    expect(mine()).toHaveLength(1);
    expect(mine()[0]!.subject).toContain("is due March 31, 2026");
    await run("2026-04-01");
    expect(mine()).toHaveLength(2);
    expect(mine()[1]!.subject).toContain("was due March 31, 2026");
    await b.t((tx) => recordPayment(tx, { ...b.base, documentId: b.invoice.id, date: "2026-04-03", amount: "1308.63", idempotencyKey: "p1", actor: bookkeeper }));
    await run("2026-04-07");
    expect(mine()).toHaveLength(2);
  });
});

describe("recurring invoices and bills", () => {
  it("issues on schedule, catches up, emails the invoice, never twice, and stops at the end date", async () => {
    const b = await business();
    const t = await b.t((tx) => createRecurring(tx, {
      ...b.base, kind: "invoice", contactId: b.customer.id, lines: [lines[0]!], frequency: "monthly", startDate: "2026-01-31",
      endDate: "2026-03-31", email: true, dueDays: 15, memo: "Monthly retainer", actor: bookkeeper,
    }));
    expect(t).toMatchObject({ nextDate: "2026-01-31", active: true, issuedCount: 0 });
    const first = await runRecurring(pool, { today: "2026-02-28", lookup, mailer: b.mailer });
    expect(first).toMatchObject({ issued: 2, failed: 0 });
    const again = await runRecurring(pool, { today: "2026-02-28", lookup, mailer: b.mailer });
    expect(again.issued).toBe(0);
    const docs = await b.t((tx) => listDocuments(tx, b.entity.id, "invoice"));
    expect(docs.map((d) => [d.issueDate, d.dueDate, d.memo]).sort()).toEqual([
      ["2026-01-31", "2026-02-15", "Monthly retainer"], ["2026-02-28", "2026-03-15", "Monthly retainer"],
    ]);
    expect(b.sent.filter((m) => m.to === "ap@acme.example")).toHaveLength(2);
    await runRecurring(pool, { today: "2026-06-01", lookup, mailer: b.mailer });
    const [after] = await b.t((tx) => listRecurring(tx, b.entity.id));
    expect(after).toMatchObject({ issuedCount: 3, active: false, nextDate: "2026-04-30" });
  });

  it("records recurring bills, keeps a failure on the template, and can be stopped", async () => {
    const b = await business();
    const bill = await b.t((tx) => createRecurring(tx, {
      ...b.base, kind: "bill", contactId: b.vendor.id, lines: [{ account: "6100", description: "Rent", quantity: "1", unitPrice: "2500.00" }],
      frequency: "monthly", startDate: "2026-02-01", actor: bookkeeper,
    }));
    await runRecurring(pool, { today: "2026-02-01" });
    expect((await b.t((tx) => listDocuments(tx, b.entity.id, "bill"))).map((d) => d.totalMinor)).toEqual([250000n]);
    // March is locked, so the March 1 bill can't post: the error stays on the template and the date doesn't move.
    await withSystem(pool, (tx) => tx.query("UPDATE periods SET status = 'locked' WHERE entity_id = $1 AND start_date = '2026-03-01'", [b.entity.id]));
    const r = await runRecurring(pool, { today: "2026-03-01", mailer: b.mailer });
    expect(r).toMatchObject({ issued: 0, failed: 1 });
    const [tpl] = await b.t((tx) => listRecurring(tx, b.entity.id));
    expect(tpl).toMatchObject({ nextDate: "2026-03-01", issuedCount: 1 });
    expect(tpl!.lastError).toMatch(/locked|closed/i);
    const stopped = await b.t((tx) => stopRecurring(tx, { ...b.base, templateId: bill.id, actor: bookkeeper }));
    expect(stopped.active).toBe(false);
    await expectLedgerError(b.t((tx) => stopRecurring(tx, { ...b.base, templateId: bill.id, actor: bookkeeper })), "INVALID");
  });

  it("checks the contact and lines", async () => {
    const b = await business();
    await expectLedgerError(b.t((tx) => createRecurring(tx, { ...b.base, kind: "invoice", contactId: b.vendor.id, lines, frequency: "monthly", startDate: "2026-02-01", actor: bookkeeper })), "INVALID");
    await expectLedgerError(b.t((tx) => createRecurring(tx, { ...b.base, kind: "bill", contactId: b.vendor.id, lines: [{ description: "x", quantity: "1", unitPrice: "1.00" }], frequency: "monthly", startDate: "2026-02-01", actor: bookkeeper })), "INVALID");
  });
});

describe("the API", () => {
  it("serves a view link without signing in, and refuses a bad one", async () => {
    const res = await handleApi(new Request("https://app.example/api/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "nope-nope-nope-nope-nope" }) }), pool);
    expect(res.status).toBe(404);
  });
});

void getDocument;
