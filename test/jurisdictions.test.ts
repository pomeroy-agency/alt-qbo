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
    expect(us.regions.filter((r) => r.status === "live").map((r) => r.code).sort()).toEqual(["AK", "AZ", "CA", "FL", "NH", "NV", "NY", "OR", "SD", "TN", "TX", "WA", "WY"]);
  });

  it("keeps Canada's CA (no country live) apart from California", () => {
    expect(isLive("US", "CA")).toBe(true);
    expect(isLive("CA", "ON")).toBe(false);
    expect(isSupportedPlace({ country: "US", region: "ID" })).toBe(false);
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

describe("no-income-tax state packs (draft)", () => {
  const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
  const rulesFor = (region: string, on = "2026-06-01"): ResolvedRules => ({ federal, state: statePackFor({ country: "US", region }, on), provenance: [] });
  const weekly: EmployeePayInput = {
    employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "20.00", regularHours: "40",
    w4: { filingStatus: "single_or_mfs", step2Checked: false },
  };
  const tax = (p: ReturnType<typeof calculatePaycheck>, code: string) => p.taxes.find((t) => t.code === code);

  it("are live for books, draft for payroll, and stay out of a released-only run", () => {
    for (const r of ["TX", "FL", "NV", "TN", "SD", "WY", "NH", "AK", "WA"]) {
      expect(isLive("US", r)).toBe(true);
      expect(statePackFor({ country: "US", region: r }, "2026-06-01").status).toBe("draft");
      expect(() => resolveRules({ country: "US", region: r }, "2026-06-01", { requireReleased: true })).toThrow();
    }
  });

  it("Texas: no state income tax, no SDI, UI capped at the $9,000 base", () => {
    const p = calculatePaycheck({ ...weekly, ytd: { stateWages: { TX_UI: 890000n } } }, rulesFor("TX"), {}, "2026-06-05");
    expect(p.taxes.map((t) => t.code)).toEqual(expect.arrayContaining(["FIT", "TX_UI"]));
    expect(p.taxes.filter((t) => t.agency !== "IRS").map((t) => t.code)).toEqual(["TX_UI"]);
    expect(tax(p, "TX_UI")).toMatchObject({ taxableWagesMinor: 10000n, amountMinor: 270n });
    expect(p.blockers).toEqual([]);
  });

  it("Alaska withholds employee UI and changes its exempt salary floor on July 1", () => {
    const p = calculatePaycheck(weekly, rulesFor("AK"), {}, "2026-06-05");
    expect(tax(p, "AK_UI_EE")).toMatchObject({ amountMinor: 400n }); // 0.5% of $800
    const salaried: EmployeePayInput = { ...weekly, hourlyRate: undefined, regularHours: undefined, salaryPerPeriod: "1050.00", overtimeExempt: true };
    expect(calculatePaycheck(salaried, rulesFor("AK"), {}, "2026-06-26").blockers).toEqual([]); // $54,600 ≥ $54,080
    expect(calculatePaycheck(salaried, rulesFor("AK"), {}, "2026-07-03").blockers[0]).toMatch(/exempt minimum of 58240/);
  });

  it("Washington needs the employer's own UI rate before a paycheck", () => {
    const p = calculatePaycheck(weekly, rulesFor("WA"), {}, "2026-06-05");
    expect(p.blockers.join(" ")).toMatch(/Washington UI rate/);
    const ok = calculatePaycheck(weekly, rulesFor("WA"), { stateRates: { WA_UI: "0.012" } }, "2026-06-05");
    expect(ok.blockers).toEqual([]);
    expect(tax(ok, "WA_UI")!.amountMinor).toBe(960n);
    expect(tax(ok, "WA_CARES")!.amountMinor).toBe(464n);
  });

  it("Florida's minimum wage rises on September 30", () => {
    const fl = statePackFor({ country: "US", region: "FL" }, "2026-06-01").wageHour;
    expect(minimumWageOn(fl, "2026-09-29")).toBe("14.00");
    expect(minimumWageOn(fl, "2026-09-30")).toBe("15.00");
  });

  it("Nevada counts daily overtime after 8 hours, for pay under $18 an hour", () => {
    const nv = statePackFor({ country: "US", region: "NV" }, "2026-06-01").wageHour;
    expect(nv.overtime.dailyOnlyBelowHourlyRate).toBe("18.00");
    expect(splitWorkweek([10, 10, 10, 0, 0, 0, 0], nv)).toEqual({ regular: "24", overtime: "6", doubleTime: "0" });
  });

  it("Texas files the C-3 quarterly with a TWC deposit key that the database accepts", () => {
    const tx = statePackFor({ country: "US", region: "TX" }, "2026-06-01");
    expect(tx.forms.quarterly.map((f) => f.slug)).toEqual(["c3"]);
    const d = depositSchedule([{ payRunId: "r1", payDate: "2026-08-14", byTax: { TX_UI: 27000n } }], "monthly", { country: "US", region: "TX" });
    const ui = d.find((x) => x.kind === "tx_c3")!;
    expect(ui.key).toMatch(/^tx_c3:2026-Q3/);
    for (const r of ["TX", "FL", "NV", "TN", "SD", "WY", "NH", "AK", "WA"]) {
      for (const k of statePackFor({ country: "US", region: r }, "2026-06-01").payroll.deposits) expect(k.kind).toMatch(/^[a-z]{2}_[a-z0-9_]{2,20}$/);
    }
  });
});

describe("Arizona (draft)", () => {
  const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
  const rules: ResolvedRules = { federal, state: statePackFor({ country: "US", region: "AZ" }, "2026-06-01"), provenance: [] };
  const weekly: EmployeePayInput = {
    employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "20.00", regularHours: "40",
    w4: { filingStatus: "single_or_mfs", step2Checked: false },
  };

  it("withholds the A-4 percentage, 2% without one, and charges UI at the new-employer rate", () => {
    const p = calculatePaycheck(weekly, rules, {}, "2026-06-05");
    expect(p.taxes.find((t) => t.code === "AZ_WH")!.amountMinor).toBe(1600n); // 2% of $800
    expect(p.taxes.find((t) => t.code === "AZ_UI")!.amountMinor).toBe(1600n);
    expect(p.taxes.find((t) => t.code === "AZ_JTT")?.amountMinor ?? 0n).toBe(0n);
    const elected = calculatePaycheck({ ...weekly, stateWithholding: { rate: "0.035" } }, rules, { stateRates: { AZ_JTT: "0.001" } }, "2026-06-05");
    expect(elected.taxes.find((t) => t.code === "AZ_WH")!.amountMinor).toBe(2800n);
    expect(elected.taxes.find((t) => t.code === "AZ_JTT")!.amountMinor).toBe(80n);
    expect(calculatePaycheck({ ...weekly, hourlyRate: "15.00" }, rules, {}, "2026-06-05").blockers[0]).toMatch(/Arizona minimum wage of 15.15/);
  });

  it("files the A1-QRT and UC-018, and deposits withholding on the federal schedule after a big year", () => {
    expect(rules.state.forms.quarterly.map((f) => f.slug)).toEqual(["a1-qrt", "uc018"]);
    const runs: RunTaxes[] = [{ payRunId: "r1", payDate: "2026-08-14", byTax: { FIT: 50000n, AZ_WH: 300000n, AZ_UI: 10000n } }];
    const small = depositSchedule(runs, "monthly", { country: "US", region: "AZ" }, { priorQuarterlyAverageMinor: 100000n });
    const big = depositSchedule(runs, "monthly", { country: "US", region: "AZ" }, { priorQuarterlyAverageMinor: 200000n });
    expect(small.find((d) => d.kind === "az_wh")!.dueDate).toBe("2026-11-02");
    expect(big.find((d) => d.kind === "az_wh")!.dueDate).toBe("2026-09-15");
  });
});

describe("Oregon (draft)", () => {
  const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
  const or = statePackFor({ country: "US", region: "OR" }, "2026-06-01");
  const rules: ResolvedRules = { federal, state: or, provenance: [] };
  const orTax = or.payroll.incomeTax;
  const weekly: EmployeePayInput = {
    employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "20.00", regularHours: "40",
    w4: { filingStatus: "single_or_mfs", step2Checked: false },
  };

  it("matches the formula publication's worked example", () => {
    // Single, $25,000 a year, no allowances, $1,000 federal tax withheld: BASE $21,090, $1,789 a year.
    expect(stateWithholding(orTax, { state: { filingStatus: "single" } }, new D(25000), 1, new D(1000)).toString()).toBe("1788.88");
    expect(stateWithholding(orTax, { state: { filingStatus: "single" } }, new D(25000).div(12), 12, new D(1000).div(12)).toString()).toBe("149.07");
  });

  it("phases out the federal subtraction and allowances at high wages, and uses the married table for 3+ single allowances", () => {
    // $132,000 single: at most $5,250 of federal tax comes off; over $100,000 no allowances count.
    const high = stateWithholding(orTax, { state: { filingStatus: "single", allowances: 2 } }, new D(132000), 1, new D(21098));
    expect(high.toString()).toBe(new D(678).add(new D(132000 - 5250 - 2910 - 11400).mul("0.0875")).toDecimalPlaces(2).toString());
    // Single with 3 allowances: married deduction ($5,820) and brackets, $263 credit each.
    const three = stateWithholding(orTax, { state: { filingStatus: "single", allowances: 3 } }, new D(40000), 1, new D(3000));
    expect(three.toString()).toBe(new D(1620).add(new D(40000 - 3000 - 5820 - 22800).mul("0.0875")).sub(789).toDecimalPlaces(2).toString());
  });

  it("withholds 8% without an OR-W-4, plus the transit tax, Paid Leave and Workers' Benefit Fund", () => {
    const p = calculatePaycheck(weekly, rules, {}, "2026-06-05");
    expect(p.taxes.find((t) => t.code === "OR_WH")!.amountMinor).toBe(6400n); // 8% of $800
    expect(p.warnings.join(" ")).toMatch(/no OR-W-4 on file/);
    expect(p.taxes.find((t) => t.code === "OR_STT")!.amountMinor).toBe(80n);
    expect(p.taxes.find((t) => t.code === "OR_PFML_EE")!.amountMinor).toBe(480n);
    expect(p.taxes.find((t) => t.code === "OR_WBF_EE")!.amountMinor).toBe(36n); // 40 hours x 0.9 cents
    expect(p.taxes.find((t) => t.code === "OR_UI")!.amountMinor).toBe(1920n);
  });

  it("checks the minimum wage for the area the employee works in", () => {
    const low = { ...weekly, hourlyRate: "16.00" };
    expect(calculatePaycheck(low, rules, {}, "2026-06-05").blockers).toEqual([]);
    expect(calculatePaycheck({ ...low, workArea: "Portland metro" }, rules, {}, "2026-06-05").blockers[0]).toMatch(/Oregon \(Portland metro\) minimum wage of 16.30/);
    expect(calculatePaycheck({ ...low, workArea: "Portland metro" }, rules, {}, "2026-07-03").blockers[0]).toMatch(/16.80/);
  });

  it("deposits withholding on the federal dates and files the OQ", () => {
    const d = depositSchedule([{ payRunId: "r1", payDate: "2026-08-14", byTax: { FIT: 50000n, OR_WH: 20000n, OR_UI: 5000n } }], "monthly", { country: "US", region: "OR" });
    expect(d.find((x) => x.kind === "or_wh")!.dueDate).toBe("2026-09-15");
    expect(d.find((x) => x.kind === "or_ui")!.dueDate).toBe("2026-11-02");
    expect(or.forms.quarterly.map((f) => f.slug)).toEqual(["oq", "or-paid-leave"]);
  });
});

describe("New York (draft)", () => {
  const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
  const ny = statePackFor({ country: "US", region: "NY" }, "2026-06-01");
  const rules: ResolvedRules = { federal, state: ny, provenance: [] };
  const nyTax = ny.payroll.incomeTax;
  const w = (status: "single" | "married", allowances: number, wages: number, periods: number) =>
    stateWithholding(nyTax, { state: { filingStatus: status, allowances } }, new D(wages), periods).toFixed(2);

  it("matches the publication's Method II examples", () => {
    expect(w("single", 3, 400, 52)).toBe("8.01");
    // The publication shows $258.51, rounding $165 x 0.0753 = $12.4245 up to $12.43; rounded to the cent it's $258.50.
    expect(w("single", 1, 5000, 24)).toBe("258.50");
    expect(w("single", 3, 50000, 12)).toBe("3576.63");
    expect(w("married", 4, 400, 52)).toBe("6.69");
    expect(w("married", 3, 50000, 12)).toBe("3622.09");
  });

  it("uses Method III's top rate above the tables, and single with no allowances without an IT-2104", () => {
    expect(w("single", 0, 30000, 52)).toBe(new D(30000 - 142.3).mul("0.1045").toFixed(2));
    expect(stateWithholding(nyTax, {}, new D(400), 52).toFixed(2)).toBe(w("single", 0, 400, 52));
  });

  it("caps disability at $0.60 a week and charges Paid Family Leave and UI", () => {
    const weekly: EmployeePayInput = { employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "20.00", regularHours: "40", w4: { filingStatus: "single_or_mfs", step2Checked: false } };
    const p = calculatePaycheck(weekly, rules, {}, "2026-06-05");
    expect(p.taxes.find((t) => t.code === "NY_SDI")!.amountMinor).toBe(60n);
    expect(p.taxes.find((t) => t.code === "NY_PFL")!.amountMinor).toBe(346n);
    expect(p.taxes.find((t) => t.code === "NY_UI")!.amountMinor).toBe(3280n);
    const semi = calculatePaycheck({ ...weekly, payFrequency: "semimonthly", regularHours: "86.67" }, rules, {}, "2026-06-15");
    expect(semi.taxes.find((t) => t.code === "NY_SDI")!.amountMinor).toBe(130n);
    expect(calculatePaycheck({ ...weekly, hourlyRate: "16.50", workArea: "New York City, Long Island and Westchester" }, rules, {}, "2026-06-05").blockers[0]).toMatch(/17.00/);
  });

  it("pays withholding within 3 business days once $700 is owed, and the rest with the NY-45", () => {
    const run = (id: string, payDate: string, wh: number): RunTaxes => ({ payRunId: id, payDate, byTax: { NY_WH: BigInt(wh * 100) } });
    const d = depositSchedule([run("r1", "2026-07-10", 400), run("r2", "2026-07-24", 400), run("r3", "2026-08-07", 300)], "monthly", { country: "US", region: "NY" })
      .filter((x) => x.kind === "ny_wh");
    expect(d.map((x) => [x.dueDate, x.amountMinor])).toEqual([["2026-07-29", 80000n], ["2026-11-02", 30000n]]);
  });
});
