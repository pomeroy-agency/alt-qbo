import { describe, expect, it } from "vitest";
import { withSystem, withTenant, type Tx } from "../src/db/pool.js";
import { createEntity, createOrganization } from "../src/core/tenancy.js";
import { LedgerError } from "../src/core/errors.js";
import { createContact, getDocument, voidDocument } from "../src/core/documents.js";
import { accountBalance } from "../src/core/reports.js";
import { currentCategories, decideSalesTax, issueInvoice, recordBill, setBusinessAddress, type InvoiceLineInput } from "../src/core/sales-tax.js";
import { createEstimate } from "../src/core/invoicing.js";
import {
  canadaRegistrations, canadaReturnPeriods, canadaSalesTaxReturn, getCanadaSalesTaxSettings, setCanadaSalesTaxSettings,
} from "../src/core/canada-sales-tax.js";
import { canadaSalesTax2026, hstRate } from "../src/rules/sales-tax/ca-2026.js";
import { handleApi } from "../src/app/api.js";
import { emailDocument, viewByToken } from "../src/core/invoicing.js";
import { bookkeeper, owner, passSecondFactor, pool } from "./helpers.js";

async function expectLedgerError(p: Promise<unknown>, code: string, message?: RegExp) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code && (!message || message.test(e.message)));
}

const ADDR = {
  BC: { line1: "800 Granville St", city: "Vancouver", state: "BC", zip: "V6Z 1K3" },
  ON: { line1: "100 King St W", city: "Toronto", state: "ON", zip: "M5X 1A9" },
  QC: { line1: "1000 Rue Sherbrooke O", city: "Montréal", state: "QC", zip: "H3A 3G4" },
  AB: { line1: "200 8 Ave SW", city: "Calgary", state: "AB", zip: "T2P 1B5" },
  SK: { line1: "1874 Scarth St", city: "Regina", state: "SK", zip: "S4P 4B3" },
  NS: { line1: "1800 Argyle St", city: "Halifax", state: "NS", zip: "B3J 3N8" },
  US: { line1: "500 Howard St", city: "San Francisco", state: "CA", zip: "94105" },
};

async function business(region = "BC", entityType: "ca_corporation" | "ca_sole_prop" = "ca_corporation") {
  const org = await withSystem(pool, (tx) => createOrganization(tx, { name: "Cedar Studio", actor: owner }));
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const entity = await t((tx) => createEntity(tx, { orgId: org.id, legalName: "Cedar Studio Ltd", entityType, place: { country: "CA", region }, firstFiscalYear: 2026, actor: owner }));
  const base = { orgId: org.id, entityId: entity.id };
  await t((tx) => setBusinessAddress(tx, { ...base, address: ADDR[region as keyof typeof ADDR], actor: owner }));
  const customer = (name: string, where: keyof typeof ADDR | null, extra: { resalePermit?: string } = {}) =>
    t((tx) => createContact(tx, { ...base, kind: "customer", name, address: where ? ADDR[where] : null, ...extra, actor: bookkeeper }));
  const register = (over: Partial<Parameters<typeof setCanadaSalesTaxSettings>[1]> = {}) =>
    t((tx) => setCanadaSalesTaxSettings(tx, { ...base, actor: owner, gstRegistered: true, gstAccount: "123456789 RT 0001", gstFrequency: "quarterly", ...over }));
  const invoice = (contactId: string, lines: InvoiceLineInput[], issueDate = "2026-11-10", key = crypto.randomUUID()) =>
    t((tx) => issueInvoice(tx, { ...base, contactId, issueDate, dueDate: "2026-12-10", lines, idempotencyKey: key, actor: bookkeeper }));
  const balance = (key: string) => t((tx) => accountBalance(tx, entity.id, key, "2026-12-31"));
  return { org, entity, t, base, customer, register, invoice, balance };
}

const line = (taxCategory: string, unitPrice: string, quantity = "1"): InvoiceLineInput => ({ description: taxCategory, quantity, unitPrice, taxCategory });

describe("Canadian sales tax rules", () => {
  it("has the 2026 rates", () => {
    expect(hstRate(canadaSalesTax2026, "ON", "2026-06-01")).toBe("0.13");
    expect(hstRate(canadaSalesTax2026, "NS", "2025-03-31")).toBe("0.15");
    expect(hstRate(canadaSalesTax2026, "NS", "2026-06-01")).toBe("0.14");
    expect(hstRate(canadaSalesTax2026, "BC", "2026-06-01")).toBeNull();
    expect(canadaSalesTax2026.qstRate).toBe("0.09975");
    expect(canadaSalesTax2026.status).toBe("draft");
  });

  it("offers the Canadian kinds of sale to a Canadian business", () => {
    expect(currentCategories("ON").map((c) => c.id)).toContain("legal_service");
    expect(currentCategories("CA").map((c) => c.id)).not.toContain("legal_service");
  });

  it("works out filing periods and due dates, moved past weekends and holidays", () => {
    const q = canadaReturnPeriods("gst", "quarterly", 2026);
    expect(q.map((p) => p.dueDate)).toEqual(["2026-04-30", "2026-07-31", "2026-11-02", "2027-02-01"]);
    expect(canadaReturnPeriods("gst", "annual", 2026)[0]!.dueDate).toBe("2027-03-31");
    expect(canadaReturnPeriods("gst", "annual", 2026, true)[0]!.dueDate).toBe("2027-06-15");
    expect(canadaReturnPeriods("pst_bc", "monthly", 2026)[10]).toMatchObject({ key: "2026-M11", dueDate: "2026-12-31" });
    expect(canadaReturnPeriods("pst_sk", "monthly", 2026)[11]!.dueDate).toBe("2027-01-20");
  });
});

describe("registrations", () => {
  it("checks and tidies the account numbers", async () => {
    const b = await business();
    const s = await b.register({ qstAccount: "1234567890 tq 0001", qstFrequency: "annual", pst: { BC: { account: "pst-1234-5678", frequency: "monthly" } } });
    expect(s).toMatchObject({ gstAccount: "123456789RT0001", qstAccount: "1234567890TQ0001", pst: { BC: { account: "PST-1234-5678", frequency: "monthly" } } });
    expect(await b.t((tx) => getCanadaSalesTaxSettings(tx, b.entity.id))).toEqual(s);
    await expectLedgerError(b.register({ gstAccount: "12345 RT 0001" }), "INVALID", /123456789 RT 0001/);
    await expectLedgerError(b.register({ pst: { ON: { account: "X", frequency: "monthly" } } }), "INVALID", /no provincial sales tax/);
    await expectLedgerError(
      b.t((tx) => setCanadaSalesTaxSettings(tx, { ...b.base, actor: bookkeeper, gstRegistered: false })), "FORBIDDEN",
    );
  });
});

describe("invoices", () => {
  it("charges nothing until the business registers, and warns past the small-supplier limit", async () => {
    const b = await business("ON");
    const c = await b.customer("Maple Inc", "ON");
    const doc = await b.invoice(c.id, [line("professional_service", "31000.00")]);
    expect(doc).toMatchObject({ taxSource: "none", taxMinor: 0n, totalMinor: 3_100_000n });
    const d = await b.t((tx) => decideSalesTax(tx, { entityId: b.entity.id, contactId: c.id, date: "2026-11-20", categories: ["professional_service"], lines: [{ amountMinor: 100n }] }));
    expect(d.warnings.join()).toMatch(/must register for GST\/HST/);
  });

  it("charges HST in Ontario and GST plus PST in British Columbia, each to its own account", async () => {
    const b = await business("BC");
    await b.register({ pst: { BC: { account: "PST-1234-5678", frequency: "monthly" } } });
    const on = await b.customer("Maple Inc", "ON");
    const bc = await b.customer("Coast Legal", "BC");

    const onDoc = await b.invoice(on.id, [line("professional_service", "1000.00"), line("software", "200.00")]);
    expect(onDoc).toMatchObject({ taxSource: "canada", taxRate: "0.13000", taxMinor: 15_600n, totalMinor: 135_600n, taxJurisdiction: "Ontario" });
    expect(onDoc.caTax!.taxes).toEqual([expect.objectContaining({ code: "HST", rate: "0.13000", baseMinor: "120000", amountMinor: "15600" })]);
    // BC PST doesn't follow the customer to Ontario.
    expect(onDoc.lines.map((l) => l.caTax)).toEqual([{ supply: "taxable", taxes: { HST: "13000" } }, { supply: "taxable", taxes: { HST: "2600" } }]);

    const bcDoc = await b.invoice(bc.id, [line("professional_service", "1000.00"), line("software", "99.99"), line("exempt", "50.00")]);
    // GST on the first two; PST 7% only on software; nothing on the exempt line.
    expect(bcDoc.lines.map((l) => [l.taxRate, l.taxMinor])).toEqual([["0.05000", 5_000n], ["0.12000", 1_200n], ["0.00000", 0n]]);
    expect(bcDoc).toMatchObject({ taxRate: "0.12000", taxMinor: 6_200n, subtotalMinor: 114_999n, totalMinor: 121_199n });
    expect(bcDoc.caTax!.supplies).toEqual({ taxable: "109999", zeroRated: "0", exempt: "5000" });
    expect(await b.balance("sales_tax_payable")).toBe(-(15_600n + 5_500n));
    expect(await b.balance("pst_payable")).toBe(-700n);
    expect(await b.balance("accounts_receivable")).toBe(135_600n + 121_199n);
  });

  it("warns when PST or QST would apply but the business hasn't recorded the registration", async () => {
    const b = await business("ON");
    await b.register();
    const sk = await b.customer("Prairie Co", "SK");
    const qc = await b.customer("Québec Ltée", "QC");
    const d = await b.t((tx) => decideSalesTax(tx, { entityId: b.entity.id, contactId: sk.id, date: "2026-11-10", categories: ["legal_service"] }));
    expect(d).toMatchObject({ rate: "0.05000", taxable: [true] });
    expect(d.warnings.join()).toMatch(/Saskatchewan PST applies/);
    const q = await b.t((tx) => decideSalesTax(tx, { entityId: b.entity.id, contactId: qc.id, date: "2026-11-10", categories: ["professional_service"] }));
    expect(q.warnings.join()).toMatch(/QST applies too/);
  });

  it("charges QST in Quebec on the price before GST", async () => {
    const b = await business("QC");
    await b.register({ qstAccount: "1234567890TQ0001", qstFrequency: "quarterly" });
    const c = await b.customer("Québec Ltée", "QC");
    const doc = await b.invoice(c.id, [line("professional_service", "100.00")]);
    expect(doc.lines[0]).toMatchObject({ taxRate: "0.14975", taxMinor: 1_498n, caTax: { taxes: { GST: "500", QST: "998" } } });
    expect(doc.caTax!.taxes.map((t) => [t.code, t.authority])).toEqual([["GST", "Revenu Québec"], ["QST", "Revenu Québec"]]);
    expect(await b.balance("qst_payable")).toBe(-998n);
  });

  it("zero-rates exports and skips PST on a sale for resale", async () => {
    const b = await business("BC");
    await b.register({ pst: { BC: { account: "PST-1", frequency: "monthly" } } });
    const us = await b.customer("Bay Area Inc", "US");
    const reseller = await b.customer("Coast Resale", "BC", { resalePermit: "PST-9999" });
    const ex = await b.invoice(us.id, [line("goods", "500.00")]);
    expect(ex).toMatchObject({ taxSource: "canada", taxMinor: 0n, taxJurisdiction: "Outside Canada", caTax: { supplies: { zeroRated: "50000" }, taxes: [] } });
    expect(ex.taxNote).toMatch(/Zero-rated export/);
    const rs = await b.invoice(reseller.id, [line("goods", "100.00")]);
    expect(rs.lines[0]!.caTax).toEqual({ supply: "taxable", taxes: { GST: "500" } });
    expect(rs.taxNote).toMatch(/for resale/);
  });

  it("uses the business's province when the customer has no address, and replays a retry exactly", async () => {
    const b = await business("NS");
    await b.register();
    const c = await b.customer("Walk-in", null);
    const key = crypto.randomUUID();
    const first = await b.invoice(c.id, [line("goods", "10.00")], "2026-11-10", key);
    expect(first).toMatchObject({ taxRate: "0.14000", taxMinor: 140n });
    const again = await b.invoice(c.id, [line("goods", "10.00")], "2026-11-10", key);
    expect(again).toMatchObject({ id: first.id, replayed: true });
  });

  it("estimates the same taxes", async () => {
    const b = await business("BC");
    await b.register({ pst: { BC: { account: "PST-1", frequency: "monthly" } } });
    const c = await b.customer("Coast Legal", "BC");
    const est = await b.t((tx) => createEstimate(tx, { ...b.base, contactId: c.id, issueDate: "2026-11-10", lines: [line("legal_service", "99.99")], actor: bookkeeper }));
    expect(est.taxMinor).toBe(1_200n); // 5.00 GST + 7.00 PST
  });
});

describe("bills and returns", () => {
  it("claims GST/HST on bills as input tax credits and fills in the GST/HST and PST returns", async () => {
    const b = await business("BC");
    await b.register({ pst: { BC: { account: "PST-1", frequency: "monthly" } } });
    const vendor = await b.t((tx) => createContact(tx, { ...b.base, kind: "vendor", name: "Office Supply Co", actor: bookkeeper }));
    const bill = await b.t((tx) => recordBill(tx, {
      ...b.base, contactId: vendor.id, issueDate: "2026-11-05", idempotencyKey: crypto.randomUUID(), actor: bookkeeper,
      lines: [{ account: "6000", description: "Ads", quantity: "1", unitPrice: "200.00" }], caTax: { gstHst: "10.00" },
    }));
    expect(bill).toMatchObject({ subtotalMinor: 21_000n, totalMinor: 21_000n });
    expect(await b.balance("gst_itc")).toBe(1_000n);
    await expectLedgerError(b.t((tx) => recordBill(tx, {
      ...b.base, contactId: vendor.id, issueDate: "2026-11-05", idempotencyKey: crypto.randomUUID(), actor: bookkeeper,
      lines: [{ account: "6000", quantity: "1", unitPrice: "10.00" }], caTax: { gstHst: "5.00" },
    })), "INVALID", /more than 15%/);

    const c = await b.customer("Coast Legal", "BC");
    await b.invoice(c.id, [line("software", "1000.00")]); // GST 50, PST 70
    const voided = await b.invoice(c.id, [line("software", "500.00")]);
    await b.t((tx) => voidDocument(tx, { ...b.base, documentId: voided.id, date: "2026-11-20", reason: "duplicate", actor: owner }));

    const regs = await b.t((tx) => canadaRegistrations(tx, b.entity.id, 2026));
    expect(regs.registrations.map((r) => [r.tax, r.periods.length])).toEqual([["gst", 4], ["pst_bc", 12]]);
    const gst = await b.t((tx) => canadaSalesTaxReturn(tx, b.entity.id, "gst", "2026-Q4"));
    const v = Object.fromEntries(gst.lines.map((l) => [l.line, l.valueMinor]));
    expect(v).toMatchObject({ 101: 100_000n, 103: 5_000n, 106: 1_000n, 109: 4_000n, "113A": 4_000n });
    expect(gst).toMatchObject({ account: "123456789RT0001", authority: "Canada Revenue Agency", invoices: 1, period: { dueDate: "2027-02-01" } });
    const pst = await b.t((tx) => canadaSalesTaxReturn(tx, b.entity.id, "pst_bc", "2026-M11"));
    expect(pst).toMatchObject({ netMinor: 7_000n, period: { dueDate: "2026-12-31" } });
    await expectLedgerError(b.t((tx) => canadaSalesTaxReturn(tx, b.entity.id, "qst", "2026-Q4")), "INVALID", /record your QST/);
    expect((await b.t((tx) => getDocument(tx, bill.id))).lines.map((l) => l.accountCode)).toEqual(["6000", "1310"]);
  });
});

describe("the API", () => {
  const call = async (path: string, init: { body?: unknown; cookie?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.cookie) headers.cookie = init.cookie;
    const res = await handleApi(
      new Request("https://alt-qbo.test" + path, { method: init.body !== undefined ? "POST" : "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
      pool, { signupCode: "c" },
    );
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data, cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };

  it("records registrations, previews and issues an invoice, takes credits on a bill, and prepares the return", async () => {
    const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "T", email: `gst${Date.now()}@example.com`, password: "long-enough-pw", orgName: "GST Co", inviteCode: "c" } });
    const cookie = await passSecondFactor(su.cookie!);
    const orgId = (await call("/api/me", { cookie })).data.orgs[0].id;
    const ent = await call(`/api/orgs/${orgId}/entities`, { cookie, body: { legalName: "Lakeside Ltd", entityType: "ca_corporation", country: "CA", region: "ON", firstFiscalYear: 2026 } });
    expect(ent.status).toBe(201);
    const base = `/api/orgs/${orgId}/entities/${ent.data.id}`;
    const saved = await call(`${base}/sales-tax-settings`, { cookie, body: { country: "CA", gstRegistered: true, gstAccount: "123456789 RT 0001", gstFrequency: "monthly", pst: { BC: { account: "", frequency: "" } } } });
    expect(saved.data).toMatchObject({ gstAccount: "123456789RT0001", pst: {} });
    const page = await call(`${base}/sales-tax?year=2026`, { cookie });
    expect(page.data).toMatchObject({ country: "CA", registrations: [{ tax: "gst", frequency: "monthly" }] });
    expect(page.data.registrations[0].periods).toHaveLength(12);

    const customer = await call(`${base}/contacts`, { cookie, body: { kind: "customer", name: "Maple Inc", email: "ap@maple.example", address: ADDR.ON } });
    const lines = [{ description: "Consulting", quantity: "2", unitPrice: "150.00", taxCategory: "professional_service" }];
    const preview = await call(`${base}/invoices/tax-preview`, { cookie, body: { contactId: customer.data.id, issueDate: "2026-11-10", lines } });
    expect(preview.data).toMatchObject({ source: "canada", rate: "0.13000", lineRates: ["0.13000"] });
    expect(preview.data.explanation).toMatch(/^HST 13% for a sale in Ontario/);
    const inv = await call(`${base}/invoices`, { cookie, body: { contactId: customer.data.id, issueDate: "2026-11-10", dueDate: "2026-12-10", lines } });
    expect(inv.status).toBe(201);
    expect(inv.data).toMatchObject({ taxMinor: "3900", totalMinor: "33900" });
    const refused = await call(`${base}/invoices/tax-preview`, { cookie, body: { contactId: customer.data.id, issueDate: "2026-11-10", lines, manualTax: { ratePercent: "5", reason: "x" } } });
    expect(refused.status).toBe(422);

    const vendor = await call(`${base}/contacts`, { cookie, body: { kind: "vendor", name: "Print Shop" } });
    const bill = await call(`${base}/bills`, { cookie, body: { contactId: vendor.data.id, issueDate: "2026-11-12", lines: [{ account: "6000", quantity: "1", unitPrice: "100.00" }], caTax: { gstHst: "13.00" } } });
    expect(bill.data).toMatchObject({ totalMinor: "11300" });

    const ret = await call(`${base}/sales-tax/return?tax=gst&period=2026-M11`, { cookie });
    expect(ret.status).toBe(200);
    expect(ret.data).toMatchObject({ netMinor: "2600", period: { dueDate: "2026-12-31" } });

    // The email and the customer's view link show the HST on its own line and the GST/HST number.
    const sent: any[] = [];
    await emailDocument(pool, { orgId, documentId: inv.data.id, mailer: async (m) => { sent.push(m); }, appUrl: "https://app.example", actor: owner });
    expect(sent[0].text).toMatch(/HST 13%: CA\$39\.00/);
    expect(sent[0].text).toMatch(/GST\/HST registration no\. 123456789RT0001/);
    const token = /view\.html#([\w-]+)/.exec(sent[0].text)![1]!;
    expect(await viewByToken(pool, token)).toMatchObject({ taxes: [{ label: "HST 13%", amountMinor: 3900n }], taxNumbers: ["GST/HST registration no. 123456789RT0001"] });
  });
});
