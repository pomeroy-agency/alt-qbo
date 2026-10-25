import { describe, expect, it } from "vitest";
import { withTenant, type Tx } from "../src/db/pool.js";
import { handleApi } from "../src/app/api.js";
import { cached, parseCdtfaRate } from "../src/app/cdtfa.js";
import { LedgerError } from "../src/core/errors.js";
import { createContact, voidDocument } from "../src/core/documents.js";
import { createItem, decideSalesTax, explainTax, issueInvoice, salesTaxReport, setBusinessAddress, updateItem, type RateLookup } from "../src/core/sales-tax.js";
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
  return { org, entity, t, base, contact };
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
    const su = await call("/api/auth/signup", { body: { name: "T", email: `tax${Date.now()}@example.com`, password: "long-enough-pw", orgName: "Tax Co", inviteCode: "c" } });
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
