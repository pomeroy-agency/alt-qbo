import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withSystem, withTenant } from "../src/db/pool.js";
import { createEntity, createOrganization } from "../src/core/tenancy.js";
import { accountBalance } from "../src/core/reports.js";
import { canadaHolidays, onOrNextBusinessDay, quebecHolidays } from "../src/payroll/business-days.js";
import { depositSchedule, type RunTaxes } from "../src/payroll/deposits.js";
import { createEmployee, setStateTaxRate, updateEmployee } from "../src/payroll/employees.js";
import { payRunInputFromEmployees } from "../src/payroll/runs.js";
import { approveAndPostPayRun, calculatePayRun } from "../src/payroll/pay-run.js";
import { recordDepositPayment, setRemitterType, taxDeposits } from "../src/payroll/tax-deposits.js";
import { canadaFormsFor, formRl1, formRoe, formT4, roesFor } from "../src/payroll/canada-forms.js";
import { statePackFor } from "../src/rules/index.js";
import { approver, bookkeeper, owner, pool } from "./helpers.js";

const BC = { country: "CA", region: "BC" };
const QC = { country: "CA", region: "QC" };
let n = 0;
const run = (payDate: string, byTax: Record<string, number>): RunTaxes => ({
  payRunId: `run-${++n}`, payDate,
  byTax: Object.fromEntries(Object.entries(byTax).map(([k, v]) => [k, BigInt(Math.round(v * 100))])),
});
const sched = (runs: RunTaxes[], place: { country: string; region: string }, cra: any = "regular", rq: any = "regular") =>
  depositSchedule(runs, "monthly", place, { canadaRemitters: { cra, rq } });

describe("Canadian holidays", () => {
  it("knows the federal (Canada Labour Code) and Quebec holidays for 2026", () => {
    expect([...canadaHolidays(2026)].sort()).toEqual([
      "2026-01-01", "2026-04-03", "2026-05-18", "2026-07-01", "2026-09-07", "2026-09-30", "2026-10-12", "2026-11-11", "2026-12-25", "2026-12-26",
    ]);
    expect(quebecHolidays(2026).has("2026-06-24")).toBe(true);
    expect(quebecHolidays(2026).has("2026-05-18")).toBe(true); // National Patriots' Day
    expect(quebecHolidays(2026).has("2026-09-30")).toBe(false);
    expect(onOrNextBusinessDay("2026-10-10", "canada")).toBe("2026-10-13"); // Saturday, then Thanksgiving Monday
  });
});

describe("CRA remittance schedule", () => {
  const runs = () => [run("2026-08-14", { CA_FIT: 300, CPP_EE: 100, CPP_ER: 100, EI_EE: 30, EI_ER: 42, BC_WCB: 31 }), run("2026-08-28", { CA_FIT: 300 }), run("2026-09-25", { CA_FIT: 200, CA_PIT: 50 })];

  it("regular remitters pay by the 15th of the next month, without workers' comp", () => {
    const d = sched(runs(), BC);
    expect(d.map((x) => [x.key, x.dueDate, x.amountMinor])).toEqual([
      ["ca_cra_remit:2026-08", "2026-09-15", 87200n],
      ["ca_cra_remit:2026-09", "2026-10-15", 25000n],
    ]);
    expect(d[0]!.byTax.BC_WCB).toBeUndefined();
    expect(d[0]!.period).toBe("August 2026");
  });

  it("quarterly remitters pay by the 15th after the quarter", () => {
    expect(sched(runs(), BC, "quarterly").map((x) => [x.key, x.dueDate])).toEqual([["ca_cra_remit:2026-Q3", "2026-10-15"]]);
  });

  it("threshold 1 remitters pay twice a month, moved past weekends and holidays", () => {
    const d = sched([...runs(), run("2026-09-16", { CA_FIT: 10 })], BC, "threshold1");
    expect(d.map((x) => [x.key, x.dueDate])).toEqual([
      ["ca_cra_remit:2026-08-a", "2026-08-25"],
      ["ca_cra_remit:2026-08-b", "2026-09-10"],
      // October 10 is a Saturday and the 12th is Thanksgiving.
      ["ca_cra_remit:2026-09-b", "2026-10-13"],
    ]);
  });

  it("threshold 2 remitters pay three working days after each quarter-month", () => {
    const d = sched([run("2026-08-05", { CA_FIT: 10 }), run("2026-08-28", { CA_FIT: 10 })], BC, "threshold2");
    expect(d.map((x) => [x.key, x.dueDate])).toEqual([["ca_cra_remit:2026-08-w1", "2026-08-12"], ["ca_cra_remit:2026-08-w4", "2026-09-03"]]);
  });
});

describe("Revenu Québec remittance schedule", () => {
  it("splits Quebec deductions from CRA's, uses Quebec holidays, and adds the yearly CNT and WSDRF", () => {
    const r = [run("2026-06-17", { CA_FIT: 100, EI_EE: 13, EI_ER: 18, QC_PIT: 120, QPP_EE: 60, QPP_ER: 60, QPIP_EE: 4, QPIP_ER: 6, QC_HSF: 16, QC_CNESST: 12, QC_CNT: 1 })];
    const d = sched(r, QC, "regular", "threshold2");
    const by = Object.fromEntries(d.map((x) => [x.key, x]));
    expect(by["ca_cra_remit:2026-06"]!.amountMinor).toBe(13100n);
    // The 15th to 21st closes on Sunday the 21st; June 24 is Quebec's national holiday.
    expect(by["qc_rq_remit:2026-06-w3"]).toMatchObject({ dueDate: "2026-06-25", amountMinor: 27800n });
    expect(by["qc_rlz1s:2026-Y"]).toMatchObject({ dueDate: "2027-03-01", amountMinor: 100n });
    // In a leap year the last day of February is the 29th.
    expect(sched([run("2027-03-05", { QC_CNT: 1 })], QC).find((x) => x.kind === "qc_rlz1s")?.dueDate).toBe("2028-02-29");
  });
});

async function setup(region: string) {
  const org = await withSystem(pool, (tx) => createOrganization(tx, { name: `Remit ${region}`, actor: owner }));
  const entity = await withTenant(pool, org.id, (tx) =>
    createEntity(tx, { orgId: org.id, legalName: `Remit ${region} Inc`, entityType: "ca_corporation", place: { country: "CA", region }, firstFiscalYear: 2026, actor: owner }),
  );
  return { org, entity };
}

const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

/** Calculates, approves and posts a run, and saves it as the pay runs page does. */
async function post(orgId: string, entityId: string, employeeId: string, periodStart: string, periodEnd: string, payDate: string, hours?: string) {
  const input = await withTenant(pool, orgId, (tx) => payRunInputFromEmployees(tx, entityId, { periodStart, periodEnd, payDate, lines: [{ employeeId, ...(hours ? { regularHours: hours } : {}) }] }, randomUUID()));
  const r = calculatePayRun({ ...input, live: false });
  expect(r.blockers).toEqual([]);
  await withTenant(pool, orgId, async (tx) => {
    const posted = await approveAndPostPayRun(tx, { orgId, entityId, run: r, preparedBy: bookkeeper, approvedBy: approver });
    await tx.query(
      `INSERT INTO pay_runs (id, org_id, entity_id, input, result, prepared_by, pay_date, status, approved_by, entry_id) VALUES ($1, $2, $3, $4, $5, $6, $7, 'posted', $8, $9)`,
      [input.payRunId, orgId, entityId, toJson(input), toJson(r), bookkeeper.id, payDate, approver.id, posted.id],
    );
  });
  return r;
}

const tax = (r: ReturnType<typeof calculatePayRun>, code: string) => r.paychecks.reduce((s, p) => s + (p.taxes.find((t) => t.code === code)?.amountMinor ?? 0n), 0n);

describe("a British Columbia employer's remittances, T4 and ROE", () => {
  it("schedules CRA remittances, records a payment, and prepares the T4 and an ROE", async () => {
    const { org, entity } = await setup("BC");
    const e = await withTenant(pool, org.id, (tx) => createEmployee(tx, {
      orgId: org.id, entityId: entity.id, actor: owner, name: "Avery Chen", hireDate: "2026-07-01",
      payType: "salary", payFrequency: "biweekly", payRate: "52000", sin: "130 692 544",
      address: { line1: "1 Water St", city: "Vancouver", state: "BC", zip: "V6B 1A1" },
      td1: { federalClaim: "16452", provincialClaim: "13216" },
    }));
    await withTenant(pool, org.id, (tx) => setStateTaxRate(tx, { orgId: org.id, entityId: entity.id, code: "BC_WCB", rate: "0.0155", actor: owner }));
    const r1 = await post(org.id, entity.id, e.id, "2026-08-01", "2026-08-14", "2026-08-21");
    const r2 = await post(org.id, entity.id, e.id, "2026-08-15", "2026-08-28", "2026-09-04");

    const deps = await withTenant(pool, org.id, (tx) => taxDeposits(tx, entity.id, 2026, "2026-09-10"));
    expect(deps.map((d) => d.key)).toEqual(["ca_cra_remit:2026-08", "ca_cra_remit:2026-09"]);
    const aug = deps[0]!;
    const craCodes = ["CA_FIT", "CA_PIT", "CPP_EE", "CPP_ER", "EI_EE", "EI_ER"];
    expect(aug).toMatchObject({ agency: "CRA", dueDate: "2026-09-15", status: "due_soon" });
    expect(aug.amountMinor).toBe(craCodes.reduce((s, c) => s + tax(r1, c), 0n));

    await withTenant(pool, org.id, (tx) => recordDepositPayment(tx, { orgId: org.id, entityId: entity.id, key: aug.key, paidDate: "2026-09-14", confirmation: "PD7A-1", actor: owner, today: "2026-09-14" }));
    const after = await withTenant(pool, org.id, (tx) => taxDeposits(tx, entity.id, 2026, "2026-09-14"));
    expect(after[0]!.status).toBe("paid");
    const cra = await withTenant(pool, org.id, (tx) => accountBalance(tx, entity.id, "cra_payroll_payable", "2026-09-30"));
    expect(cra).toBe(-craCodes.reduce((s, c) => s + tax(r2, c), 0n));

    // Switching to quarterly regroups the year.
    await withTenant(pool, org.id, (tx) => setRemitterType(tx, { orgId: org.id, entityId: entity.id, agency: "cra", type: "quarterly", actor: owner }));
    const q = await withTenant(pool, org.id, (tx) => taxDeposits(tx, entity.id, 2026, "2026-09-14"));
    expect(q.map((d) => d.key)).toContain("ca_cra_remit:2026-Q3");
    await withTenant(pool, org.id, (tx) => setRemitterType(tx, { orgId: org.id, entityId: entity.id, agency: "cra", type: "regular", actor: owner }));
    await expect(withTenant(pool, org.id, (tx) => setRemitterType(tx, { orgId: org.id, entityId: entity.id, agency: "cra", type: "weekly", actor: owner }))).rejects.toThrow(/remitter type/);

    const pack = statePackFor(BC, "2026-12-31");
    expect(canadaFormsFor(2026, pack).map((f) => [f.slug, f.dueDate])).toEqual([["t4", "2027-03-01"]]);
    const t4 = await withTenant(pool, org.id, (tx) => formT4(tx, { orgId: org.id, entityId: entity.id, year: 2026, fullSsn: true, actor: owner }));
    const line = (l: string) => t4.lines.find((x) => x.line === l)?.value;
    const slip = t4.employees![0] as any;
    expect(slip).toMatchObject({ name: "Avery Chen", sin: "130 692 544", box10: "BC", box14: 400000n, box16: tax(r1, "CPP_EE") + tax(r2, "CPP_EE"), box45: null });
    expect(slip.box22).toBe(tax(r1, "CA_FIT") + tax(r1, "CA_PIT") + tax(r2, "CA_FIT") + tax(r2, "CA_PIT"));
    expect(slip.box24).toBe(400000n);
    expect(line("88")).toBe(1);
    expect(line("82")).toBe(aug.amountMinor);
    expect(line("86")).toBe((line("80") as bigint) - aug.amountMinor);
    expect(t4.warnings.join()).toMatch(/box 45 dental/);
    const masked = await withTenant(pool, org.id, (tx) => formT4(tx, { orgId: org.id, entityId: entity.id, year: 2026, fullSsn: true, actor: bookkeeper }));
    expect((masked.employees![0] as any).sin).not.toBe("130 692 544");

    // No ROE until the employee has a last day.
    await expect(withTenant(pool, org.id, (tx) => formRoe(tx, { orgId: org.id, entityId: entity.id, employeeId: e.id, fullSsn: false, actor: owner }))).rejects.toThrow(/no last day/);
    await withTenant(pool, org.id, (tx) => updateEmployee(tx, { orgId: org.id, entityId: entity.id, employeeId: e.id, actor: owner, terminationDate: "2026-08-28" }));
    expect((await withTenant(pool, org.id, (tx) => roesFor(tx, entity.id, 2026))).map((f) => f.slug)).toEqual([`roe-${e.id}`]);
    const roe = await withTenant(pool, org.id, (tx) => formRoe(tx, { orgId: org.id, entityId: entity.id, employeeId: e.id, fullSsn: false, actor: owner }));
    const rl = (l: string) => roe.lines.find((x) => x.line === l)?.value;
    expect(rl("6")).toMatch(/^B/);
    expect(rl("12")).toBe("2026-08-28");
    expect(rl("15A")).toBe("160"); // two biweekly periods at 40 hours a week
    expect(rl("15C")).toBe(400000n);
    expect(roe.dueDate).toBe("2026-09-02");
    expect(roe.employees).toHaveLength(2);
  });
});

describe("a Quebec employer's remittances and RL-1", () => {
  it("schedules Revenu Québec remittances and prepares the RL-1 with its summary", async () => {
    const { org, entity } = await setup("QC");
    const e = await withTenant(pool, org.id, (tx) => createEmployee(tx, {
      orgId: org.id, entityId: entity.id, actor: owner, name: "Camille Roy", hireDate: "2026-07-01",
      payType: "hourly", payFrequency: "weekly", payRate: "25", sin: "130692544",
      address: { line1: "10 rue Saint-Paul", city: "Montréal", state: "QC", zip: "H2Y 1G6" },
    }));
    await withTenant(pool, org.id, (tx) => setStateTaxRate(tx, { orgId: org.id, entityId: entity.id, code: "QC_CNESST", rate: "0.0125", actor: owner }));
    const r = await post(org.id, entity.id, e.id, "2026-08-09", "2026-08-15", "2026-08-21", "40");

    const deps = await withTenant(pool, org.id, (tx) => taxDeposits(tx, entity.id, 2026, "2026-08-25"));
    const by = Object.fromEntries(deps.map((d) => [d.key, d]));
    expect(by["ca_cra_remit:2026-08"]!.amountMinor).toBe(tax(r, "CA_FIT") + tax(r, "EI_EE") + tax(r, "EI_ER"));
    const rqCodes = ["QC_PIT", "QPP_EE", "QPP2_EE", "QPP_ER", "QPP2_ER", "QPIP_EE", "QPIP_ER", "QC_HSF", "QC_CNESST"];
    expect(by["qc_rq_remit:2026-08"]).toMatchObject({ agency: "Revenu Québec", dueDate: "2026-09-15", amountMinor: rqCodes.reduce((s, c) => s + tax(r, c), 0n) });
    expect(by["qc_rlz1s:2026-Y"]!.amountMinor).toBe(tax(r, "QC_CNT") + tax(r, "QC_WSDRF"));
    await withTenant(pool, org.id, (tx) => recordDepositPayment(tx, { orgId: org.id, entityId: entity.id, key: "qc_rq_remit:2026-08", paidDate: "2026-09-10", actor: owner, today: "2026-09-10" }));

    expect(canadaFormsFor(2026, statePackFor(QC, "2026-12-31")).map((f) => f.slug)).toEqual(["t4", "rl1"]);
    const rl1 = await withTenant(pool, org.id, (tx) => formRl1(tx, { orgId: org.id, entityId: entity.id, year: 2026, fullSsn: false, actor: owner }));
    const slip = rl1.employees![0] as any;
    expect(slip).toMatchObject({ boxA: 100000n, boxE: tax(r, "QC_PIT"), boxB: tax(r, "QPP_EE"), boxC: tax(r, "EI_EE"), boxH: tax(r, "QPIP_EE"), boxI: 100000n });
    const line = (l: string) => rl1.lines.find((x) => x.line === l)?.value;
    expect(line("Paid")).toBe(by["qc_rq_remit:2026-08"]!.amountMinor);
    expect(line("Due")).toBe(by["qc_rlz1s:2026-Y"]!.amountMinor);
    expect(rl1.warnings.join()).toMatch(/Revenu Québec identification number/);

    // On the T4 a Quebec employee's QPP goes in box 17 and Quebec tax stays off box 22.
    const t4 = await withTenant(pool, org.id, (tx) => formT4(tx, { orgId: org.id, entityId: entity.id, year: 2026, fullSsn: false, actor: owner }));
    expect(t4.employees![0]).toMatchObject({ box10: "QC", box16: 0n, box17: tax(r, "QPP_EE"), box22: tax(r, "CA_FIT"), box55: tax(r, "QPIP_EE") });
  });

  it("refuses the RL-1 outside Quebec", async () => {
    const { org, entity } = await setup("ON");
    await expect(withTenant(pool, org.id, (tx) => formRl1(tx, { orgId: org.id, entityId: entity.id, year: 2026, fullSsn: false, actor: owner }))).rejects.toThrow(/Quebec/);
  });
});
