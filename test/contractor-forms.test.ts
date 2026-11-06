import { describe, expect, it } from "vitest";
import { withSystem, withTenant, type Tx } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import { createContact, issueDocument, recordPayment } from "../src/core/documents.js";
import { createOrganization, createEntity } from "../src/core/tenancy.js";
import { contractorFormsCsv, contractorSummary, getContractorInfo, prepareContractorForms, setContractorInfo } from "../src/core/contractor-forms.js";
import { accountant, bookkeeper, owner, pool, setupCaliforniaBusiness } from "./helpers.js";

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

/** A vendor, a bill and its payment on a date. */
async function paid(t: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>, base: { orgId: string; entityId: string }, name: string, amount: string, date: string, account: string, address = true) {
  const vendor = await t((tx) => createContact(tx, {
    ...base, kind: "vendor", name, actor: owner,
    ...(address ? { address: { line1: "1 Main St", city: "Fresno", state: "CA", zip: "93701" } } : {}),
  }));
  const bill = await t((tx) => issueDocument(tx, {
    ...base, kind: "bill", contactId: vendor.id, issueDate: date, idempotencyKey: `b-${name}`, actor: bookkeeper,
    lines: [{ account, description: "Work", quantity: "1", unitPrice: amount }],
  }));
  await t((tx) => recordPayment(tx, { ...base, documentId: bill.id, date, amount, idempotencyKey: `p-${name}`, actor: bookkeeper }));
  return vendor;
}

describe("1099-NEC preparation", () => {
  it("reports marked, unincorporated vendors over the threshold, and masks their numbers", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
    const base = { orgId: org.id, entityId: entity.id };
    await withSystem(pool, (tx) => tx.query("UPDATE entities SET ein = '12-3456789' WHERE id = $1", [entity.id]));

    const ana = await paid(t, base, "Ana Ruiz Design", "2500.00", "2026-03-10", "6300");
    const small = await paid(t, base, "Sam Small", "1500.00", "2026-04-10", "6300");
    const corp = await paid(t, base, "Big Agency Inc", "9000.00", "2026-05-10", "6300");
    const law = await paid(t, base, "Lee Law PC", "3000.00", "2026-05-11", "6300");
    await paid(t, base, "Unmarked Joe", "4000.00", "2026-05-12", "6300");

    await t((tx) => setContractorInfo(tx, { ...base, contactId: ana.id, form: "1099_nec", tin: "123-45-6789", legalName: "Ana Ruiz", actor: owner }));
    await t((tx) => setContractorInfo(tx, { ...base, contactId: small.id, form: "1099_nec", tin: "987654321", tinKind: "ein", actor: accountant }));
    await t((tx) => setContractorInfo(tx, { ...base, contactId: corp.id, form: "1099_nec", recipientType: "corporation", actor: owner }));
    await t((tx) => setContractorInfo(tx, { ...base, contactId: law.id, form: "1099_nec", recipientType: "attorney", actor: owner }));

    const s = await t((tx) => contractorSummary(tx, entity.id, 2026));
    expect(s).toMatchObject({ form: "1099_nec", thresholdMinor: 200000n, dueDate: "2027-01-31", summary: { forms: 2, totalMinor: 550000n } });
    const by = Object.fromEntries(s.vendors.map((v) => [v.name, v]));
    expect(by["Ana Ruiz Design"]).toMatchObject({ reportable: true, paidMinor: 250000n, tinLast4: "6789", notes: [] });
    expect(by["Sam Small"]!.reportable).toBe(false);
    expect(by["Sam Small"]!.notes[0]).toMatch(/less than \$2,000/);
    expect(by["Big Agency Inc"]!.notes[0]).toMatch(/Corporations/);
    expect(by["Lee Law PC"]!.reportable).toBe(true);
    expect(by["Lee Law PC"]!.notes[0]).toMatch(/Missing their SSN or EIN/);
    expect(by["Unmarked Joe"]!.notes[0]).toMatch(/Not marked/);
    expect(s.warnings.some((w) => /missing a tax number/.test(w))).toBe(true);

    // Nothing was paid in 2027, and that year's indexed threshold isn't known yet.
    const s27 = await t((tx) => contractorSummary(tx, entity.id, 2027));
    expect(s27).toMatchObject({ thresholdMinor: 200000n, dueDate: "2028-01-31", summary: { forms: 0, totalMinor: 0n }, vendors: [] });
    expect(s27.warnings[0]).toMatch(/2027 threshold isn't confirmed/);

    const masked = await t((tx) => prepareContractorForms(tx, entity.id, 2026));
    expect(masked.map((f) => [f.recipient.name, f.recipient.tin, f.amountMinor])).toEqual([["Ana Ruiz", "***-**-6789", 250000n], ["Lee Law PC", null, 300000n]]);
    expect(masked[0]!.payer).toMatchObject({ name: "Sunset Design Studio LLC", tin: "12-3456789" });

    // A bookkeeper asking for the full numbers still gets them masked; an owner gets them, and it's logged.
    const asBookkeeper = await t((tx) => prepareContractorForms(tx, entity.id, 2026, { full: true, orgId: org.id, actor: bookkeeper }));
    expect(asBookkeeper[0]!.recipient.tin).toBe("***-**-6789");
    const full = await t((tx) => prepareContractorForms(tx, entity.id, 2026, { full: true, orgId: org.id, actor: owner }));
    expect(full[0]!.recipient.tin).toBe("123-45-6789");
    const logged = await t((tx) => tx.query("SELECT count(*)::int AS n FROM audit_events WHERE entity_id = $1 AND action = 'contractor_forms.viewed_with_tin'", [entity.id]));
    expect(logged.rows[0].n).toBe(1);

    const csv = contractorFormsCsv(full);
    expect(csv.split("\n")[1]).toBe("1099-NEC,2026,Sunset Design Studio LLC,12-3456789,Ana Ruiz,123-45-6789,1 Main St,Fresno,CA,93701,1 Nonemployee compensation,2500.00");

    // The number is sealed at rest and never in the audit log.
    const row = (await t((tx) => tx.query("SELECT tin_sealed FROM contractor_tax_info WHERE contact_id = $1", [ana.id]))).rows[0];
    expect(row.tin_sealed).not.toContain("123456789");
    const audit = await t((tx) => tx.query("SELECT after::text AS a FROM audit_events WHERE entity_id = $1 AND action = 'contractor.updated'", [entity.id]));
    expect(audit.rows.every((r) => !r.a.includes("123456789") && !r.a.includes("123-45-6789"))).toBe(true);
  });

  it("keeps the number when it's left out, clears the form, and checks who and what", async () => {
    const { org, entity } = await setupCaliforniaBusiness("Ridge Co");
    const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
    const base = { orgId: org.id, entityId: entity.id };
    const v = await t((tx) => createContact(tx, { ...base, kind: "vendor", name: "Pat", actor: owner }));
    const cust = await t((tx) => createContact(tx, { ...base, kind: "customer", name: "Client", actor: owner }));
    await t((tx) => setContractorInfo(tx, { ...base, contactId: v.id, form: "1099_nec", tin: "123-45-6789", actor: owner }));
    const kept = await t((tx) => setContractorInfo(tx, { ...base, contactId: v.id, form: "1099_nec", recipientType: "llc", actor: owner }));
    expect(kept).toMatchObject({ recipientType: "llc", tinKind: "ssn", tinLast4: "6789" });
    await expectLedgerError(t((tx) => setContractorInfo(tx, { ...base, contactId: v.id, form: "1099_nec", tin: "12345", actor: owner })), "INVALID");
    await expectLedgerError(t((tx) => setContractorInfo(tx, { ...base, contactId: v.id, form: "1099_nec", tin: "046 454 286", tinKind: "sin", actor: owner })), "INVALID");
    await expectLedgerError(t((tx) => setContractorInfo(tx, { ...base, contactId: v.id, form: "t4a", actor: owner })), "INVALID");
    await expectLedgerError(t((tx) => setContractorInfo(tx, { ...base, contactId: cust.id, form: "1099_nec", actor: owner })), "INVALID");
    await expectLedgerError(t((tx) => setContractorInfo(tx, { ...base, contactId: v.id, form: "1099_nec", actor: bookkeeper })), "FORBIDDEN");
    await t((tx) => setContractorInfo(tx, { ...base, contactId: v.id, form: null, actor: owner }));
    expect(await t((tx) => getContractorInfo(tx, v.id))).toBeNull();
  });
});

describe("T4A preparation", () => {
  it("prepares box 048 slips over $500 for a Canadian business, due the last day of February", async () => {
    const org = await withSystem(pool, (tx) => createOrganization(tx, { name: "Trailhead Contracting", actor: owner }));
    const entity = await withTenant(pool, org.id, (tx) =>
      createEntity(tx, { orgId: org.id, legalName: "Trailhead Ltd", entityType: "ca_corporation", place: { country: "CA", region: "BC" }, firstFiscalYear: 2026, actor: owner }),
    );
    const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
    const base = { orgId: org.id, entityId: entity.id };
    const expense = (await t((tx) => tx.query("SELECT code FROM accounts WHERE entity_id = $1 AND type = 'expense' AND system_key IS NULL ORDER BY code LIMIT 1", [entity.id]))).rows[0].code;
    const vendor = await t((tx) => createContact(tx, { ...base, kind: "vendor", name: "Morgan Fixes", actor: owner }));
    const bill = await t((tx) => issueDocument(tx, {
      ...base, kind: "bill", contactId: vendor.id, issueDate: "2026-06-01", idempotencyKey: "b1", actor: bookkeeper,
      lines: [{ account: expense, description: "Repairs", quantity: "1", unitPrice: "800.00" }],
    }));
    await t((tx) => recordPayment(tx, { ...base, documentId: bill.id, date: "2026-06-15", amount: "800.00", idempotencyKey: "p1", actor: bookkeeper }));
    await expectLedgerError(t((tx) => setContractorInfo(tx, { ...base, contactId: vendor.id, form: "1099_nec", actor: owner })), "INVALID");
    await t((tx) => setContractorInfo(tx, { ...base, contactId: vendor.id, form: "t4a", tin: "130 692 544", actor: owner }));
    const s = await t((tx) => contractorSummary(tx, entity.id, 2026));
    expect(s).toMatchObject({ form: "t4a", thresholdMinor: 50000n, dueDate: "2027-02-28", summary: { forms: 1, totalMinor: 80000n } });
    const [slip] = await t((tx) => prepareContractorForms(tx, entity.id, 2026, { full: true, orgId: org.id, actor: owner }));
    expect(slip).toMatchObject({ box: "048 Fees for services", recipient: { name: "Morgan Fixes", tin: "130 692 544" } });
  });
});
