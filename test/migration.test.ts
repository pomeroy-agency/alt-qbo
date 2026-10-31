import { describe, expect, it } from "vitest";
import { withTenant, type Tx } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import { importChart, importContacts, importOpenDocuments, importOpeningBalances, migrationStatus, parseReportDate } from "../src/core/migration.js";
import { listContacts, listDocuments, recordPayment } from "../src/core/documents.js";
import { balanceSheet } from "../src/core/statements.js";
import { accountant, bookkeeper, pool, setupCaliforniaBusiness } from "./helpers.js";

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

async function business() {
  const { org, entity } = await setupCaliforniaBusiness(`Move Co ${Math.random()}`);
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  return { org, entity, t, base: { orgId: org.id, entityId: entity.id, actor: accountant } };
}

// Shaped like QuickBooks Online's report exports: title rows, grouped sections, totals.
const QBO_CHART = `Sunset Design LLC
Account List

Account,Type,Detail type,Description,Balance
Checking,Bank,Checking,,"12,500.00"
Accounts Receivable (A/R),Accounts receivable (A/R),Accounts Receivable (A/R),,"1,500.00"
Camera gear,Fixed Assets,Machinery & Equipment,,"4,000.00"
Accounts Payable (A/P),Accounts payable (A/P),Accounts Payable (A/P),,800.00
Chase Ink,Credit Card,Credit Card,,350.00
Loan from Mike,Long Term Liabilities,Notes Payable,,"5,000.00"
Opening Balance Equity,Equity,Opening Balance Equity,,0.00
Retained Earnings,Equity,Retained Earnings,,
Design income,Income,Service/Fee Income,,
Software:Adobe,Expenses,Office/General Administrative Expenses,,
Mystery,Weird Type,,,
`;

const QBO_CUSTOMERS = `Customer Contact List
Customer,Phone Numbers,Email,Full Name,Billing Address
Acme Corp,Phone: (559) 555-0100,ap@acme.example,Jo Acme,"12 Oak St, Fresno, CA 93701"
Bright Ltd,,not-an-email,,"Somewhere far"
`;

const QBO_OPEN_INVOICES = `Open Invoices
As of December 31, 2025

Date,Transaction type,Num,Term,Due date,Amount,Open balance
Acme Corp
11/03/2025,Invoice,1043,Net 30,12/03/2025,"1,000.00","1,000.00"
12/15/2025,Invoice,1051,Net 30,01/14/2026,500.00,500.00
12/20/2025,Payment,,,,-200.00,0.00
Total for Acme Corp,,,,,"1,300.00","1,500.00"
TOTAL,,,,,"1,300.00","1,500.00"
`;

const QBO_UNPAID_BILLS = `Unpaid Bills
Date,Transaction type,Num,Due date,Past due,Amount,Open balance
Staples
12/10/2025,Bill,INV-88,01/09/2026,0,800.00,800.00
Total for Staples,,,,,800.00,800.00
`;

const QBO_TRIAL_BALANCE = `Sunset Design LLC
Trial Balance
As of December 31, 2025

,Debit,Credit
Checking,"12,500.00",
Accounts Receivable (A/R),"1,500.00",
Camera gear,"4,000.00",
Accounts Payable (A/P),,800.00
Chase Ink,,350.00
Loan from Mike,,"5,000.00"
Retained Earnings,,"2,000.00"
Design income,,"40,000.00"
Software:Adobe,"30,150.00",
TOTAL,"$48,150.00","$48,150.00"
`;

describe("moving from QuickBooks Online", () => {
  it("brings in the chart, contacts, open invoices and bills, and a trial balance that ties out", async () => {
    const b = await business();
    const chart = await b.t((tx) => importChart(tx, { ...b.base, csv: QBO_CHART }));
    expect(chart.source).toBe("qbo");
    expect(chart.created.map((c) => c.name)).toEqual(["Checking", "Camera gear", "Chase Ink", "Loan from Mike", "Opening Balance Equity", "Design income", "Software - Adobe"]);
    expect(chart.matched.map((m) => m.to)).toEqual(["1100 Accounts receivable", "2000 Accounts payable", "3900 Retained earnings"]);
    expect(chart.skipped).toEqual([{ name: "Mystery", reason: expect.stringMatching(/unknown account type/) }]);
    // Running it again changes nothing.
    const again = await b.t((tx) => importChart(tx, { ...b.base, csv: QBO_CHART }));
    expect(again.created).toEqual([]);

    const people = await b.t((tx) => importContacts(tx, { ...b.base, csv: QBO_CUSTOMERS }));
    expect(people.created).toEqual(["Acme Corp", "Bright Ltd"]);
    expect(people.notes.map((n) => n.name)).toEqual(["Bright Ltd", "Bright Ltd"]);
    const acme = (await b.t((tx) => listContacts(tx, b.entity.id))).find((c) => c.name === "Acme Corp")!;
    expect(acme).toMatchObject({ kind: "customer", email: "ap@acme.example", address: { line1: "12 Oak St", city: "Fresno", state: "CA", zip: "93701" } });

    const inv = await b.t((tx) => importOpenDocuments(tx, { ...b.base, csv: QBO_OPEN_INVOICES, kind: "invoice", startDate: "2026-01-01" }));
    expect(inv.created.map((d) => [d.contact, d.number, d.openMinor])).toEqual([["Acme Corp", "1043", 100000n], ["Acme Corp", "1051", 50000n]]);
    expect(inv.skipped).toEqual([{ row: "Acme Corp", reason: expect.stringMatching(/payment/) }]);
    const bills = await b.t((tx) => importOpenDocuments(tx, { ...b.base, csv: QBO_UNPAID_BILLS, kind: "bill", startDate: "2026-01-01" }));
    expect(bills).toMatchObject({ totalMinor: 80000n, newContacts: ["Staples"] });
    // Re-importing the same report doesn't double up.
    await b.t((tx) => importOpenDocuments(tx, { ...b.base, csv: QBO_OPEN_INVOICES, kind: "invoice", startDate: "2026-01-01" }));
    const docs = await b.t((tx) => listDocuments(tx, b.entity.id, "invoice", "2026-01-31"));
    expect(docs).toHaveLength(2);
    expect(docs.find((d) => d.dueDate === "2026-01-14")).toBeDefined();

    const open = await b.t((tx) => importOpeningBalances(tx, { ...b.base, csv: QBO_TRIAL_BALANCE, startDate: "2026-01-01", rollIncome: true }));
    expect(open.unmatched).toEqual([]);
    expect(open.warnings).toEqual([]);
    expect(open.plugMinor).toBe(0n);
    expect(open.receivables).toEqual({ trialBalanceMinor: 150000n, documentsMinor: 150000n });

    const bs = await b.t((tx) => balanceSheet(tx, b.entity.id, "2026-01-01"));
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssetsMinor).toBe(1800000n); // 12,500 cash + 1,500 receivables + 4,000 gear
    const flat = bs.sections.flatMap((s) => s.rows);
    expect(flat.find((r) => r.name === "Accounts receivable")!.amountMinor).toBe(150000n);
    expect(flat.find((r) => r.name === "Accounts payable")!.amountMinor).toBe(80000n);
    // 2025's 9,850 profit went into retained earnings with the 2,000 already there.
    expect(flat.find((r) => r.name === "Retained earnings")!.amountMinor).toBe(1185000n);
    const status = await b.t((tx) => migrationStatus(tx, b.entity.id));
    expect(status).toMatchObject({ source: "qbo", openInvoices: 2, openBills: 1, openingDate: "2026-01-01", clearing: [] });

    // An imported invoice is a real invoice: it can be paid.
    await b.t((tx) => recordPayment(tx, { orgId: b.org.id, entityId: b.entity.id, documentId: docs.find((d) => d.totalMinor === 100000n)!.id, date: "2026-01-10", amount: "1000.00", idempotencyKey: "p1", actor: bookkeeper }));

    await expectLedgerError(b.t((tx) => importOpeningBalances(tx, { ...b.base, csv: QBO_TRIAL_BALANCE, startDate: "2026-01-01" })), "INVALID");
  });

  it("reports accounts it can't find instead of guessing, and puts a mismatch in opening balance equity", async () => {
    const b = await business();
    const tb = `,Debit,Credit\nUnknown Bank,100.00,\nOwner's capital,,100.00\n`;
    const r = await b.t((tx) => importOpeningBalances(tx, { ...b.base, csv: tb, startDate: "2026-01-01" }));
    expect(r).toMatchObject({ entryId: null, unmatched: ["Unknown Bank"] });

    const tb2 = `,Debit,Credit\nOperating checking,700.00,\nAccounts receivable,300.00,\nOwner's capital,,"1,000.00"\n`;
    const r2 = await b.t((tx) => importOpeningBalances(tx, { ...b.base, csv: tb2, startDate: "2026-01-01" }));
    expect(r2.plugMinor).toBe(-30000n); // no open invoices came in, so 300 of receivables is missing
    expect(r2.warnings[0]).toMatch(/receivables total was \$300.00/);
    expect(r2.lines.map((l) => l.account)).toEqual(["1000", "3000", "3950"]);
  });

  it("is for owners, admins and accountants only", async () => {
    const b = await business();
    await expectLedgerError(b.t((tx) => importChart(tx, { ...b.base, csv: QBO_CHART, actor: bookkeeper })), "FORBIDDEN");
    await expectLedgerError(b.t((tx) => importChart(tx, { ...b.base, csv: "a,b\n1,2\n" })), "INVALID");
  });
});

describe("moving from Xero", () => {
  it("reads Xero's chart, contacts and trial balance with account codes", async () => {
    const b = await business();
    const chart = `*Code,*Name,*Type,*Tax Code,Description,Dashboard,Expense Claims,Enable Payments,Balance
090,Business Bank Account,Bank,Tax Exempt (0%),,Yes,No,No,
610,Accounts Receivable,Current Asset,Tax Exempt (0%),,No,No,No,
800,Accounts Payable,Current Liability,Tax Exempt (0%),,No,No,No,
960,Retained Earnings,Equity,Tax Exempt (0%),,No,No,No,
200,Sales,Revenue,Tax on Sales,,No,No,No,
429,General Expenses,Expense,Tax on Purchases,,No,Yes,No,
720,Computer Equipment,Fixed Asset,Tax on Purchases,,No,No,No,
`;
    const c = await b.t((tx) => importChart(tx, { ...b.base, csv: chart }));
    expect(c.source).toBe("xero");
    expect(c.created.map((x) => x.name)).toEqual(["Business Bank Account", "Sales", "General Expenses", "Computer Equipment"]);
    expect(c.matched.map((x) => x.from)).toEqual(["Accounts Receivable", "Accounts Payable", "Retained Earnings"]);

    const contacts = `*ContactName,EmailAddress,POAddressLine1,POCity,PORegion,POPostalCode,POCountry
Maple Studio,hi@maple.example,1 Pine Rd,Vancouver,BC,V6B 1A1,Canada
Oak LLC,,500 Elm St,Fresno,CA,93701,USA
`;
    const p = await b.t((tx) => importContacts(tx, { ...b.base, csv: contacts, kind: "both" }));
    expect(p.created).toEqual(["Maple Studio", "Oak LLC"]);
    const maple = (await b.t((tx) => listContacts(tx, b.entity.id))).find((x) => x.name === "Maple Studio")!;
    expect(maple).toMatchObject({ kind: "both", address: { zip: "V6B 1A1", state: "BC" } });

    const invoices = `*ContactName,*InvoiceNumber,*InvoiceDate,*DueDate,Total,AmountDue,*Description
Oak LLC,INV-0007,20 Dec 2025,19 Jan 2026,250.00,250.00,Design
Oak LLC,INV-0007,20 Dec 2025,19 Jan 2026,250.00,250.00,Hosting
`;
    const inv = await b.t((tx) => importOpenDocuments(tx, { ...b.base, csv: invoices, kind: "invoice", startDate: "2026-01-01" }));
    expect(inv.created).toEqual([{ contact: "Oak LLC", number: "INV-0007", openMinor: 25000n }]);

    const tb = `Trial Balance
Demo Company (US)
As at 31 December 2025

Account,Account Code,Debit - Year to date,Credit - Year to date
Revenue
Sales (200),200,,"1,000.00"
Expenses
General Expenses (429),429,400.00,
Assets
Business Bank Account (090),090,850.00,
Accounts Receivable (610),610,250.00,
Liabilities
Retained Earnings (960),960,,500.00
Total,,"1,500.00","1,500.00"
`;
    const r = await b.t((tx) => importOpeningBalances(tx, { ...b.base, csv: tb, startDate: "2026-01-01" }));
    expect(r).toMatchObject({ unmatched: [], warnings: [], plugMinor: 0n });
    // Without rolling income up, the 2025 lines land as they are (for a mid-year switch).
    expect(r.lines.some((l) => l.creditMinor === 100000n)).toBe(true);
  });

  it("reads the date styles reports use", () => {
    expect(parseReportDate("20 Dec 2025")).toBe("2025-12-20");
    expect(parseReportDate("Dec 20, 2025")).toBe("2025-12-20");
    expect(parseReportDate("12/20/2025")).toBe("2025-12-20");
    expect(parseReportDate("2025-12-20")).toBe("2025-12-20");
    expect(parseReportDate("31 Feb 2025")).toBeNull();
  });
});
