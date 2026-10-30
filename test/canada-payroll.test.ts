import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withSystem, withTenant } from "../src/db/pool.js";
import { createEntity, createOrganization } from "../src/core/tenancy.js";
import { accountBalance } from "../src/core/reports.js";
import { cleanAddress } from "../src/core/sales-tax.js";
import { cleanSin } from "../src/core/pii.js";
import { resolveRules } from "../src/rules/index.js";
import { canadaDeductions } from "../src/payroll/canada.js";
import { createEmployee, setStateTaxRate } from "../src/payroll/employees.js";
import { calculateSavedRun, payRunInputFromEmployees } from "../src/payroll/runs.js";
import { approveAndPostPayRun, calculatePayRun, payRunJournalLines } from "../src/payroll/pay-run.js";
import { approver, bookkeeper, owner, pool } from "./helpers.js";

async function setupCanadianBusiness(region: string, entityType: "ca_sole_prop" | "ca_partnership" | "ca_corporation") {
  const org = await withSystem(pool, (tx) => createOrganization(tx, { name: `Trailhead ${region}`, actor: owner }));
  const entity = await withTenant(pool, org.id, (tx) =>
    createEntity(tx, { orgId: org.id, legalName: `Trailhead ${region} Ltd`, entityType, place: { country: "CA", region }, firstFiscalYear: 2026, actor: owner }),
  );
  return { org, entity };
}

const balanced = (lines: ReturnType<typeof payRunJournalLines>) => {
  const dr = lines.reduce((s, l) => s + ((l.debit as bigint | undefined) ?? 0n), 0n);
  const cr = lines.reduce((s, l) => s + ((l.credit as bigint | undefined) ?? 0n), 0n);
  return dr === cr;
};

const req = (employeeId: string) => ({ periodStart: "2026-08-01", periodEnd: "2026-08-14", payDate: "2026-08-21", lines: [{ employeeId }] });

describe("Canadian details", () => {
  it("checks a SIN's check digit and keeps postal codes as A1A 1A1", () => {
    expect(cleanSin("130 692 544")).toBe("130692544");
    expect(() => cleanSin("130 692 545")).toThrow(/valid Social Insurance Number/);
    expect(() => cleanSin("046 454 286")).toThrow();
    expect(cleanAddress({ line1: "1 Water St", city: "Vancouver", state: "bc", zip: "v6b1a1" })).toEqual({ line1: "1 Water St", city: "Vancouver", state: "BC", zip: "V6B 1A1" });
    expect(() => cleanAddress({ line1: "1 Water St", city: "Vancouver", state: "BC", zip: "94103" })).toThrow(/postal code/);
    expect(cleanAddress({ line1: "1 Main St", city: "Oakland", state: "CA", zip: "94607" })?.zip).toBe("94607");
  });
});

describe("a British Columbia corporation", () => {
  it("sets up on ASPE in CAD with GIFI tax lines and CRA payroll accounts", async () => {
    const { org, entity } = await setupCanadianBusiness("BC", "ca_corporation");
    expect(entity).toMatchObject({ country: "CA", region: "BC", framework: "ASPE", functionalCurrency: "CAD", taxReturnType: "t2", coaTemplate: "ca-service" });
    const { rows } = await withTenant(pool, org.id, (tx) =>
      tx.query("SELECT code, system_key, tax_line FROM accounts WHERE entity_id = $1 ORDER BY code", [entity.id]),
    );
    const byKey = Object.fromEntries(rows.filter((r) => r.system_key).map((r) => [r.system_key, r]));
    expect(byKey.cra_payroll_payable.tax_line).toBe("GIFI.2680");
    expect(byKey.workers_comp_payable).toBeDefined();
    expect(byKey.service_revenue.tax_line).toBe("GIFI.8000");
    expect(byKey.fit_payable).toBeUndefined();
    expect(byKey.rq_payroll_payable).toBeUndefined();
  });

  it("pays a salaried employee with CPP, EI, income tax and WorkSafeBC, and posts a balanced run", async () => {
    const { org, entity } = await setupCanadianBusiness("BC", "ca_corporation");
    const e = await withTenant(pool, org.id, (tx) =>
      createEmployee(tx, {
        orgId: org.id, entityId: entity.id, actor: owner, name: "Avery Chen", hireDate: "2026-07-01",
        payType: "salary", payFrequency: "biweekly", payRate: "52000", sin: "130 692 544",
        address: { line1: "1 Water St", city: "Vancouver", state: "BC", zip: "v6b 1a1" },
        td1: { federalClaim: "16452", provincialClaim: "13216", extraFederalTax: "0", cppExempt: false },
      }),
    );
    expect(e.ssnLast4).toBe("2544");
    expect(e.address?.zip).toBe("V6B 1A1");
    expect(e.td1).toEqual({ federalClaim: "16452", provincialClaim: "13216" });

    // WorkSafeBC sets each employer's rate, so the run waits for it.
    const first = await withTenant(pool, org.id, (tx) => payRunInputFromEmployees(tx, entity.id, req(e.id), "run-1"));
    expect(calculatePayRun({ ...first, live: false }).blockers.join()).toMatch(/WorkSafeBC premium rate/);
    await withTenant(pool, org.id, (tx) => setStateTaxRate(tx, { orgId: org.id, entityId: entity.id, code: "BC_WCB", rate: "0.0155", actor: owner }));

    const input = await withTenant(pool, org.id, (tx) => payRunInputFromEmployees(tx, entity.id, req(e.id), "run-1"));
    const run = calculatePayRun({ ...input, live: false });
    expect(run.blockers).toEqual([]);
    const tax = Object.fromEntries(run.paychecks[0]!.taxes.map((t) => [t.code, t.amountMinor]));
    // CPP: (2,000 - 134.61 exemption) x 5.95% = 110.99; EI 2,000 x 1.63% = 32.60, employer 1.4 times.
    expect(tax.CPP_EE).toBe(11099n);
    expect(tax.CPP_ER).toBe(11099n);
    expect(tax.EI_EE).toBe(3260n);
    expect(tax.EI_ER).toBe(4564n);
    expect(tax.BC_WCB).toBe(3100n);
    const rules = resolveRules({ country: "CA", region: "BC" }, "2026-08-21");
    const d = canadaDeductions(rules.federal as any, rules.province!, { periodsPerYear: 26, gross: "2000.00", federalClaim: "16452", provincialClaim: "13216" });
    expect(tax.CA_FIT).toBe(BigInt(d.federalTax.mul(100).toFixed(0)));
    expect(tax.CA_PIT).toBe(BigInt(d.provincialTax.mul(100).toFixed(0)));
    expect(run.paychecks[0]!.taxes.find((t) => t.code === "CA_FIT")?.agency).toBe("CRA");

    expect(balanced(payRunJournalLines(run))).toBe(true);
    await withTenant(pool, org.id, (tx) => approveAndPostPayRun(tx, { orgId: org.id, entityId: entity.id, run, preparedBy: bookkeeper, approvedBy: approver }));
    const cra = await withTenant(pool, org.id, (tx) => accountBalance(tx, entity.id, "cra_payroll_payable", "2026-08-31"));
    expect(cra).toBe(-(tax.CA_FIT! + tax.CA_PIT! + tax.CPP_EE! + tax.CPP_ER! + tax.EI_EE! + tax.EI_ER!));
    const wcb = await withTenant(pool, org.id, (tx) => accountBalance(tx, entity.id, "workers_comp_payable", "2026-08-31"));
    expect(wcb).toBe(-3100n);

    // Real pay runs use the released Canadian packs.
    const saved = await withTenant(pool, org.id, (tx) => calculateSavedRun(tx, entity.id, { ...input, payRunId: randomUUID() }));
    expect(saved.paychecks[0]!.taxes.find((t) => t.code === "CPP_EE")?.amountMinor).toBe(11099n);
  });
});

describe("a Quebec sole proprietor", () => {
  it("withholds QPP, QPIP and Quebec tax for Revenu Québec, and the health services fund", async () => {
    const { org, entity } = await setupCanadianBusiness("QC", "ca_sole_prop");
    expect(entity.taxReturnType).toBe("t2125");
    const e = await withTenant(pool, org.id, (tx) =>
      createEmployee(tx, {
        orgId: org.id, entityId: entity.id, actor: owner, name: "Camille Roy", hireDate: "2026-07-01",
        payType: "hourly", payFrequency: "weekly", payRate: "25", sin: "130692544",
        address: { line1: "10 rue Saint-Paul", city: "Montréal", state: "QC", zip: "H2Y 1G6" },
      }),
    );
    expect(e.td1).toBeNull();
    await withTenant(pool, org.id, (tx) => setStateTaxRate(tx, { orgId: org.id, entityId: entity.id, code: "QC_CNESST", rate: "0.0125", actor: owner }));
    const input = await withTenant(pool, org.id, (tx) =>
      payRunInputFromEmployees(tx, entity.id, { periodStart: "2026-08-09", periodEnd: "2026-08-15", payDate: "2026-08-21", lines: [{ employeeId: e.id, regularHours: "40" }] }, "run-q"),
    );
    const run = calculatePayRun({ ...input, live: false });
    expect(run.blockers).toEqual([]);
    expect(run.paychecks[0]!.warnings.join()).toMatch(/no TD1 or TP-1015.3/);
    const taxes = run.paychecks[0]!.taxes;
    const codes = taxes.filter((t) => t.amountMinor > 0n).map((t) => t.code);
    expect(codes).toEqual(expect.arrayContaining(["CA_FIT", "QC_PIT", "QPP_EE", "EI_EE", "QPIP_EE", "QPP_ER", "EI_ER", "QPIP_ER", "QC_HSF", "QC_CNT", "QC_CNESST"]));
    expect(codes).not.toContain("CPP_EE");
    expect(taxes.find((t) => t.code === "QC_PIT")?.agency).toBe("Revenu Québec");
    // Quebec EI is 1.30%: 1,000 x 1.30% = 13.00; QPIP 0.430% = 4.30; health services fund 1.65% = 16.50.
    const amt = (c: string) => taxes.find((t) => t.code === c)?.amountMinor;
    expect(amt("EI_EE")).toBe(1300n);
    expect(amt("QPIP_EE")).toBe(430n);
    expect(amt("QC_HSF")).toBe(1650n);
    expect(balanced(payRunJournalLines(run))).toBe(true);
    await withTenant(pool, org.id, (tx) => approveAndPostPayRun(tx, { orgId: org.id, entityId: entity.id, run, preparedBy: bookkeeper, approvedBy: approver }));
    const rq = await withTenant(pool, org.id, (tx) => accountBalance(tx, entity.id, "rq_payroll_payable", "2026-08-31"));
    const toRq = taxes.filter((t) => t.agency === "Revenu Québec").reduce((s, t) => s + t.amountMinor, 0n);
    expect(rq).toBe(-toRq);
  });
});
