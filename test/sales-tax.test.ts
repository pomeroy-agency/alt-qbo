import { describe, expect, it } from "vitest";
import { withTenant, type Tx } from "../src/db/pool.js";
import { handleApi } from "../src/app/api.js";
import { cached, parseCdtfaRate } from "../src/app/cdtfa.js";
import { LedgerError } from "../src/core/errors.js";
import { createContact, voidDocument } from "../src/core/documents.js";
import { setSalesTaxSettings } from "../src/core/sales-tax-return.js";
import { NO_PERMIT_WARNING, createItem, permitNotStartedWarning, decideSalesTax, explainTax, issueInvoice, salesTaxReport, setBusinessAddress, updateItem, type RateLookup } from "../src/core/sales-tax.js";
import { accountant, bookkeeper, owner, pool, setupCaliforniaBusiness } from "./helpers.js";

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

const SF = { line1: "1 Market St", city: "San Francisco", state: "CA", zip: "94105" };

/** A rate lookup that answers 8.625% for San Francisco and counts its calls. */
function fakeLookup() {
  const calls: string[] = [];
  const lookup: RateLookup = async (a) => {
    calls.push(a.zip);
    if (a.zip.startsWith("941")) return { rate: "0.08625", jurisdiction: "San Francisco, San Francisco County" };
    if (a.zip === "99999") return { rate: "0.30000", jurisdiction: "Nowhere" };
    throw new Error("no rate for that address");
  };
  return { lookup, calls };
}

async function business() {
  const { org, entity } = await setupCaliforniaBusiness();
  const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
  const base = { orgId: org.id, entityId: entity.id };
  const contact = (name: string, extra: { address?: typeof SF; resalePermit?: string } = {}) =>
    t((tx) => createContact(tx, { ...base, kind: "customer", name, actor: bookkeeper, ...extra }));
  /** A customer whose tax settings only an owner or accountant can record. */
  const taxContact = (name: string, extra: { directPayPermit?: string; mpu?: { caPercent: string; certificateDate: string } }) =>
    t((tx) => createContact(tx, { ...base, kind: "customer", name, address: SF, actor: accountant, ...extra }));
  return { org, entity, t, base, contact, taxContact };
}

describe("deciding an invoice's sales tax", () => {
  it("works it out from the kind of sale and the customer's address", async () => {
    const b = await business();
    const { lookup } = fakeLookup();
    const sf = await b.contact("SF Client", { address: SF });
    const decide = (contactId: string, categories: string[], extra = {}) =>
      b.t((tx) => decideSalesTax(tx, { entityId: b.entity.id, contactId, date: "2026-05-01", categories, lookup, ...extra }));

    // Services only: no tax, and no address or lookup needed.
    const noAddress = await b.contact("No Address Co");
    expect(await decide(noAddress.id, ["professional_service", "digital_delivery"])).toMatchObject({ source: "not_taxable", rate: "0.00000", taxable: [false, false] });

    // Goods delivered in San Francisco: the looked-up rate, on the goods line only.
    const d = await decide(sf.id, ["professional_service", "printed_materials"]);
    expect(d).toMatchObject({ source: "lookup", rate: "0.08625", jurisdiction: "San Francisco, San Francisco County", address: "1 Market St, San Francisco, CA 94105", taxable: [false, true] });
    expect(explainTax(d)).toBe("Sales tax 8.625% on taxable lines, the rate for San Francisco, San Francisco County (1 Market St, San Francisco, CA 94105).");

    // A resale certificate, or delivery out of state: no tax.
    const reseller = await b.contact("Print Reseller", { address: SF, resalePermit: "SR EA 123-456789" });
    expect(await decide(reseller.id, ["goods"])).toMatchObject({ source: "resale", rate: "0.00000", note: "Resale certificate, seller's permit SR EA 123-456789" });
    const oregon = await b.contact("Portland Shop", { address: { line1: "1 Main St", city: "Portland", state: "OR", zip: "97201" } });
    expect(await decide(oregon.id, ["goods"])).toMatchObject({ source: "out_of_state", rate: "0.00000" });

    // Taxable with no address anywhere: asks for one. The business's own address is the fallback.
    await expectLedgerError(decide(noAddress.id, ["goods"]), "INVALID");
    await b.t((tx) => setBusinessAddress(tx, { ...b.base, address: { line1: "500 Howard St", city: "San Francisco", state: "CA", zip: "94105" }, actor: owner }));
    expect(await decide(noAddress.id, ["goods"])).toMatchObject({ source: "lookup", rate: "0.08625", address: "500 Howard St, San Francisco, CA 94105" });

    // An unknown kind of sale is refused rather than guessed.
    await expectLedgerError(decide(sf.id, ["mystery"]), "INVALID");
  });

  it("refuses to guess when the lookup fails or answers something impossible", async () => {
    const b = await business();
    const { lookup } = fakeLookup();
    const la = await b.contact("LA Client", { address: { line1: "1 Spring St", city: "Los Angeles", state: "CA", zip: "90012" } });
    const odd = await b.contact("Odd Client", { address: { line1: "1 Nowhere Rd", city: "Nowhere", state: "CA", zip: "99999" } });
    const decide = (contactId: string, extra = {}) =>
      b.t((tx) => decideSalesTax(tx, { entityId: b.entity.id, contactId, date: "2026-05-01", categories: ["goods"], lookup, ...extra }));
    await expectLedgerError(decide(la.id), "TAX_LOOKUP");
    await expectLedgerError(decide(odd.id), "TAX_LOOKUP");
    await expectLedgerError(decide(la.id, { lookup: undefined }), "TAX_LOOKUP");

    // An owner or accountant can set the rate by hand, with a reason; a bookkeeper can't.
    await expectLedgerError(decide(la.id, { manual: { ratePercent: "9.75", reason: "CDTFA site down", actor: bookkeeper } }), "FORBIDDEN");
    await expectLedgerError(decide(la.id, { manual: { ratePercent: "9.75", reason: " ", actor: accountant } }), "INVALID");
    await expectLedgerError(decide(la.id, { manual: { ratePercent: "25", reason: "typo", actor: accountant } }), "INVALID");
    expect(await decide(la.id, { manual: { ratePercent: "9.75", reason: "CDTFA site down", actor: accountant } }))
      .toMatchObject({ source: "manual", rate: "0.09750", note: "CDTFA site down" });
  });
});

describe("software and SaaS from 2027 (SB 122)", () => {
  const decider = (b: Awaited<ReturnType<typeof business>>, lookup: RateLookup) =>
    (contactId: string, date: string, categories: string[], lines?: { periodStart?: string; periodEnd?: string; amountMinor?: bigint }[]) =>
      b.t((tx) => decideSalesTax(tx, { entityId: b.entity.id, contactId, date, categories, lines, lookup }));

  it("taxes software by when the customer's access starts, not the invoice date", async () => {
    const b = await business();
    const { lookup } = fakeLookup();
    const sf = await b.contact("SF Client", { address: SF });
    const decide = decider(b, lookup);
    const dec2026 = { periodStart: "2026-12-01", periodEnd: "2026-12-31" };
    const jan2027 = { periodStart: "2027-01-01", periodEnd: "2027-01-31" };

    // Late in 2026, an invoice for software has to say when access starts.
    await expectLedgerError(decide(sf.id, "2026-12-15", ["prewritten_software"]), "INVALID");
    expect(await decide(sf.id, "2026-12-15", ["prewritten_software"], [dec2026]))
      .toMatchObject({ source: "not_taxable", taxable: [false], rules: "us-ca-sales-tax-2026@2026.1.0" });
    // Invoiced in December for January access: taxable.
    expect(await decide(sf.id, "2026-12-15", ["prewritten_software"], [jan2027]))
      .toMatchObject({ source: "lookup", rate: "0.08625", taxable: [true], rules: "us-ca-sales-tax-2027@2027.1.0" });
    // Invoiced in January for December access: not taxable.
    expect(await decide(sf.id, "2027-01-05", ["prewritten_software"], [dec2026])).toMatchObject({ source: "not_taxable", taxable: [false] });
    // A period across January 1, 2027 has to be split.
    await expectLedgerError(decide(sf.id, "2026-12-15", ["prewritten_software"], [{ periodStart: "2026-12-01", periodEnd: "2027-01-31" }]), "INVALID");
    await expectLedgerError(decide(sf.id, "2026-12-15", ["prewritten_software"], [{ periodEnd: "2027-01-31" }]), "INVALID");
    // Mid-2026 invoices need no date, and services never do.
    expect(await decide(sf.id, "2026-06-01", ["prewritten_software", "professional_service"])).toMatchObject({ source: "not_taxable" });

    // In 2027 only ready-made software is taxed: not custom software, digital works or services.
    expect(await decide(sf.id, "2027-02-01", ["prewritten_software", "custom_software", "digital_delivery", "professional_service"]))
      .toMatchObject({ source: "lookup", taxable: [true, false, false, false] });
  });

  it("taxes software only at the customer's own address", async () => {
    const b = await business();
    const { lookup } = fakeLookup();
    const decide = decider(b, lookup);
    const noAddress = await b.contact("No Address Co");
    await b.t((tx) => setBusinessAddress(tx, { ...b.base, address: { line1: "500 Howard St", city: "San Francisco", state: "CA", zip: "94105" }, actor: owner }));
    // Goods sold at the business still use its address; software never does.
    expect(await decide(noAddress.id, "2027-02-01", ["goods"])).toMatchObject({ source: "lookup", address: "500 Howard St, San Francisco, CA 94105" });
    await expect(decide(noAddress.id, "2027-02-01", ["prewritten_software"])).rejects.toThrow(/billing address/);
    // Untaxed software (2026) needs no address.
    expect(await decide(noAddress.id, "2026-06-01", ["prewritten_software"])).toMatchObject({ source: "not_taxable" });
  });

  it("leaves software tax to buyers with a direct payment permit, and warns near $5 million", async () => {
    const b = await business();
    const { lookup } = fakeLookup();
    const decide = decider(b, lookup);
    // Only an owner or accountant can record the permit.
    await expectLedgerError(b.t((tx) => createContact(tx, { ...b.base, kind: "customer", name: "X", directPayPermit: "DP 1", actor: bookkeeper })), "FORBIDDEN");
    const big = await b.taxContact("Big Buyer", { directPayPermit: "DP 123" });
    expect(big.directPayPermit).toBe("DP 123");

    const both = await decide(big.id, "2027-02-01", ["prewritten_software", "goods"]);
    expect(both).toMatchObject({ source: "lookup", taxable: [false, true], exemptions: ["direct_pay", null] });
    expect(both.note).toMatch(/permit DP 123/);
    const software = await decide(big.id, "2027-02-01", ["prewritten_software"]);
    expect(software).toMatchObject({ source: "direct_pay", rate: "0.00000", taxable: [false] });
    expect(explainTax(software)).toBe("No sales tax on software: the buyer pays California use tax directly (permit DP 123).");
    expect(software.warnings).toEqual([]);

    // Without a permit, a big year of software brings a warning, not a change in tax.
    const sf = await b.contact("Growing Client", { address: SF });
    // Charging tax with no seller's permit on file brings a reminder too.
    expect((await decide(sf.id, "2027-02-01", ["prewritten_software"], [{ amountMinor: 100_000_00n }])).warnings).toEqual([NO_PERMIT_WARNING]);
    // With a permit that hasn't taken effect yet, the reminder names its start date.
    await b.t((tx) => setSalesTaxSettings(tx, { ...b.base, sellerPermit: "208-440288", startDate: "2027-03-01", actor: owner }));
    expect((await decide(sf.id, "2027-02-01", ["prewritten_software"], [{ amountMinor: 100_000_00n }])).warnings).toEqual([permitNotStartedWarning("2027-03-01")]);
    await b.t((tx) => setSalesTaxSettings(tx, { ...b.base, sellerPermit: "", startDate: null, actor: owner }));
    const warned = await decide(sf.id, "2027-02-01", ["prewritten_software"], [{ amountMinor: 4_500_000_00n }]);
    expect(warned).toMatchObject({ source: "lookup", taxable: [true] });
    expect(warned.warnings[0]).toMatch(/\$4,500,000 for software in 2027.*direct payment permit/);
  });

  it("taxes only the California share under a multiple-points-of-use certificate", async () => {
    const b = await business();
    const { lookup } = fakeLookup();
    await expectLedgerError(b.taxContact("Bad", { mpu: { caPercent: "120", certificateDate: "2027-01-02" } }), "INVALID");
    const multi = await b.taxContact("Multi-State Co", { mpu: { caPercent: "60", certificateDate: "2027-01-02" } });
    expect(multi.mpu).toEqual({ caPercent: "60", certificateDate: "2027-01-02" });
    const d = await decider(b, lookup)(multi.id, "2027-02-01", ["prewritten_software", "goods"]);
    expect(d).toMatchObject({ source: "lookup", taxable: [true, true], taxShare: ["0.6000", null], exemptions: ["mpu", null] });
    expect(explainTax(d)).toMatch(/60% California share.*dated 2027-01-02/);

    const input = {
      // Invoiced in December 2026 (the books' open year) for February 2027 access.
      ...b.base, contactId: multi.id, issueDate: "2026-12-20", idempotencyKey: "mpu-1", actor: bookkeeper, lookup,
      lines: [
        { account: "4000", taxCategory: "prewritten_software", quantity: "1", unitPrice: "1000.00", servicePeriodStart: "2027-02-01", servicePeriodEnd: "2027-02-28" },
        { account: "4000", taxCategory: "goods", quantity: "1", unitPrice: "100.00" },
      ],
    };
    const inv = await b.t((tx) => issueInvoice(tx, input));
    // $1,000 x 60% x 8.625% = $51.75, plus $100 x 8.625% = $8.63.
    expect(inv).toMatchObject({ subtotalMinor: 110000n, taxMinor: 6038n });
    expect(inv.lines[0]).toMatchObject({ taxableMinor: 60000n, taxMinor: 5175n, taxExemption: "mpu", servicePeriodStart: "2027-02-01", servicePeriodEnd: "2027-02-28" });
    expect(await b.t((tx) => issueInvoice(tx, input))).toMatchObject({ id: inv.id, replayed: true });

    const r = await b.t((tx) => salesTaxReport(tx, b.entity.id, "2026-10-01", "2026-12-31"));
    expect(r).toMatchObject({ totalSalesMinor: 110000n, taxableMinor: 70000n, outsideCaUseMinor: 40000n, directPayMinor: 0n, taxMinor: 6038n });
  });
});

describe("issuing invoices with automatic sales tax", () => {
  it("fills lines from products, taxes only the taxable ones, and replays without a second lookup", async () => {
    const b = await business();
    const { lookup, calls } = fakeLookup();
    const sf = await b.contact("SF Client", { address: SF });
    const [design, signs] = await b.t(async (tx) => [
      await createItem(tx, { ...b.base, name: "Design hour", taxCategory: "professional_service", unitPrice: "150.00", actor: bookkeeper }),
      await createItem(tx, { ...b.base, name: "Yard sign", taxCategory: "printed_materials", unitPrice: "40.00", account: "4000", actor: bookkeeper }),
    ]);
    const input = {
      ...b.base, contactId: sf.id, issueDate: "2026-05-01", idempotencyKey: "inv-1", actor: bookkeeper, lookup,
      lines: [{ itemId: design!.id, quantity: "4" }, { itemId: signs!.id, quantity: "10" }],
    };
    const inv = await b.t((tx) => issueInvoice(tx, input));
    expect(inv).toMatchObject({ subtotalMinor: 100000n, taxMinor: 3450n, totalMinor: 103450n, taxRate: "0.08625", taxSource: "lookup", taxJurisdiction: "San Francisco, San Francisco County" });
    expect(inv.lines.map((l) => [l.description, l.taxable, l.taxCategory, l.itemId])).toEqual([
      ["Design hour", false, "professional_service", design!.id], ["Yard sign", true, "printed_materials", signs!.id],
    ]);
    expect(calls).toHaveLength(1);

    // A retry replays the invoice; a later rate change can't alter it.
    const again = await b.t((tx) => issueInvoice(tx, { ...input, lookup: async () => ({ rate: "0.09000", jurisdiction: "changed" }) }));
    expect(again).toMatchObject({ id: inv.id, replayed: true, taxRate: "0.08625" });
    await expectLedgerError(b.t((tx) => issueInvoice(tx, { ...input, lines: [{ itemId: design!.id, quantity: "5" }] })), "IDEMPOTENCY_CONFLICT");

    // Items can be renamed or retired but not deleted.
    await b.t((tx) => updateItem(tx, { ...b.base, itemId: signs!.id, active: false, unitPrice: "45.00", actor: bookkeeper }));
    await expect(b.t((tx) => tx.query("DELETE FROM items WHERE id = $1", [signs!.id]))).rejects.toThrow(/permission denied/);
    await expectLedgerError(b.t((tx) => createItem(tx, { ...b.base, name: "design HOUR", taxCategory: "goods", actor: bookkeeper })), "INVALID");
    await expectLedgerError(b.t((tx) => createItem(tx, { ...b.base, name: "Thing", taxCategory: "nope", actor: bookkeeper })), "INVALID");
  });

  it("adds up the return figures for a period", async () => {
    const b = await business();
    const { lookup } = fakeLookup();
    const sf = await b.contact("SF Client", { address: SF });
    const reseller = await b.contact("Reseller", { address: SF, resalePermit: "SR 1" });
    const oregon = await b.contact("Oregon", { address: { line1: "1 Main St", city: "Portland", state: "OR", zip: "97201" } });
    let k = 0;
    const issue = (contactId: string, lines: { taxCategory: string; unitPrice: string }[], date = "2026-04-15") =>
      b.t((tx) => issueInvoice(tx, {
        ...b.base, contactId, issueDate: date, idempotencyKey: `k${++k}`, actor: bookkeeper, lookup,
        lines: lines.map((l) => ({ ...l, quantity: "1", account: "4000" })),
      }));
    await issue(sf.id, [{ taxCategory: "professional_service", unitPrice: "1000.00" }, { taxCategory: "goods", unitPrice: "200.00" }]);
    await issue(reseller.id, [{ taxCategory: "goods", unitPrice: "300.00" }]);
    await issue(oregon.id, [{ taxCategory: "goods", unitPrice: "400.00" }]);
    const voided = await issue(sf.id, [{ taxCategory: "goods", unitPrice: "999.00" }]);
    await b.t((tx) => voidDocument(tx, { ...b.base, documentId: voided.id, date: "2026-04-20", reason: "duplicate", actor: bookkeeper }));
    await issue(sf.id, [{ taxCategory: "goods", unitPrice: "50.00" }], "2026-07-01");

    const r = await b.t((tx) => salesTaxReport(tx, b.entity.id, "2026-04-01", "2026-06-30"));
    expect(r).toMatchObject({ totalSalesMinor: 190000n, resaleMinor: 30000n, interstateMinor: 40000n, taxableMinor: 20000n, taxMinor: 1725n, payableMinor: 1725n });
    expect(r.nontaxable).toEqual([{ category: "professional_service", label: "Professional or creative service", amountMinor: 100000n }]);
    expect(r.byJurisdiction).toEqual([{ jurisdiction: "San Francisco, San Francisco County", ratePercent: "8.625", taxableMinor: 20000n, taxMinor: 1725n, invoices: 1 }]);
  });
});

describe("the CDTFA rate lookup", () => {
  it("reads one rate and refuses an ambiguous answer", () => {
    expect(parseCdtfaRate({ taxRateInfo: [{ rate: 0.08625, jurisdiction: "SAN FRANCISCO", city: "SAN FRANCISCO", county: "SAN FRANCISCO" }] }))
      .toEqual({ rate: "0.08625", jurisdiction: "San Francisco, San Francisco County", matchedAddress: undefined });
    expect(() => parseCdtfaRate({ taxRateInfo: [] })).toThrow(/couldn't find/);
    expect(() => parseCdtfaRate({ taxRateInfo: [{ rate: 0.0725 }, { rate: 0.0975 }] })).toThrow(/boundary/);
  });

  it("remembers answers so the live preview doesn't ask again", async () => {
    const { lookup, calls } = fakeLookup();
    const c = cached(lookup);
    await c(SF);
    await c({ ...SF, line1: " 1 market st " });
    expect(calls).toHaveLength(1);
  });
});

describe("sales tax API", () => {
  const BASE = "https://alt-qbo.test";
  const { lookup } = fakeLookup();
  const call = async (path: string, init: { body?: unknown; cookie?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.cookie) headers.cookie = init.cookie;
    const res = await handleApi(
      new Request(BASE + path, { method: init.body !== undefined ? "POST" : "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }),
      pool, { signupCode: "c", taxRates: lookup },
    );
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* CSV */ }
    return { status: res.status, data, cookie: res.headers.get("set-cookie")?.split(";")[0] };
  };

  it("keeps products, customer addresses, previews the tax, and issues the invoice", async () => {
    const su = await call("/api/auth/signup", { body: { acceptTerms: true, name: "T", email: `tax${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Tax Co", inviteCode: "c" } });
    const cookie = su.cookie!;
    const orgId = (await call("/api/me", { cookie })).data.orgs[0].id;
    const ent = await call(`/api/orgs/${orgId}/entities`, { cookie, body: { legalName: "Tax Studio LLC", entityType: "llc_single", region: "CA", firstFiscalYear: 2026 } });
    const base = `/api/orgs/${orgId}/entities/${ent.data.id}`;

    const info = await call(base, { cookie });
    expect(info.data.salesTaxCategories.map((c: any) => c.id)).toContain("printed_materials");

    expect((await call(`${base}/items`, { cookie, body: { name: "Logo design", taxCategory: "professional_service", unitPrice: "900.00" } })).status).toBe(201);
    const sign = await call(`${base}/items`, { cookie, body: { name: "Banner", taxCategory: "printed_materials", unitPrice: "100.00" } });
    expect((await call(`${base}/items`, { cookie })).data.items).toHaveLength(2);

    const cust = await call(`${base}/contacts`, { cookie, body: { kind: "customer", name: "Client", address: { line1: "1 Market St", city: "San Francisco", zip: "94105" } } });
    expect(cust.data.address).toEqual({ line1: "1 Market St", city: "San Francisco", state: "CA", zip: "94105" });
    expect((await call(`${base}/contacts`, { cookie, body: { kind: "customer", name: "Bad", address: { line1: "x", city: "y", zip: "123" } } })).status).toBe(422);

    const preview = await call(`${base}/invoices/tax-preview`, { cookie, body: { contactId: cust.data.id, issueDate: "2026-05-01", lines: [{ itemId: sign.data.id }] } });
    expect(preview.data).toMatchObject({ source: "lookup", rate: "0.08625", taxable: [true] });
    expect(preview.data.explanation).toMatch(/8\.625%/);

    const inv = await call(`${base}/invoices`, { cookie, body: { contactId: cust.data.id, issueDate: "2026-05-01", lines: [{ itemId: sign.data.id, quantity: "2" }] } });
    expect(inv.status).toBe(201);
    expect(inv.data).toMatchObject({ subtotalMinor: "20000", taxMinor: "1725", taxSource: "lookup" });

    // Adding a resale certificate later changes future invoices only.
    const upd = await call(`${base}/contacts/${cust.data.id}`, { cookie, body: { resalePermit: "SR 99" } });
    expect(upd.data.resalePermit).toBe("SR 99");
    const inv2 = await call(`${base}/invoices`, { cookie, body: { contactId: cust.data.id, issueDate: "2026-05-02", lines: [{ itemId: sign.data.id }] } });
    expect(inv2.data).toMatchObject({ taxMinor: "0", taxSource: "resale" });

    const csv = await call(`${base}/reports/sales-tax?from=2026-04-01&to=2026-06-30&format=csv`, { cookie });
    expect(csv.data).toContain("Taxable sales,200.00");
    expect(csv.data).toContain("Sales for resale,100.00");
    expect((await call(`${base}/address`, { cookie, body: { address: { line1: "500 Howard St", city: "San Francisco", state: "CA", zip: "94105" } } })).status).toBe(200);

    // Software from 2027: access dates on the line, and the owner records a customer's certificate.
    const saas = await call(`${base}/contacts`, { cookie, body: { kind: "customer", name: "SaaS Buyer", address: { line1: "1 Market St", city: "San Francisco", zip: "94105" } } });
    const line = { taxCategory: "prewritten_software", account: "4000", quantity: "1", unitPrice: "500.00", servicePeriodStart: "2027-01-01", servicePeriodEnd: "2027-12-31" };
    expect((await call(`${base}/sales-tax-settings`, { cookie, body: { sellerPermit: "sr ab 100-200300", cdtfaAccount: "138-237232", filingFrequency: "quarterly", startDate: "2026-12-01" } })).data)
      .toEqual({ sellerPermit: "SR AB 100-200300", cdtfaAccount: "138-237232", filingFrequency: "quarterly", startDate: "2026-12-01" });
    const p1 = await call(`${base}/invoices/tax-preview`, { cookie, body: { contactId: saas.data.id, issueDate: "2026-12-20", lines: [line] } });
    expect(p1.data).toMatchObject({ source: "lookup", taxable: [true], rules: "us-ca-sales-tax-2027@2027.1.0", warnings: [] });
    const withCert = await call(`${base}/contacts/${saas.data.id}`, { cookie, body: { mpu: { caPercent: "25", certificateDate: "2026-12-01" } } });
    expect(withCert.data.mpu).toEqual({ caPercent: "25", certificateDate: "2026-12-01" });
    const p2 = await call(`${base}/invoices/tax-preview`, { cookie, body: { contactId: saas.data.id, issueDate: "2026-12-20", lines: [line] } });
    expect(p2.data).toMatchObject({ taxShare: ["0.2500"], exemptions: ["mpu"] });
    const permit = await call(`${base}/contacts/${saas.data.id}`, { cookie, body: { directPayPermit: "DP 9", mpu: null } });
    expect(permit.data).toMatchObject({ directPayPermit: "DP 9", mpu: null });
    const inv3 = await call(`${base}/invoices`, { cookie, body: { contactId: saas.data.id, issueDate: "2026-12-20", lines: [line] } });
    expect(inv3.data).toMatchObject({ taxMinor: "0", taxSource: "direct_pay" });
    expect(inv3.data.lines[0]).toMatchObject({ taxExemption: "direct_pay", servicePeriodStart: "2027-01-01" });
  });
});

describe("tax lookup health check", () => {
  const get = (taxRates?: RateLookup) => handleApi(new Request("https://alt-qbo.test/api/health/tax-lookup"), pool, { taxRates }).then((r) => r.json());
  it("looks up one fixed address and says whether it worked", async () => {
    const seen: string[] = [];
    expect(await get(async (a) => { seen.push(a.zip); return { rate: "0.10250", jurisdiction: "Los Angeles" }; }))
      .toMatchObject({ ok: true, rate: "0.10250", jurisdiction: "Los Angeles" });
    expect(seen).toEqual(["90012"]);
    expect(await get(async () => { throw new Error("the CDTFA rate lookup answered 503"); })).toEqual({ ok: false, error: "the CDTFA rate lookup answered 503" });
    expect(await get()).toMatchObject({ ok: false });
  });
});
