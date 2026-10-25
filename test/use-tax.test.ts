import { describe, expect, it } from "vitest";
import { withTenant, type Tx } from "../src/db/pool.js";
import { handleApi } from "../src/app/api.js";
import { LedgerError } from "../src/core/errors.js";
import { createContact, updateContact, voidDocument, type DocumentLineInput } from "../src/core/documents.js";
import { accountBalance } from "../src/core/reports.js";
import { decideUseTax, explainUseTax, recordBill, salesTaxReport, setBusinessAddress, type RateLookup } from "../src/core/sales-tax.js";
import { accountant, bookkeeper, owner, pool, setupCaliforniaBusiness } from "./helpers.js";

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

const STUDIO = { line1: "500 Howard St", city: "San Francisco", state: "CA", zip: "94105" };

function fakeLookup() {
  const calls: string[] = [];
  const lookup: RateLookup = async (a) => {
    calls.push(a.zip);
    if (a.zip.startsWith("941")) return { rate: "0.08625", jurisdiction: "San Francisco, San Francisco County" };
    throw new Error("no rate for that address");
  };
  return { lookup, calls };
}

async function business({ address = true } = {}) {
  const { org, entity } = await setupCaliforniaBusiness();
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const base = { orgId: org.id, entityId: entity.id };
  if (address) await t((tx) => setBusinessAddress(tx, { ...base, address: STUDIO, actor: owner }));
  const vendor = (name: string, accrueUseTax = false) =>
    t((tx) => createContact(tx, { ...base, kind: "vendor", name, accrueUseTax, actor: bookkeeper }));
  const { lookup, calls } = fakeLookup();
  const bill = (contactId: string, lines: Omit<DocumentLineInput, "account">[], extra: Partial<Parameters<typeof recordBill>[1]> = {}) =>
    t((tx) => recordBill(tx, {
      ...base, contactId, issueDate: "2026-12-10", dueDate: "2027-01-09", idempotencyKey: crypto.randomUUID(), actor: bookkeeper, lookup,
      lines: lines.map((l) => ({ account: "6000", ...l })), ...extra,
    }));
  const balances = () => t(async (tx) => ({
    expense: await accountBalance(tx, entity.id, "6000", "2027-12-31"),
    payables: await accountBalance(tx, entity.id, "accounts_payable", "2027-12-31"),
    tax: await accountBalance(tx, entity.id, "sales_tax_payable", "2027-12-31"),
  }));
  return { org, entity, t, base, vendor, bill, balances, lookup, calls };
}

const JAN_2027 = { servicePeriodStart: "2027-01-01", servicePeriodEnd: "2027-12-31" };

describe("use tax on bills", () => {
  it("accrues use tax on software for 2027 from a vendor that doesn't charge California tax", async () => {
    const b = await business();
    const saas = await b.vendor("Out-of-State SaaS Inc", true);
    expect(saas.accrueUseTax).toBe(true);

    const doc = await b.bill(saas.id, [
      { description: "Design app, 2027 seats", quantity: "1", unitPrice: "1200.00", taxCategory: "prewritten_software", ...JAN_2027 },
      { description: "Onboarding call", quantity: "1", unitPrice: "300.00", taxCategory: "professional_service" },
    ]);
    // The vendor is owed the bill as written; the use tax is owed to the state.
    expect(doc).toMatchObject({
      subtotalMinor: 150000n, taxMinor: 0n, totalMinor: 150000n,
      useTaxRate: "0.08625", useTaxMinor: 10350n, useTaxSource: "lookup",
      useTaxJurisdiction: "San Francisco, San Francisco County", useTaxAddress: "500 Howard St, San Francisco, CA 94105",
    });
    expect(doc.lines.map((l) => [l.useTaxable, l.useTaxMinor])).toEqual([[true, 10350n], [false, 0n]]);
    expect(doc.lines[0]).toMatchObject({ taxCategory: "prewritten_software", servicePeriodStart: "2027-01-01" });
    // The use tax is part of what the software cost.
    expect(await b.balances()).toEqual({ expense: 160350n, payables: -150000n, tax: -10350n });
  });

  it("doesn't accrue on software for 2026 access, and asks for the access date near the change", async () => {
    const b = await business();
    const saas = await b.vendor("SaaS Co", true);
    const doc = await b.bill(saas.id, [{ quantity: "1", unitPrice: "100.00", taxCategory: "prewritten_software", servicePeriodStart: "2026-12-01", servicePeriodEnd: "2026-12-31" }]);
    expect(doc).toMatchObject({ useTaxSource: "not_taxable", useTaxMinor: 0n, useTaxRate: "0.00000" });
    expect(b.calls).toEqual([]);
    // A December bill for software without an access date could be for 2027, so it isn't guessed.
    await expectLedgerError(b.bill(saas.id, [{ quantity: "1", unitPrice: "100.00", taxCategory: "prewritten_software" }]), "INVALID");
    // A period across January 1, 2027 has to be split.
    await expectLedgerError(b.bill(saas.id, [{ quantity: "1", unitPrice: "100.00", taxCategory: "prewritten_software", servicePeriodStart: "2026-12-01", servicePeriodEnd: "2027-11-30" }]), "INVALID");
  });

  it("accrues on goods in 2026 when asked, and records plain bills as before", async () => {
    const b = await business();
    const supplier = await b.vendor("Nevada Paper Supply");
    // Not marked and not asked: an ordinary bill, no kinds needed.
    const plain = await b.bill(supplier.id, [{ quantity: "1", unitPrice: "100.00" }]);
    expect(plain).toMatchObject({ useTaxSource: "none", useTaxMinor: 0n });
    expect(plain.lines[0]!.taxCategory).toBeNull();
    // Asked for this bill: the goods line accrues.
    const accrued = await b.bill(supplier.id, [{ quantity: "2", unitPrice: "50.00", taxCategory: "goods" }], { useTax: true, issueDate: "2026-06-01", dueDate: "2026-07-01" });
    expect(accrued).toMatchObject({ useTaxMinor: 863n, totalMinor: 10000n });
    // A marked vendor's bill can still be recorded without use tax when this one was taxed.
    const marked = await b.vendor("Usually Untaxed", true);
    expect(await b.bill(marked.id, [{ quantity: "1", unitPrice: "100.00" }], { useTax: false })).toMatchObject({ useTaxSource: "none", useTaxMinor: 0n });
    // Every line needs a kind once use tax is on.
    await expectLedgerError(b.bill(marked.id, [{ quantity: "1", unitPrice: "100.00" }]), "INVALID");
  });

  it("needs the business address, and lets only an owner or accountant set the rate by hand", async () => {
    const b = await business({ address: false });
    const saas = await b.vendor("SaaS Co", true);
    const lines = [{ quantity: "1", unitPrice: "1000.00", taxCategory: "prewritten_software", ...JAN_2027 }];
    await expect(b.bill(saas.id, lines)).rejects.toThrow(/business address/);
    const manual = { ratePercent: "9.5", reason: "Oakland office; rate from the CDTFA website" };
    await expectLedgerError(b.bill(saas.id, lines, { manual }), "FORBIDDEN");
    const doc = await b.bill(saas.id, lines, { manual, actor: accountant });
    expect(doc).toMatchObject({ useTaxSource: "manual", useTaxRate: "0.09500", useTaxMinor: 9500n, useTaxNote: manual.reason });
    expect(explainUseTax({ rate: doc.useTaxRate, source: "manual", jurisdiction: null, address: null, note: doc.useTaxNote }))
      .toBe("Use tax 9.5%, set by hand: Oakland office; rate from the CDTFA website. You owe it to the CDTFA, not the vendor.");
  });

  it("replays a retried bill without looking the rate up again", async () => {
    const b = await business();
    const saas = await b.vendor("SaaS Co", true);
    const key = crypto.randomUUID();
    const lines = [{ quantity: "1", unitPrice: "1000.00", taxCategory: "prewritten_software", ...JAN_2027 }];
    const first = await b.bill(saas.id, lines, { idempotencyKey: key });
    const again = await b.bill(saas.id, lines, { idempotencyKey: key, lookup: async () => { throw new Error("should not be called"); } });
    expect(again).toMatchObject({ id: first.id, replayed: true, useTaxMinor: 8625n });
    expect(b.calls).toEqual(["94105"]);
  });

  it("previews the same answer it records", async () => {
    const b = await business();
    const d = await b.t((tx) => decideUseTax(tx, {
      entityId: b.entity.id, date: "2027-02-01", categories: ["prewritten_software", "custom_software", "goods"], lookup: b.lookup,
    }));
    expect(d).toMatchObject({ source: "lookup", rate: "0.08625", taxable: [true, false, true], rules: "us-ca-sales-tax-2027@2027.1.0" });
    expect(explainUseTax(d)).toBe("Use tax 8.625% on taxable lines, the rate for San Francisco, San Francisco County (500 Howard St, San Francisco, CA 94105). You owe it to the CDTFA, not the vendor.");
  });

  it("puts use tax on the return figures, and drops a voided bill", async () => {
    const b = await business();
    const saas = await b.vendor("SaaS Co", true);
    const kept = await b.bill(saas.id, [{ quantity: "1", unitPrice: "1000.00", taxCategory: "prewritten_software", ...JAN_2027 }]);
    const voided = await b.bill(saas.id, [{ quantity: "1", unitPrice: "500.00", taxCategory: "prewritten_software", ...JAN_2027 }]);
    await b.t((tx) => voidDocument(tx, { ...b.base, documentId: voided.id, date: "2026-12-20", reason: "duplicate", actor: bookkeeper }));
    const r = await b.t((tx) => salesTaxReport(tx, b.entity.id, "2026-10-01", "2026-12-31"));
    expect(r.useTax).toEqual({
      purchasesMinor: 100000n, taxMinor: 8625n,
      byJurisdiction: [{ jurisdiction: "San Francisco, San Francisco County", ratePercent: "8.625", purchasesMinor: 100000n, taxMinor: 8625n, bills: 1 }],
    });
    expect(r.totalSalesMinor).toBe(0n);
    expect(r.payableMinor).toBe(kept.useTaxMinor);
  });

  it("lets a vendor be marked from the contact", async () => {
    const b = await business();
    const v = await b.vendor("Some Vendor");
    const marked = await b.t((tx) => updateContact(tx, { ...b.base, contactId: v.id, accrueUseTax: true, actor: bookkeeper }));
    expect(marked.accrueUseTax).toBe(true);
  });
});

describe("use tax API", () => {
  const { lookup } = fakeLookup();
  const call = async (path: string, init: { body?: unknown; cookie?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.cookie) headers.cookie = init.cookie;
    const res = await handleApi(
      new Request("https://alt-qbo.test" + path, { method: init.body !== undefined ? "POST" : "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
      pool, { signupCode: "c", taxRates: lookup },
    );
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* CSV */ }
    return { status: res.status, data, cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };

  it("marks a vendor, previews and records a bill with use tax, and reports it", async () => {
    const su = await call("/api/auth/signup", { body: { name: "T", email: `use${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Use Co", inviteCode: "c" } });
    const cookie = su.cookie!;
    const orgId = (await call("/api/me", { cookie })).data.orgs[0].id;
    const ent = await call(`/api/orgs/${orgId}/entities`, { cookie, body: { legalName: "Use Studio LLC", entityType: "llc_single", region: "CA", firstFiscalYear: 2026 } });
    const base = `/api/orgs/${orgId}/entities/${ent.data.id}`;
    expect((await call(`${base}/address`, { cookie, body: { address: STUDIO } })).status).toBe(200);

    const vendor = await call(`${base}/contacts`, { cookie, body: { kind: "vendor", name: "SaaS Inc", accrueUseTax: true } });
    expect(vendor.data.accrueUseTax).toBe(true);
    const lines = [{ account: "6000", description: "Seats", quantity: "1", unitPrice: "2000.00", taxCategory: "prewritten_software", ...JAN_2027 }];

    const preview = await call(`${base}/bills/use-tax-preview`, { cookie, body: { issueDate: "2026-12-10", lines } });
    expect(preview.data).toMatchObject({ source: "lookup", rate: "0.08625", taxable: [true] });
    expect(preview.data.explanation).toMatch(/^Use tax 8.625%/);

    const bill = await call(`${base}/bills`, { cookie, body: { contactId: vendor.data.id, issueDate: "2026-12-10", dueDate: "2027-01-09", lines } });
    expect(bill.status).toBe(201);
    expect(bill.data).toMatchObject({ totalMinor: "200000", useTaxMinor: "17250" });

    const csv = await call(`${base}/reports/sales-tax?from=2026-10-01&to=2026-12-31&format=csv`, { cookie });
    expect(csv.data).toContain("Purchases subject to use tax,2000.00");
    expect(csv.data).toContain("Use tax owed on purchases,172.50");
    expect(csv.data).toContain("Sales and use tax payable on 2026-12-31,172.50");
  });
});
