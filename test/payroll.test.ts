import { describe, expect, it } from "vitest";
import { withTenant } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import { accountBalance, trialBalance } from "../src/core/reports.js";
import { verifyAuditChain } from "../src/core/audit.js";
import { allRulePacks, JurisdictionError, resolveRules, rulePackHash } from "../src/rules/index.js";
import { usFederal2026 } from "../src/rules/us-federal-2026.js";
import { usCalifornia2026 } from "../src/rules/us-ca-2026.js";
import { federalSchedule } from "../src/payroll/federal.js";
import { splitWorkweek } from "../src/payroll/hours.js";
import { calculatePaycheck, type EmployeePayInput } from "../src/payroll/gross-to-net.js";
import { LOCAL_MINIMUM_WAGE_PLACES, localMinimumAbove, localMinimumWage, localWagePlace } from "../src/rules/local-minimum-wage.js";
import { approveAndPostPayRun, calculatePayRun, payRunJournalLines } from "../src/payroll/pay-run.js";
import { approver, bookkeeper, pool, setupCaliforniaBusiness } from "./helpers.js";

const CA = { country: "US", region: "CA" };
const rules = resolveRules(CA, "2026-06-15");

const salaried: EmployeePayInput = {
  employeeId: "emp-1",
  name: "Maya Chen",
  payFrequency: "biweekly",
  salaryPerPeriod: "3000.00",
  overtimeExempt: true,
  w4: { filingStatus: "single_or_mfs", step2Checked: false },
  de4: { filingStatus: "single", regularAllowances: 1 },
  deductions: [
    { kind: "traditional401k", amount: "150.00", description: "401(k)" },
    { kind: "section125", amount: "100.00", description: "Medical premium" },
  ],
};

const tax = (p: ReturnType<typeof calculatePaycheck>, code: string) =>
  p.taxes.find((t) => t.code === code)?.amountMinor ?? 0n;

describe("rule packs", () => {
  it("are frozen, hashed and effective-dated", () => {
    expect(Object.isFrozen(usFederal2026.payroll.socialSecurity)).toBe(true);
    expect(() => {
      (usFederal2026.payroll.socialSecurity as { wageBase: string }).wageBase = "1";
    }).toThrow();
    expect(rules.provenance).toEqual([
      `us-federal@2026.1#${rulePackHash(usFederal2026).slice(0, 12)}`,
      `us-ca@2026.2#${rulePackHash(usCalifornia2026).slice(0, 12)}`,
    ]);
    expect(() => resolveRules(CA, "2027-01-01")).toThrow(JurisdictionError);
    // Greg signed off the 2026 packs on 2026-10-27.
    expect(resolveRules(CA, "2026-06-15", { requireReleased: true }).federal.status).toBe("released");
    // Packs added since then stay drafts until Greg signs them off.
    const drafts: string[] = ["AB", "BC", "MB", "NB", "NL", "NS", "ON", "PE", "QC", "SK", "NT", "NU", "YT"].map((r) => `ca-${r.toLowerCase()}-payroll`);
    for (const p of allRulePacks()) {
      expect(p.sources.length).toBeGreaterThan(0);
      expect(p.status).toBe(drafts.includes(p.id) ? "draft" : "released");
    }
  });

  it("derives the Pub 15-T 2026 MFJ schedules exactly as published", () => {
    const fit = usFederal2026.payroll.incomeTax;
    const asRows = (s: ReturnType<typeof federalSchedule>) => s.map((r) => [Number(r.over), Number(r.base), Number(r.rate)]);
    // IRS Publication 15-T (2026), Worksheet 1A annual tables, Married Filing Jointly.
    expect(asRows(federalSchedule(fit, "mfj", false))).toEqual([
      [0, 0, 0], [19300, 0, 0.1], [44100, 2480, 0.12], [120100, 11600, 0.22], [230700, 35932, 0.24],
      [422850, 82048, 0.32], [531750, 116896, 0.35], [788000, 206583.5, 0.37],
    ]);
    expect(asRows(federalSchedule(fit, "mfj", true))).toEqual([
      [0, 0, 0], [16100, 0, 0.1], [28500, 1240, 0.12], [66500, 5800, 0.22], [121800, 17966, 0.24],
      [217875, 41024, 0.32], [272325, 58448, 0.35], [400450, 103291.75, 0.37],
    ]);
  });

  it("derives the Pub 15-T 2026 single and head-of-household schedules exactly as published", () => {
    const fit = usFederal2026.payroll.incomeTax;
    const asRows = (s: ReturnType<typeof federalSchedule>) => s.map((r) => [Number(r.over), Number(r.base), Number(r.rate)]);
    // IRS Publication 15-T (2026), page 11, checked against the PDF on 2026-10-25.
    expect(asRows(federalSchedule(fit, "single_or_mfs", false))).toEqual([
      [0, 0, 0], [7500, 0, 0.1], [19900, 1240, 0.12], [57900, 5800, 0.22], [113200, 17966, 0.24],
      [209275, 41024, 0.32], [263725, 58448, 0.35], [648100, 192979.25, 0.37],
    ]);
    expect(asRows(federalSchedule(fit, "single_or_mfs", true))).toEqual([
      [0, 0, 0], [8050, 0, 0.1], [14250, 620, 0.12], [33250, 2900, 0.22], [60900, 8983, 0.24],
      [108938, 20512, 0.32], [136163, 29224, 0.35], [328350, 96489.63, 0.37],
    ]);
    expect(asRows(federalSchedule(fit, "hoh", false))).toEqual([
      [0, 0, 0], [15550, 0, 0.1], [33250, 1770, 0.12], [83000, 7740, 0.22], [121250, 16155, 0.24],
      [217300, 39207, 0.32], [271750, 56631, 0.35], [656150, 191171, 0.37],
    ]);
    expect(asRows(federalSchedule(fit, "hoh", true))).toEqual([
      [0, 0, 0], [12075, 0, 0.1], [20925, 885, 0.12], [45800, 3870, 0.22], [64925, 8077.5, 0.24],
      [112950, 19603.5, 0.32], [140175, 28315.5, 0.35], [332375, 95585.5, 0.37],
    ]);
  });
});

describe("local minimum wages", () => {
  it("finds the rate in force for a city on a date", () => {
    expect(localWagePlace("  city of  san jose ")).toBe("San Jose");
    expect(localWagePlace("Fresno")).toBeNull();
    expect(localMinimumWage("San Jose", "2026-03-01", 3)).toMatchObject({ place: "San Jose", rate: "18.45", from: "2026-01-01" });
    expect(localMinimumWage("palo alto", "2026-12-31", 3)?.rate).toBe("18.70");
    expect(localMinimumWage("palo alto", "2027-01-01", 3)?.rate).toBe("19.25");
    expect(localMinimumWage("Belmont", "2027-01-01", 3)?.rate).toBe("19.60");
    // July cities aren't checked before their 2026 rate.
    expect(localMinimumWage("San Francisco", "2026-06-30", 3)).toBeNull();
    expect(localMinimumWage("San Francisco", "2026-07-01", 3)?.rate).toBe("19.61");
    expect(LOCAL_MINIMUM_WAGE_PLACES).toContain("Los Angeles County (unincorporated)");
  });

  it("applies size tiers, and ignores local rates at or below the state's", () => {
    expect(localMinimumWage("Hayward", "2026-05-01", 25)).toBeNull();
    expect(localMinimumWage("Hayward", "2026-05-01", 26)).toMatchObject({ rate: "17.79", sizeNote: expect.stringContaining("26 on file") });
    expect(localMinimumWage("Novato", "2026-05-01", 50)?.rate).toBe("17.46");
    expect(localMinimumWage("Novato", "2026-05-01", 120)?.rate).toBe("17.73");
    expect(localMinimumAbove({ country: "US", region: "CA" }, "16.90", "Oakland", "2026-05-01", 1)?.rate).toBe("17.34");
    // From 2027 the state's 17.40 is above Oakland's 2026 rate.
    expect(localMinimumAbove({ country: "US", region: "CA" }, "17.40", "Oakland", "2027-01-01", 1)).toBeNull();
  });

  it("warns, rather than blocks, when an hourly rate is below the local minimum", () => {
    const hourly: EmployeePayInput = { ...salaried, salaryPerPeriod: undefined, overtimeExempt: undefined, hourlyRate: "18.00", regularHours: "80" };
    const p = calculatePaycheck({ ...hourly, localMinimumWage: { place: "Mountain View", rate: "19.70" } }, rules);
    expect(p.blockers).toEqual([]);
    expect(p.warnings).toContain("hourly rate 18.00 is below the Mountain View minimum wage of 19.70");
    expect(calculatePaycheck({ ...hourly, localMinimumWage: { place: "Oakland", rate: "17.34" } }, rules).warnings
      .some((w) => w.includes("minimum wage"))).toBe(false);
  });
});

describe("California workweek hours", () => {
  const wh = usCalifornia2026.wageHour;
  it("pays daily overtime past 8 hours and double time past 12", () => {
    expect(splitWorkweek([13, 0, 0, 0, 0, 0, 0], wh)).toEqual({ regular: "8", overtime: "4", doubleTime: "1" });
    expect(splitWorkweek([10, 10, 8, 8, 8, 0, 0], wh)).toEqual({ regular: "40", overtime: "4", doubleTime: "0" });
  });
  it("applies weekly overtime past 40 regular hours and the seventh-day rule", () => {
    expect(splitWorkweek([9, 9, 9, 9, 9, 4, 13], wh)).toEqual({ regular: "40", overtime: "17", doubleTime: "5" });
    expect(splitWorkweek([8, 8, 8, 8, 8, 8, 0], wh)).toEqual({ regular: "40", overtime: "8", doubleTime: "0" });
  });
});

describe("gross-to-net", () => {
  it("computes a biweekly California salaried paycheck to the cent", () => {
    const p = calculatePaycheck(salaried, rules);
    expect(p.grossMinor).toBe(300000n);
    // FIT: (2,750 x 26 - 8,600) = 62,900 annual; 5,800 + 22% x 5,000 = 6,900; / 26 = 265.38
    expect(tax(p, "FIT")).toBe(26538n);
    expect(tax(p, "SS_EE")).toBe(17980n); // 2,900 x 6.2%
    expect(tax(p, "MEDICARE_EE")).toBe(4205n); // 2,900 x 1.45%
    // CA PIT: 71,500 - 5,706 = 65,794; 2,186.15 + 8.8% x 8,252 = 2,912.33; - 168.30; / 26 = 105.54
    expect(tax(p, "CA_PIT")).toBe(10554n);
    expect(tax(p, "CA_SDI")).toBe(3770n); // 2,900 x 1.3%
    expect(p.employeeTaxMinor).toBe(63047n);
    expect(p.netPayMinor).toBe(211953n);
    // Employer: SS 179.80, Medicare 42.05, FUTA 17.40, UI 3.4% 98.60, ETT 2.90
    expect([tax(p, "SS_ER"), tax(p, "MEDICARE_ER"), tax(p, "FUTA"), tax(p, "CA_UI"), tax(p, "CA_ETT")])
      .toEqual([17980n, 4205n, 1740n, 9860n, 290n]);
    expect(p.employerTaxMinor).toBe(34075n);
    expect(p.blockers).toEqual([]);
  });

  it("stops Social Security, FUTA, UI and ETT at their wage bases and starts Additional Medicare over $200k", () => {
    const p = calculatePaycheck(
      { ...salaried, ytd: { socialSecurityWages: 18300000n, medicareWages: 19900000n, futaWages: 700000n, stateWages: { CA_UI: 600000n, CA_ETT: 600000n } } },
      rules,
      { stateRates: { CA_UI: "0.062" } },
    );
    expect(tax(p, "SS_EE")).toBe(9300n); // 1,500 left under the $184,500 base
    expect(tax(p, "ADDL_MEDICARE_EE")).toBe(1710n); // 0.9% x 1,900 over $200,000
    expect(tax(p, "FUTA")).toBe(0n);
    expect(tax(p, "CA_UI")).toBe(6200n); // assigned 6.2% x 1,000 left under $7,000
    expect(tax(p, "CA_ETT")).toBe(100n);
    expect(tax(p, "CA_SDI")).toBe(3770n); // no SDI wage limit
  });

  it("pays hourly overtime and accrues sick leave", () => {
    const hours = splitWorkweek([10, 10, 8, 8, 8, 0, 0], usCalifornia2026.wageHour);
    const p = calculatePaycheck(
      {
        employeeId: "emp-2", name: "Luis Ortega", payFrequency: "weekly", hourlyRate: "25.00",
        regularHours: hours.regular, overtimeHours: hours.overtime, doubleTimeHours: hours.doubleTime,
        w4: { filingStatus: "mfj", step2Checked: false }, de4: { filingStatus: "married", regularAllowances: 2 },
        sickLeave: { balanceHours: "10" },
      },
      rules,
    );
    expect(p.earnings.map((e) => [e.code, e.amountMinor])).toEqual([["REGULAR", 100000n], ["OVERTIME", 15000n]]);
    expect(p.grossMinor).toBe(115000n);
    expect(p.sickLeave).toEqual({ accruedHours: "1.4667", usedHours: "0", balanceHours: "11.4667" });
  });

  it("pays overtime on a nondiscretionary bonus (Alvarado) and on commission, but not on a discretionary bonus", () => {
    const base: EmployeePayInput = {
      employeeId: "emp-3", name: "Ana Ruiz", payFrequency: "weekly", hourlyRate: "20.00",
      regularHours: "40", overtimeHours: "5", doubleTimeHours: "1",
      w4: { filingStatus: "single_or_mfs", step2Checked: false }, de4: { filingStatus: "single", regularAllowances: 1 },
    };
    const extra = (p: ReturnType<typeof calculatePaycheck>) => p.earnings.find((e) => e.code === "OVERTIME_ON_BONUS")?.amountMinor ?? 0n;
    // $400 / 40 non-overtime hours = $10; 1.5 x $10 x 5 + 2 x $10 x 1 = $95.
    expect(extra(calculatePaycheck({ ...base, bonus: "400" }, rules))).toBe(9500n);
    expect(extra(calculatePaycheck({ ...base, bonus: "400", bonusDiscretionary: true }, rules))).toBe(0n);
    // $460 / 46 hours = $10; 0.5 x $10 x 5 + 1 x $10 x 1 = $35.
    expect(extra(calculatePaycheck({ ...base, commission: "460" }, rules))).toBe(3500n);
    expect(extra(calculatePaycheck({ ...base, overtimeHours: "0", doubleTimeHours: "0", bonus: "400" }, rules))).toBe(0n);
  });

  it("pays sick leave taken, refuses more than the balance, front-loads 40 hours, and accrues for exempt employees at 40 hours a week", () => {
    const hourly: EmployeePayInput = {
      employeeId: "emp-4", name: "Kai Lee", payFrequency: "weekly", hourlyRate: "25.00", regularHours: "32",
      w4: { filingStatus: "single_or_mfs", step2Checked: false }, de4: { filingStatus: "single", regularAllowances: 1 },
      sickLeave: { balanceHours: "10", usedHours: "8" },
    };
    const used = calculatePaycheck(hourly, rules);
    expect(used.earnings.find((e) => e.code === "SICK")?.amountMinor).toBe(20000n);
    expect(used.sickLeave).toEqual({ accruedHours: "1.0667", usedHours: "8", balanceHours: "3.0667" });
    expect(calculatePaycheck({ ...hourly, sickLeave: { balanceHours: "4", usedHours: "8" } }, rules).blockers.join()).toMatch(/only 4 available/);
    const front = calculatePaycheck({ ...hourly, sickLeave: { balanceHours: "6", usedHours: "8", policy: "front_load", grantHours: "40" } }, rules);
    expect(front.sickLeave).toEqual({ accruedHours: "0", usedHours: "8", grantedHours: "40", balanceHours: "32" });
    const exempt = calculatePaycheck({ ...salaried, sickLeave: { balanceHours: "0", deemedHoursWorked: "80" } }, rules);
    expect(exempt.sickLeave?.accruedHours).toBe("2.6667");
    // Switching to front-loading never takes away hours already earned.
    expect(calculatePaycheck({ ...hourly, sickLeave: { balanceHours: "52", policy: "front_load", grantHours: "40" } }, rules).sickLeave?.balanceHours).toBe("52");
  });

  it("withholds no California PIT under the low-income exemption", () => {
    const p = calculatePaycheck({ ...salaried, payFrequency: "monthly", salaryPerPeriod: "1500.00", overtimeExempt: false, deductions: [] }, rules);
    expect(tax(p, "CA_PIT")).toBe(0n);
  });

  it("blocks pay below the California minimum wage and exempt status below the salary floor", () => {
    const low = calculatePaycheck({ ...salaried, salaryPerPeriod: undefined, hourlyRate: "15.00", regularHours: "40", overtimeExempt: false }, rules);
    expect(low.blockers[0]).toMatch(/below the California minimum wage of 16.90/);
    const exempt = calculatePaycheck({ ...salaried, salaryPerPeriod: "2500.00" }, rules);
    expect(exempt.blockers[0]).toMatch(/below the California exempt minimum of 70304/);
  });
});

describe("pay runs", () => {
  const runInput = {
    payRunId: "pr-2026-06-15",
    kind: "regular" as const,
    periodStart: "2026-06-01",
    periodEnd: "2026-06-14",
    payDate: "2026-06-19",
    place: CA,
    employees: [salaried],
    live: false,
  };

  it("calculates live runs on the released 2026 packs, and refuses a date with no pack", () => {
    expect(calculatePayRun({ ...runInput, live: true }).paychecks).toHaveLength(1);
    expect(() => calculatePayRun({ ...runInput, payDate: "2027-01-08", live: true })).toThrow(JurisdictionError);
  });

  it("produces a balanced journal with a liability per tax", () => {
    const run = calculatePayRun(runInput);
    const lines = payRunJournalLines(run);
    const dr = lines.reduce((s, l) => s + ((l.debit as bigint | undefined) ?? 0n), 0n);
    const cr = lines.reduce((s, l) => s + ((l.credit as bigint | undefined) ?? 0n), 0n);
    expect(dr).toBe(cr);
    expect(dr).toBe(300000n + 34075n);
  });

  it("needs a second user to approve, then posts once to the ledger and audit log", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const run = calculatePayRun(runInput);
    await expect(
      withTenant(pool, org.id, (tx) =>
        approveAndPostPayRun(tx, { orgId: org.id, entityId: entity.id, run, preparedBy: bookkeeper, approvedBy: bookkeeper }),
      ),
    ).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === "FORBIDDEN");

    const entry = await withTenant(pool, org.id, (tx) =>
      approveAndPostPayRun(tx, { orgId: org.id, entityId: entity.id, run, preparedBy: bookkeeper, approvedBy: approver }),
    );
    expect(entry.sourceType).toBe("pay_run");
    const balances = await withTenant(pool, org.id, async (tx) => ({
      wages: await accountBalance(tx, entity.id, "wages_expense", "2026-06-30"),
      net: await accountBalance(tx, entity.id, "net_pay_clearing", "2026-06-30"),
      fica: await accountBalance(tx, entity.id, "fica_payable", "2026-06-30"),
      pit: await accountBalance(tx, entity.id, "ca_pit_payable", "2026-06-30"),
      k401: await accountBalance(tx, entity.id, "retirement_401k_payable", "2026-06-30"),
    }));
    expect(balances).toEqual({ wages: 300000n, net: -211953n, fica: -(17980n + 4205n) * 2n, pit: -10554n, k401: -15000n });

    // Approving the same run again does not double-post.
    const again = await withTenant(pool, org.id, (tx) =>
      approveAndPostPayRun(tx, { orgId: org.id, entityId: entity.id, run, preparedBy: bookkeeper, approvedBy: approver }),
    );
    expect(again.id).toBe(entry.id);
    expect(again.replayed).toBe(true);
    const tb = await withTenant(pool, org.id, (tx) => trialBalance(tx, entity.id, "2026-12-31"));
    expect(tb.totalDebitMinor).toBe(334075n);

    const { rows } = await withTenant(pool, org.id, (tx) =>
      tx.query("SELECT after FROM audit_events WHERE org_id = $1 AND action = 'pay_run.approved'", [org.id]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].after.totals.netPayMinor).toBe("211953");
    expect(rows[0].after.rulePacks).toEqual(run.rulePacks);
    expect((await withTenant(pool, org.id, (tx) => verifyAuditChain(tx, org.id))).ok).toBe(true);
  });
});
