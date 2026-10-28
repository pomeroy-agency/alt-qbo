import { describe, expect, it } from "vitest";
import { withSystem, withTenant, type Tx } from "../src/db/pool.js";
import { handleApi } from "../src/app/api.js";
import { LedgerError } from "../src/core/errors.js";
import { createContact, voidDocument } from "../src/core/documents.js";
import { issueInvoice, recordBill, setBusinessAddress, type RateLookup } from "../src/core/sales-tax.js";
import { prepareSalesTaxReturn, returnPeriod, returnPeriods, salesTaxSettings, setSalesTaxSettings } from "../src/core/sales-tax-return.js";
import { accountant, bookkeeper, owner, pool, setupCaliforniaBusiness } from "./helpers.js";

const SF = { line1: "1 Market St", city: "San Francisco", state: "CA", zip: "94105" };
const lookup: RateLookup = async (a) => {
  if (a.zip.startsWith("941")) return { rate: "0.08625", jurisdiction: "San Francisco, San Francisco County" };
  throw new Error("no rate for that address");
};

describe("sales tax return periods", () => {
  it("are due the last day of the month after the period, moved past weekends and holidays", () => {
    expect(returnPeriod("2027-Q1")).toMatchObject({ label: "Q1 2027", from: "2027-01-01", to: "2027-03-31", dueDate: "2027-04-30" });
    // July 31, 2027 is a Saturday.
    expect(returnPeriod("2027-Q2").dueDate).toBe("2027-08-02");
    // January 31, 2027 is a Sunday.
    expect(returnPeriod("2026-Q4").dueDate).toBe("2027-02-01");
    expect(returnPeriod("2027-M01")).toMatchObject({ label: "January 2027", to: "2027-01-31", dueDate: "2027-03-01" });
    expect(returnPeriod("2027")).toMatchObject({ from: "2027-01-01", to: "2027-12-31", dueDate: "2028-01-31" });
    expect(returnPeriod("FY2027")).toMatchObject({ from: "2026-07-01", to: "2027-06-30", dueDate: "2027-08-02" });
    expect(returnPeriod("2027-Q1P").prepayments).toEqual([
      { month: "January", from: "2027-01-01", to: "2027-01-31", dueDate: "2027-02-24" },
      { month: "February", from: "2027-02-01", to: "2027-02-28", dueDate: "2027-03-24" },
    ]);
    // The second quarter's second prepayment runs to June 15.
    expect(returnPeriod("2027-Q2P").prepayments?.[1]).toEqual({ month: "May and June 1-15", from: "2027-05-01", to: "2027-06-15", dueDate: "2027-06-24" });
    expect(() => returnPeriod("2027-Q5")).toThrow(LedgerError);
    expect(() => returnPeriod("2027-M13")).toThrow(LedgerError);
  });

  it("lists the periods that have started, newest first", () => {
    expect(returnPeriods("quarterly", 2027, "2027-05-10").map((p) => p.key)).toEqual(["2027-Q2", "2027-Q1"]);
    expect(returnPeriods("monthly", 2027, "2027-02-03").map((p) => p.key)).toEqual(["2027-M02", "2027-M01"]);
    expect(returnPeriods("quarterly_prepay", 2026, "2027-01-05")).toHaveLength(4);
    expect(returnPeriods("yearly", 2027, "2026-12-01")).toEqual([]);
  });
});

describe("the business's own sales tax", () => {
  async function business() {
    const { org, entity } = await setupCaliforniaBusiness();
    const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
    const base = { orgId: org.id, entityId: entity.id };
    return { org, entity, t, base };
  }

  it("records the seller's permit and filing frequency, for owners, admins and accountants", async () => {
    const b = await business();
    await expect(b.t((tx) => setSalesTaxSettings(tx, { ...b.base, sellerPermit: "SR AB 1-2", actor: bookkeeper }))).rejects.toThrow(/cannot change sales tax/);
    await expect(b.t((tx) => setSalesTaxSettings(tx, { ...b.base, filingFrequency: "weekly", actor: owner }))).rejects.toThrow(/how often/);
    await expect(b.t((tx) => setSalesTaxSettings(tx, { ...b.base, sellerPermit: "12", actor: owner }))).rejects.toThrow(/seller's permit/);
    expect(await b.t((tx) => setSalesTaxSettings(tx, { ...b.base, sellerPermit: " sr  ab 100-200300 ", filingFrequency: "quarterly", actor: accountant })))
      .toEqual({ sellerPermit: "SR AB 100-200300", filingFrequency: "quarterly" });
    // Changing one leaves the other alone; an empty value clears it.
    await b.t((tx) => setSalesTaxSettings(tx, { ...b.base, filingFrequency: "monthly", actor: owner }));
    expect(await b.t((tx) => salesTaxSettings(tx, b.entity.id))).toEqual({ sellerPermit: "SR AB 100-200300", filingFrequency: "monthly" });
    await b.t((tx) => setSalesTaxSettings(tx, { ...b.base, sellerPermit: "", actor: owner }));
    expect((await b.t((tx) => salesTaxSettings(tx, b.entity.id))).sellerPermit).toBeNull();
    const audit = await b.t((tx) => tx.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'entity.sales_tax_settings_set' AND entity_id = $1", [b.entity.id]));
    expect(audit.rows[0].n).toBe(3);
  });

  it("prepares the return: deductions, state and district tax, prepayments and what to check", async () => {
    const b = await business();
    const contact = (name: string, extra = {}) => b.t((tx) => createContact(tx, { ...b.base, kind: "customer", name, address: SF, actor: bookkeeper, ...extra }));
    const sf = await contact("SF Client");
    const reseller = await contact("Reseller", { resalePermit: "SR 1" });
    let k = 0;
    const issue = (contactId: string, lines: Record<string, string>[], date: string) =>
      b.t((tx) => issueInvoice(tx, {
        ...b.base, contactId, issueDate: date, idempotencyKey: `r${++k}`, actor: bookkeeper, lookup,
        lines: lines.map((l) => ({ quantity: "1", account: "4000", ...l })),
      }));
    // October: SaaS for 2027 access is taxed; a professional service isn't.
    await issue(sf.id, [
      { taxCategory: "prewritten_software", unitPrice: "1000.00", servicePeriodStart: "2027-01-01", servicePeriodEnd: "2027-01-31" },
      { taxCategory: "professional_service", unitPrice: "200.00" },
    ], "2026-10-05");
    await issue(reseller.id, [{ taxCategory: "goods", unitPrice: "300.00" }], "2026-11-02");
    const early = await issue(sf.id, [{ taxCategory: "goods", unitPrice: "100.00" }], "2026-09-10");
    await b.t((tx) => voidDocument(tx, { ...b.base, documentId: early.id, date: "2026-10-15", reason: "billed twice", actor: bookkeeper }));

    const r = await b.t((tx) => prepareSalesTaxReturn(tx, b.entity.id, "2026-Q4P"));
    const line = (label: string) => r.lines.find((l) => l.label === label)?.value;
    expect(line("Total (gross) sales")).toBe(150000n);
    expect(line("Sales to other retailers for resale")).toBe(30000n);
    expect(line("Nontaxable sales (services and other)")).toBe(20000n);
    expect(line("Total deductions")).toBe(50000n);
    expect(line("Total taxable sales and purchases")).toBe(100000n);
    // $1,000 at 7.25% state and local, plus 1.375% district in San Francisco.
    expect(line("State and local tax on the taxable total")).toBe(7250n);
    expect(line("District taxes (from Schedule A)")).toBe(1375n);
    expect(line("Total tax on this return")).toBe(8625n);
    expect(line("Sales tax charged on invoices and use tax accrued on bills, for comparison")).toBe(8625n);
    expect(r.districts).toEqual([{ jurisdiction: "San Francisco, San Francisco County", rate: "0.08625", taxableMinor: 100000n, taxMinor: 8625n, districtTaxMinor: 1375n }]);
    expect(line("October prepayment, due 2026-11-24")).toBe(8625n);
    expect(line("November prepayment, due 2026-12-24")).toBe(0n);
    expect(r.period.dueDate).toBe("2027-02-01");

    expect(r.warnings.some((w) => /seller's permit number/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /how often the CDTFA/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /Invoice INV-\S+ \(2026-09-10\) was voided on 2026-10-15.*refund the \$8\.63/.test(w))).toBe(true);

    await b.t((tx) => setSalesTaxSettings(tx, { ...b.base, sellerPermit: "SR AB 100-200300", filingFrequency: "quarterly_prepay", actor: owner }));
    const after = await b.t((tx) => prepareSalesTaxReturn(tx, b.entity.id, "2026-Q4P"));
    expect(after.seller).toMatchObject({ sellerPermit: "SR AB 100-200300", filingFrequency: "quarterly_prepay" });
    expect(after.warnings.filter((w) => /permit number|how often/.test(w))).toEqual([]);
  });

  it("flags tax charged beyond what the return computes, and rates set by hand", async () => {
    const b = await business();
    const sf = await b.t((tx) => createContact(tx, { ...b.base, kind: "customer", name: "SF", address: SF, actor: bookkeeper }));
    // Three $0.10 sales each round up to a cent of tax; on $0.30 the return computes two cents.
    for (const n of [1, 2, 3]) {
      await b.t((tx) => issueInvoice(tx, {
        ...b.base, contactId: sf.id, issueDate: "2026-10-01", idempotencyKey: `c${n}`, actor: bookkeeper, lookup,
        lines: [{ account: "4000", taxCategory: "goods", quantity: "1", unitPrice: "0.10" }],
      }));
    }
    const r = await b.t((tx) => prepareSalesTaxReturn(tx, b.entity.id, "2026-Q4"));
    expect(r.lines.find((l) => l.label === "Total tax on this return")?.value).toBe(2n);
    expect(r.warnings.some((w) => /charged \$0\.01 more tax.*§6901\.5/.test(w))).toBe(true);

    await b.t((tx) => issueInvoice(tx, {
      ...b.base, contactId: sf.id, issueDate: "2026-10-02", idempotencyKey: "m1", actor: accountant,
      manual: { ratePercent: "9.5", reason: "lookup down" }, lines: [{ account: "4000", taxCategory: "goods", quantity: "1", unitPrice: "100.00" }],
    }));
    const m = await b.t((tx) => prepareSalesTaxReturn(tx, b.entity.id, "2026-Q4"));
    expect(m.warnings.some((w) => /rate set by hand/.test(w))).toBe(true);
  });

  it("adds purchases subject to use tax to the taxable total", async () => {
    const b = await business();
    await b.t((tx) => setBusinessAddress(tx, { ...b.base, address: SF, actor: owner }));
    const saas = await b.t((tx) => createContact(tx, { ...b.base, kind: "vendor", name: "Out-of-State SaaS", accrueUseTax: true, actor: bookkeeper }));
    await b.t((tx) => recordBill(tx, {
      ...b.base, contactId: saas.id, issueDate: "2026-12-10", dueDate: "2027-01-09", idempotencyKey: "u1", actor: bookkeeper, lookup,
      lines: [{ account: "6000", quantity: "1", unitPrice: "1200.00", taxCategory: "prewritten_software", servicePeriodStart: "2027-01-01", servicePeriodEnd: "2027-01-31" }],
    }));
    const r = await b.t((tx) => prepareSalesTaxReturn(tx, b.entity.id, "2026-Q4"));
    const line = (label: string) => r.lines.find((l) => l.label === label)?.value;
    expect(line("Purchases subject to use tax")).toBe(120000n);
    expect(line("Total taxable sales and purchases")).toBe(120000n);
    // $1,200 x 7.25% = $87.00, plus $1,200 x 1.375% = $16.50.
    expect(line("State and local tax on the taxable total")).toBe(8700n);
    expect(line("District taxes (from Schedule A)")).toBe(1650n);
    expect(line("Sales tax charged on invoices and use tax accrued on bills, for comparison")).toBe(10350n);
    expect(r.districts).toEqual([{ jurisdiction: "San Francisco, San Francisco County", rate: "0.08625", taxableMinor: 120000n, taxMinor: 10350n, districtTaxMinor: 1650n }]);
  });

  it("is served by the API", async () => {
    const BASE = "https://alt-qbo.test";
    const call = async (path: string, init: { body?: unknown; cookie?: string } = {}) => {
      const headers: Record<string, string> = {};
      if (init.body !== undefined) headers["content-type"] = "application/json";
      if (init.cookie) headers.cookie = init.cookie;
      const res = await handleApi(
        new Request(BASE + path, { method: init.body !== undefined ? "POST" : "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
        pool, { signupCode: "c", taxRates: lookup },
      );
      return { status: res.status, data: await res.json(), cookie: res.headers.get("set-cookie")?.split(";")[0] };
    };
    const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "T", email: `str${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Return Co", inviteCode: "c" } });
    const cookie = su.cookie!;
    const orgId = (await call("/api/me", { cookie })).data.orgs[0].id;
    const ent = await call(`/api/orgs/${orgId}/entities`, { cookie, body: { legalName: "Return Studio LLC", entityType: "llc_single", region: "CA", firstFiscalYear: 2026 } });
    const base = `/api/orgs/${orgId}/entities/${ent.data.id}`;

    const empty = await call(`${base}/sales-tax?year=2026`, { cookie });
    expect(empty.data).toMatchObject({ sellerPermit: null, filingFrequency: null, periods: [] });
    expect(empty.data.frequencies.quarterly).toBe("Quarterly");
    expect((await call(`${base}/sales-tax-settings`, { cookie, body: { filingFrequency: 4 } })).status).toBe(400);
    await call(`${base}/sales-tax-settings`, { cookie, body: { sellerPermit: "SR AB 100-200300", filingFrequency: "quarterly" } });
    const set = await call(`${base}/sales-tax?year=2026`, { cookie });
    expect(set.data.periods[0]).toMatchObject({ key: expect.stringMatching(/^2026-Q[1-4]$/), dueDate: expect.any(String) });
    const ret = await call(`${base}/sales-tax/return?period=2026-Q2`, { cookie });
    expect(ret.status).toBe(200);
    expect(ret.data).toMatchObject({ form: "CDTFA-401", seller: { sellerPermit: "SR AB 100-200300" }, period: { dueDate: "2026-07-31" } });
    expect((await call(`${base}/sales-tax/return?period=nope`, { cookie })).status).toBe(422);
  });
});

describe("sales tax reminders", () => {
  it("emails once, a few days before a return or prepayment is due, once the period has ended", async () => {
    const { sendSalesTaxReminders } = await import("../src/core/sales-tax-reminders.js");
    const { org, entity } = await setupCaliforniaBusiness("Reminder Studio");
    const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
    await withSystem(pool, async (tx) => {
      const u = (await tx.query("INSERT INTO users (email, name, password_hash) VALUES ($1, 'Owner', 'x') RETURNING id", [`st-owner-${Date.now()}@example.com`])).rows[0].id;
      await tx.query("INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')", [u, org.id]);
    });
    await t((tx) => setSalesTaxSettings(tx, { orgId: org.id, entityId: entity.id, filingFrequency: "quarterly_prepay", actor: owner }));
    const sent: { to: string; subject: string; text: string }[] = [];
    const mailer = async (m: { to: string; subject: string; text: string }) => { sent.push(m); };
    const mine = () => sent.filter((m) => m.subject.includes("Reminder Studio"));

    // Nothing within five days on October 1.
    await sendSalesTaxReminders(pool, mailer, "2026-10-01");
    expect(mine()).toEqual([]);
    // Q3's return is due November 2 (October 31 is a Saturday); the October prepayment is due November 24.
    await sendSalesTaxReminders(pool, mailer, "2026-10-28", "https://alt-qbo.test");
    expect(mine()).toHaveLength(1);
    expect(mine()[0]!.text).toMatch(/Return for Q3 2026: due 2026-11-02, about \$0\.00 of tax/);
    expect(mine()[0]!.text).not.toMatch(/October prepayment/);
    expect(mine()[0]!.text).toContain(`https://alt-qbo.test/#/e/${entity.id}/sales-tax`);
    // Sent once.
    await sendSalesTaxReminders(pool, mailer, "2026-10-29");
    expect(mine()).toHaveLength(1);
    await sendSalesTaxReminders(pool, mailer, "2026-11-20");
    expect(mine()).toHaveLength(2);
    expect(mine()[1]!.text).toMatch(/October prepayment for Q4 2026: due 2026-11-24/);
  });
});
