import { describe, expect, it } from "vitest";
import { COUNTRIES, isLive, isSupportedPlace, resolveRules, statePackFor, type ResolvedRules, type StateRulePack } from "../src/rules/index.js";
import { minimumWageOn } from "../src/rules/minimum-wage.js";
import { usCalifornia2026 } from "../src/rules/us-ca-2026.js";
import { calculatePaycheck, type EmployeePayInput } from "../src/payroll/gross-to-net.js";
import { splitWorkweek } from "../src/payroll/hours.js";
import { depositSchedule, type RunTaxes } from "../src/payroll/deposits.js";
import { stateWithholding } from "../src/payroll/state-withholding.js";
import { D } from "../src/core/money.js";

describe("jurisdictions", () => {
  it("lists every US state and DC, and Canada's provinces and territories as coming later", () => {
    const us = COUNTRIES.find((c) => c.code === "US")!;
    const canada = COUNTRIES.find((c) => c.code === "CA")!;
    expect(us.regions).toHaveLength(51);
    expect(canada.regions).toHaveLength(13);
    expect(canada.status).toBe("planned");
    expect(canada.currency).toBe("CAD");
    expect(us.regions.filter((r) => r.status === "live").map((r) => r.code)).toEqual(["CA"]);
  });

  it("keeps Canada's CA (no country live) apart from California", () => {
    expect(isLive("US", "CA")).toBe(true);
    expect(isLive("CA", "ON")).toBe(false);
    expect(isSupportedPlace({ country: "US", region: "TX" })).toBe(false);
    expect(() => resolveRules({ country: "CA", region: "BC" }, "2026-06-01")).toThrow(/not launched/);
  });

  it("finds the nearest state pack for labels outside its dates", () => {
    expect(statePackFor({ country: "US", region: "CA" }, "2025-06-01").id).toBe("us-ca");
    expect(statePackFor({ country: "US", region: "CA" }, "2030-06-01").id).toBe("us-ca");
  });
});

// A made-up state to drive the engine's other paths: no daily overtime, an
// elected-percentage income tax, one capped employer tax, a mid-year raise.
const testState: StateRulePack = {
  ...usCalifornia2026,
  id: "us-zz", name: "Testland", place: { country: "US", region: "ZZ" }, calendar: "weekends", status: "draft",
  payroll: {
    incomeTax: { method: "elected_percent", certificate: "Z-4", choices: ["0.01", "0.02", "0.03"], defaultRate: "0.02", zeroAllowed: true },
    incomeTaxAgency: { agency: "ZDR", code: "ZZ_WH", label: "Testland income tax", account: "zz_wh_payable" },
    taxes: [{ code: "ZZ_UI", label: "Testland UI", agency: "ZWC", paidBy: "employer", rate: "0.027", wageBase: "9000", account: "zz_ui_payable", assignedRate: { label: "UI rate", hint: "" } }],
    deposits: [
      { kind: "zz_wh", codes: ["ZZ_WH"], agency: "ZDR", what: "Testland withholding", where: "online", schedule: "federal_timing_by_average", federalTimingAverageOver: "1500", report: "Z-QRT" },
      { kind: "zz_ui", codes: ["ZZ_UI"], agency: "ZWC", what: "Testland UI", where: "online", schedule: "quarterly", report: "Z-3" },
    ],
    employerAccount: { label: "ZWC account number", hint: "", pattern: "^\\d{9}$" },
    accounts: [],
  },
  forms: { quarterly: [], w2Box14: [] },
  wageHour: {
    minimumWage: "10.00", minimumWageChanges: [{ from: "2026-09-30", rate: "11.00" }], exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" }, sickLeave: null, newHireReportDays: 20, newHireReportTo: "ZDR",
  },
};

describe("state rule pack engine", () => {
  const rules: ResolvedRules = { federal: resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal, state: testState, provenance: [] };
  const hourly: EmployeePayInput = {
    employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "10.50", regularHours: "40",
    w4: { filingStatus: "single_or_mfs", step2Checked: false },
  };

  it("withholds an elected percentage, the default when none is filed, and zero when elected", () => {
    const it = testState.payroll.incomeTax;
    expect(stateWithholding(it, { state: { rate: "0.03" } }, new D(1000), 52).toString()).toBe("30");
    expect(stateWithholding(it, {}, new D(1000), 52).toString()).toBe("20");
    expect(stateWithholding(it, { state: { exempt: true } }, new D(1000), 52).toString()).toBe("0");
    expect(stateWithholding({ method: "none" }, {}, new D(1000), 52).toString()).toBe("0");
  });

  it("uses the state's own taxes, assigned rates and wage bases, and no SDI or sick leave where there is none", () => {
    const p = calculatePaycheck({ ...hourly, ytd: { stateWages: { ZZ_UI: 880000n } }, sickLeave: { balanceHours: "0" } }, rules, { stateRates: { ZZ_UI: "0.01" } }, "2026-06-01");
    const codes = p.taxes.map((t) => t.code);
    expect(codes).toContain("ZZ_WH");
    expect(codes).not.toContain("CA_SDI");
    expect(p.taxes.find((t) => t.code === "ZZ_WH")!.amountMinor).toBe(840n); // 2% default of $420
    const ui = p.taxes.find((t) => t.code === "ZZ_UI")!;
    expect(ui.taxableWagesMinor).toBe(20000n); // $200 left under the $9,000 base
    expect(ui.amountMinor).toBe(200n); // at the employer's own 1% rate
    expect(p.sickLeave).toBeUndefined();
    expect(p.blockers).toEqual([]);
  });

  it("checks the minimum wage in force on the period's last day", () => {
    expect(minimumWageOn(testState.wageHour, "2026-09-29")).toBe("10.00");
    expect(minimumWageOn(testState.wageHour, "2026-09-30")).toBe("11.00");
    const p = calculatePaycheck(hourly, rules, {}, "2026-10-02");
    expect(p.blockers[0]).toMatch(/below the Testland minimum wage of 11.00/);
  });

  it("works overtime on the weekly rule alone where there's no daily overtime", () => {
    expect(splitWorkweek([12, 12, 12, 0, 0, 0, 0], testState.wageHour)).toEqual({ regular: "36", overtime: "0", doubleTime: "0" });
    expect(splitWorkweek([10, 10, 10, 10, 10, 0, 6], testState.wageHour)).toEqual({ regular: "40", overtime: "16", doubleTime: "0" });
  });
});

describe("state deposit rules", () => {
  const run = (id: string, payDate: string, byTax: Record<string, number>): RunTaxes => ({
    payRunId: id, payDate, byTax: Object.fromEntries(Object.entries(byTax).map(([k, v]) => [k, BigInt(v * 100)])),
  });

  it("puts California's UI and ETT on the DE 9 date and keeps their deposit keys", () => {
    const d = depositSchedule([run("r1", "2026-08-14", { CA_UI: 100, CA_ETT: 3 })], "monthly", { country: "US", region: "CA" });
    expect(d.find((x) => x.kind === "ca_ui_ett")).toMatchObject({ key: "ca_ui_ett:2026-Q3", dueDate: "2026-11-02" });
  });
});
