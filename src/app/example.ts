import type pg from "pg";
import { withSystem, withTenant } from "../db/pool.js";
import { importBankCsv } from "../core/bank.js";
import { createContact, issueDocument, recordPayment } from "../core/documents.js";
import { createItem, issueInvoice, setBusinessAddress, type InvoiceLineInput } from "../core/sales-tax.js";
import { postJournal, type Actor } from "../core/ledger.js";
import { createEntity, createOrganization } from "../core/tenancy.js";

// An example business to look around before entering real figures, like
// Ledgerline's Riverside Coffee Roasters. It lives in an organisation of its
// own so the person's real books, and anyone they invite there, never see it.

export const EXAMPLE_ORG_NAME = "Example: Sunset Design Studio";

export async function createExampleBusiness(pool: pg.Pool, user: { id: string; email: string }): Promise<{ orgId: string; entityId: string }> {
  const actor: Actor = { id: `user:${user.email}`, role: "owner" };
  const org = await withSystem(pool, async (tx) => {
    const o = await createOrganization(tx, { name: EXAMPLE_ORG_NAME, actor });
    await tx.query("INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')", [user.id, o.id]);
    return o;
  });
  const entityId = await withTenant(pool, org.id, async (tx) => {
    const e = await createEntity(tx, {
      orgId: org.id, legalName: "Sunset Design Studio LLC", entityType: "llc_single",
      place: { country: "US", region: "CA" }, firstFiscalYear: 2026, ein: "12-3456789", actor,
    });
    const base = { orgId: org.id, entityId: e.id, actor };
    let n = 0;
    const key = () => `example-${++n}`;

    await postJournal(tx, {
      ...base, date: "2026-01-02", memo: "Owner's starting investment", sourceType: "opening_balance", idempotencyKey: key(),
      lines: [{ account: "1000", debit: "15000.00" }, { account: "3000", credit: "15000.00" }],
    });

    await setBusinessAddress(tx, { ...base, address: { line1: "2150 Sunset Blvd", city: "Los Angeles", state: "CA", zip: "90026" } });
    const contact = async (kind: "customer" | "vendor", name: string, email?: string, address?: { line1: string; city: string; state: string; zip: string }) =>
      (await createContact(tx, { ...base, kind, name, email, address })).id;
    const harbor = await contact("customer", "Harbor Coffee Co", "ap@harborcoffee.example", { line1: "88 Harbor Dr", city: "San Diego", state: "CA", zip: "92101" });
    const dental = await contact("customer", "Mission Dental Group", "office@missiondental.example", { line1: "450 S Main St", city: "Los Angeles", state: "CA", zip: "90013" });
    const lark = await contact("customer", "Lark & Finch Bakery", "hello@larkfinch.example", { line1: "1200 SE Division St", city: "Portland", state: "OR", zip: "97202" });
    const studio = await contact("vendor", "Mission Street Studios");
    const adobe = await contact("vendor", "Adobe");
    const printer = await contact("vendor", "Bay Area Print Shop");

    const item = async (name: string, taxCategory: string, unitPrice: string) => (await createItem(tx, { ...base, name, taxCategory, unitPrice, account: "4000" })).id;
    const design = await item("Design work (per hour)", "professional_service", "125.00");
    const brochures = await item("Printed brochures", "printed_materials", "1.20");
    // The example is made without asking the CDTFA, so its one taxable invoice carries a rate set by hand.
    const exampleRate = { ratePercent: "9.75", reason: "Example business: the Los Angeles rate, entered by hand" };
    const invoice = async (contactId: string, issueDate: string, dueDate: string, lines: InvoiceLineInput[], manual?: typeof exampleRate) =>
      issueInvoice(tx, { ...base, contactId, issueDate, dueDate, lines, manual, idempotencyKey: key() });
    const service = (description: string, unitPrice: string, quantity = "1"): InvoiceLineInput => ({ itemId: design, description, quantity, unitPrice });
    const bill = async (contactId: string, issueDate: string, dueDate: string, account: string, description: string, unitPrice: string, reference?: string) =>
      issueDocument(tx, { ...base, kind: "bill", contactId, issueDate, dueDate, reference, lines: [{ account, description, quantity: "1", unitPrice }], idempotencyKey: key() });
    const pay = async (documentId: string, date: string, amount: bigint) =>
      recordPayment(tx, { ...base, documentId, date, amount, idempotencyKey: key() });

    // Design work isn't taxable in California; the printed brochures are, at the Los Angeles rate.
    const i1 = await invoice(harbor, "2026-02-03", "2026-03-05", [service("Brand identity: logo and style guide", "4800.00")]);
    await pay(i1.id, "2026-03-01", i1.totalMinor);
    const i2 = await invoice(dental, "2026-04-14", "2026-05-14", [
      service("Website redesign, phase 1", "6500.00"),
      { itemId: brochures, description: "Printed brochures (500)", quantity: "500" },
    ], exampleRate);
    await pay(i2.id, "2026-05-12", i2.totalMinor);
    const i3 = await invoice(lark, "2026-07-08", "2026-08-07", [service("Menu and packaging design", "125.00", "32")]);
    await pay(i3.id, "2026-08-20", 200000n);
    await invoice(harbor, "2026-08-25", "2026-09-24", [service("Seasonal campaign: posters and social", "3200.00")]);
    await invoice(dental, "2026-10-06", "2026-11-05", [service("Website redesign, phase 2", "5200.00")]);

    for (const [i, month] of ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].entries()) {
      const b = await bill(studio, `2026-${month}-01`, `2026-${month}-05`, "6400", "Studio rent", "1450.00", `MSS-26${month}`);
      if (i < 9) await pay(b.id, `2026-${month}-04`, b.totalMinor);
    }
    const ad = await bill(adobe, "2026-03-15", "2026-03-15", "6500", "Creative Cloud, annual", "659.88");
    await pay(ad.id, "2026-03-15", ad.totalMinor);
    await bill(printer, "2026-10-12", "2026-11-11", "5000", "Brochure printing for Mission Dental", "410.00", "BAP-7781");

    await importBankCsv(tx, {
      ...base, bankAccount: "1000", fileName: "example-statement.csv",
      csv: [
        "Date,Description,Amount",
        "10/02/2026,STRIPE PAYOUT LARK FINCH,1000.00",
        "10/07/2026,ADOBE *PHOTOSTOCK,-29.99",
        "10/09/2026,BLUE BOTTLE COFFEE SF,-18.50",
        "10/14/2026,PG&E WEB ONLINE,-142.33",
        "10/20/2026,MONTHLY SERVICE FEE,-15.00",
      ].join("\n"),
    });
    return e.id;
  });
  return { orgId: org.id, entityId };
}
