import { describe, expect, it } from "vitest";
import { COUNTRIES, isLive, isSupportedPlace, resolveRules, statePackFor, type ResolvedRules, type StateRulePack } from "../src/rules/index.js";
import { minimumWageOn } from "../src/rules/minimum-wage.js";
import { usCalifornia2026 } from "../src/rules/us-ca-2026.js";
import { calculatePaycheck, type EmployeePayInput } from "../src/payroll/gross-to-net.js";
import { splitWorkweek } from "../src/payroll/hours.js";
import { depositAccounts, depositSchedule, type RunTaxes } from "../src/payroll/deposits.js";
import { localWithholding, stateWithholding } from "../src/payroll/state-withholding.js";
import { formsFor } from "../src/payroll/forms.js";
import { D } from "../src/core/money.js";

describe("jurisdictions", () => {
  it("lists every US state and DC, and Canada's provinces and territories as coming later", () => {
    const us = COUNTRIES.find((c) => c.code === "US")!;
    const canada = COUNTRIES.find((c) => c.code === "CA")!;
    expect(us.regions).toHaveLength(51);
    expect(canada.regions).toHaveLength(13);
    expect(canada.status).toBe("planned");
    expect(canada.currency).toBe("CAD");
    expect(us.regions.filter((r) => r.status === "live").map((r) => r.code).sort()).toEqual(["AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DE", "FL", "GA", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY"]);
  });

  it("keeps Canada's CA (no country live) apart from California", () => {
    expect(isLive("US", "CA")).toBe(true);
    expect(isLive("CA", "ON")).toBe(false);
    expect(isSupportedPlace({ country: "US", region: "NE" })).toBe(false);
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

describe("no-income-tax state packs", () => {
  const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
  const rulesFor = (region: string, on = "2026-06-01"): ResolvedRules => ({ federal, state: statePackFor({ country: "US", region }, on), provenance: [] });
  const weekly: EmployeePayInput = {
    employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "20.00", regularHours: "40",
    w4: { filingStatus: "single_or_mfs", step2Checked: false },
  };
  const tax = (p: ReturnType<typeof calculatePaycheck>, code: string) => p.taxes.find((t) => t.code === code);

  it("are live and released for saved pay runs (Greg's sign-off, 2026-10-29)", () => {
    for (const r of ["TX", "FL", "NV", "TN", "SD", "WY", "NH", "AK", "WA", "AZ", "OR", "NY"]) {
      expect(isLive("US", r)).toBe(true);
      expect(resolveRules({ country: "US", region: r }, "2026-06-01", { requireReleased: true }).state.status).toBe("released");
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

describe("Arizona", () => {
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

describe("Oregon", () => {
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

describe("New York", () => {
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

  const local = (id: string, status: "single" | "married", allowances: number, wages: number, periods: number) =>
    localWithholding(ny.payroll.localIncomeTaxes!.find((l) => l.id === id)!, nyTax, { filingStatus: status, allowances, localities: [id] }, new D(wages), periods).toFixed(2);

  it("matches NYS-50-T-NYC's exact calculation examples for New York City residents", () => {
    expect(local("nyc", "single", 3, 400, 52)).toBe("6.11");
    expect(local("nyc", "single", 1, 5000, 24)).toBe("188.80");
    expect(local("nyc", "single", 3, 50000, 12)).toBe("2070.50");
    expect(local("nyc", "married", 4, 400, 52)).toBe("5.17");
    expect(local("nyc", "married", 3, 5000, 24)).toBe("184.37");
    expect(local("nyc", "married", 3, 50000, 12)).toBe("2068.73");
  });

  it("withholds 16.75% of the state amount for Yonkers residents and 0.5% after the exclusion for nonresidents", () => {
    expect(local("yonkers", "single", 3, 400, 52)).toBe(new D("8.0074").mul("0.1675").toFixed(2));
    expect(local("yonkers_nr", "single", 0, 200, 52)).toBe("0.81");
    expect(local("yonkers_nr", "single", 0, 70, 52)).toBe("0.00");
    expect(local("yonkers_nr", "single", 0, 1000, 52)).toBe("5.00");
  });

  it("withholds city tax only for employees who claim it, and pays it with state withholding", () => {
    const weekly: EmployeePayInput = { employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "20.00", regularHours: "40", w4: { filingStatus: "single_or_mfs", step2Checked: false } };
    expect(calculatePaycheck(weekly, rules, {}, "2026-06-05").taxes.some((t) => t.code === "NYC_WH")).toBe(false);
    const p = calculatePaycheck({ ...weekly, stateWithholding: { filingStatus: "single", allowances: 0, localities: ["nyc"] } }, rules, {}, "2026-06-05");
    const nyc = p.taxes.find((t) => t.code === "NYC_WH")!;
    expect(nyc.amountMinor).toBe(BigInt(local("nyc", "single", 0, 800, 52).replace(".", "")));
    expect(nyc.paidBy).toBe("employee");
    expect(depositAccounts("ny_wh", ny)).toMatchObject({ NY_WH: "ny_wh_payable", NYC_WH: "ny_wh_payable", YON_WH: "ny_wh_payable" });
    expect(ny.version).toBe("2026.2");
  });
});

describe("annual-formula states (Illinois, Colorado, North Carolina, Georgia, Utah, Idaho)", () => {
  const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
  const pack = (region: string) => statePackFor({ country: "US", region }, "2026-09-01");
  const w = (region: string, state: Parameters<typeof stateWithholding>[1]["state"], wages: number, periods: number, w4Status?: "single_or_mfs" | "mfj" | "hoh") =>
    stateWithholding(pack(region).payroll.incomeTax, { state, w4Status }, new D(wages), periods).toFixed(2);

  it("matches each publication's own example", () => {
    // IL-700-T: $800 a week, 2 allowances on line 1 and 2 on line 2.
    expect(w("IL", { allowances: 2, allowances2: 2 }, 800, 52)).toBe("32.13");
    // NC-30: single, $450 a week, 2 allowances, rounded to the dollar.
    expect(w("NC", { filingStatus: "single", allowances: 2 }, 450, 52)).toBe("4.00");
    // Georgia's guide: married, one income, $2,000 semimonthly, one dependent.
    expect(w("GA", { filingStatus: "mfj_one", allowances: 1 }, 2000, 24)).toBe("27.03");
  });

  it("uses the defaults each state sets without its certificate", () => {
    // Illinois: no allowances. North Carolina and Georgia: single, none.
    expect(w("IL", null, 1000, 52)).toBe("49.50");
    expect(w("NC", null, 1000, 52)).toBe(String(Math.round((52000 - 12750) * 0.0409 / 52)) + ".00");
    expect(w("GA", null, 1000, 52)).toBe(new D(52000 - 15000).mul("0.0499").div(52).toFixed(2));
    // Colorado: the W-4 status picks $5,500 or $11,000; a DR 0004 amount replaces it, even zero.
    expect(w("CO", null, 1000, 52, "single_or_mfs")).toBe("39.35");
    expect(w("CO", null, 1000, 52, "mfj")).toBe("34.69");
    expect(w("CO", { allowanceAmount: "0" }, 1000, 52, "mfj")).toBe("44.00");
    // Idaho: 5.3% over $16,100 or $32,200 a year.
    expect(w("ID", null, 3000, 12)).toBe(new D(36000 - 16100).mul("0.053").div(12).toFixed(2));
    expect(w("ID", { filingStatus: "married" }, 3000, 12)).toBe(new D(36000 - 32200).mul("0.053").div(12).toFixed(2));
  });

  it("takes Utah's base allowance off and phases it out by 1.3% of wages over the threshold", () => {
    expect(w("UT", null, 3000, 12, "single_or_mfs")).toBe("121.96");
    expect(w("UT", null, 3000, 12, "mfj")).toBe("71.41");
    // Low wages: the allowance covers all of it.
    expect(w("UT", null, 700, 12, "single_or_mfs")).toBe("0.00");
  });

  it("charges Colorado FAMLI to the employee and adds extra withholding and exemptions", () => {
    const rules: ResolvedRules = { federal, state: pack("CO"), provenance: [] };
    const weekly: EmployeePayInput = { employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "25.00", regularHours: "40", w4: { filingStatus: "single_or_mfs", step2Checked: false } };
    const p = calculatePaycheck(weekly, rules, {}, "2026-09-04");
    expect(p.taxes.find((t) => t.code === "CO_FAMLI_EE")!.amountMinor).toBe(440n);
    expect(p.taxes.find((t) => t.code === "CO_WH")!.amountMinor).toBe(3935n);
    expect(w("CO", { additionalWithholding: "10" }, 1000, 52, "single_or_mfs")).toBe("49.35");
    expect(w("CO", { exempt: true }, 1000, 52, "single_or_mfs")).toBe("0.00");
  });

  it("pays withholding monthly, on the federal dates or weekly once last year's withholding was large", () => {
    const run = (id: string, payDate: string, code: string, amount: number): RunTaxes => ({ payRunId: id, payDate, byTax: { [code]: BigInt(amount * 100), FIT: 10000n } });
    const due = (region: string, code: string, prior?: number) =>
      depositSchedule([run("r1", "2026-07-08", code, 300), run("r2", "2026-07-22", code, 300)], "semiweekly", { country: "US", region },
        prior === undefined ? {} : { priorQuarterlyAverageMinor: BigInt(prior * 100) / 4n })
        .filter((d) => d.kind === `${region.toLowerCase()}_wh`).map((d) => [d.dueDate, d.amountMinor]);
    // Monthly by the 15th (August 15, 2026 is a Saturday), the 20th, or the end of the next month.
    expect(due("IL", "IL_WH")).toEqual([["2026-08-17", 60000n]]);
    expect(due("ID", "ID_WH")).toEqual([["2026-08-20", 60000n]]);
    expect(due("UT", "UT_WH")).toEqual([["2026-08-31", 60000n]]);
    // Illinois over $12,000 last year: the federal semiweekly dates.
    expect(due("IL", "IL_WH", 20000)).toEqual([["2026-07-15", 30000n], ["2026-07-29", 30000n]]);
    // Colorado over $50,000: the third business day after the payday's Friday.
    expect(due("CO", "CO_WH", 60000)).toEqual([["2026-07-15", 30000n], ["2026-07-29", 30000n]]);
  });
});

describe("annual-formula states, third round (Michigan, Virginia, Massachusetts, New Jersey)", () => {
  const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
  const pack = (region: string) => statePackFor({ country: "US", region }, "2026-09-01");
  const w = (region: string, state: Parameters<typeof stateWithholding>[1]["state"], wages: number, periods: number, fica?: { thisPeriod: number; yearToDate: number }) =>
    stateWithholding(pack(region).payroll.incomeTax, { state }, new D(wages), periods, new D(0),
      fica && { thisPeriod: new D(fica.thisPeriod), yearToDate: new D(fica.yearToDate) }).toFixed(2);

  it("matches Virginia's own example, rounding the year's tax to the dollar", () => {
    // $2,649 semimonthly, 5 exemptions: $2,628 / 24.
    expect(w("VA", { allowances: 5 }, 2649, 24)).toBe("109.50");
    // No VA-4: $8,750 only. Age 65 or blind exemptions take $800 more.
    expect(w("VA", null, 1000, 52)).toBe("42.87");
    expect(w("VA", { allowances2: 1 }, 1000, 52)).toBe(new D(720 + (52000 - 9550 - 17000) * 0.0575).toDecimalPlaces(0).div(52).toFixed(2));
  });

  it("takes $5,900 a Michigan exemption off before 4.25%", () => {
    expect(w("MI", { allowances: 2 }, 2000, 26)).toBe("65.71");
    expect(w("MI", null, 1000, 52)).toBe("42.50");
  });

  it("uses New Jersey's rate table for the NJ-W4 status or the one chosen on line 3", () => {
    expect(w("NJ", { filingStatus: "rate_a", allowances: 2 }, 1000, 52)).toBe("27.02");
    expect(w("NJ", { filingStatus: "rate_b", allowances: 2 }, 1000, 52)).toBe("17.31");
    // No NJ-W4: Rate A, no allowances.
    expect(w("NJ", null, 1000, 52)).toBe("29.37");
    // Rate E on $150,000: 4,370 + 6.5% over 100,000.
    expect(w("NJ", { filingStatus: "rate_e" }, 150000, 1)).toBe("7620.00");
  });

  it("follows Circular M: FICA off up to $2,000, the exemption factor, then the credits", () => {
    const fica = { thisPeriod: 76.5, yearToDate: 0 };
    expect(w("MA", { allowances: 1 }, 1000, 52, fica)).toBe("41.94");
    // Once $2,000 of FICA has come off this year, nothing more does.
    expect(w("MA", { allowances: 1 }, 1000, 52, { thisPeriod: 76.5, yearToDate: 2000 })).toBe("45.77");
    // Head of household $120 a year; blindness $110 a person.
    expect(w("MA", { filingStatus: "hoh", allowances: 1 }, 1000, 52, fica)).toBe("39.64");
    expect(w("MA", { allowances: 1, allowances2: 1 }, 1000, 52, fica)).toBe("39.83");
    // Under $8,000 a year with an exemption: nothing; with none, 5%.
    expect(w("MA", { allowances: 1 }, 150, 52, { thisPeriod: 0, yearToDate: 2000 })).toBe("0.00");
    expect(w("MA", null, 150, 52, { thisPeriod: 0, yearToDate: 2000 })).toBe("7.50");
  });

  it("charges Massachusetts PFML and New Jersey's employee contributions on a paycheck", () => {
    const weekly: EmployeePayInput = { employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "25.00", regularHours: "40", w4: { filingStatus: "single_or_mfs", step2Checked: false } };
    const ma = calculatePaycheck(weekly, { federal, state: pack("MA"), provenance: [] }, {}, "2026-09-04");
    const amount = (p: typeof ma, code: string) => p.taxes.find((t) => t.code === code)?.amountMinor;
    expect(amount(ma, "MA_PFML_EE")).toBe(460n);
    // No M-4: no exemptions; this paycheck's $76.50 of FICA comes off first.
    expect(amount(ma, "MA_WH")).toBe(4618n);
    const nj = calculatePaycheck(weekly, { federal, state: pack("NJ"), provenance: [] }, {}, "2026-09-04");
    expect([amount(nj, "NJ_UIWF_EE"), amount(nj, "NJ_DI_EE"), amount(nj, "NJ_FLI_EE")]).toEqual([425n, 190n, 230n]);
  });

  it("dates deposits and New Jersey's quarterly return without a weekend extension", () => {
    const run = (id: string, payDate: string, code: string, amount: number): RunTaxes => ({ payRunId: id, payDate, byTax: { [code]: BigInt(amount * 100), FIT: 10000n } });
    const due = (region: string, code: string, payDates: string[], kind = `${region.toLowerCase()}_wh`, prior?: number) =>
      depositSchedule(payDates.map((d, i) => run(`r${i}`, d, code, 300)), "semiweekly", { country: "US", region },
        prior === undefined ? {} : { priorQuarterlyAverageMinor: BigInt(prior * 100) / 4n })
        .filter((d) => d.kind === kind).map((d) => [d.dueDate, d.amountMinor]);
    const july = ["2026-07-08", "2026-07-22"];
    expect(due("VA", "VA_WH", july)).toEqual([["2026-08-25", 60000n]]);
    expect(due("MI", "MI_WH", july)).toEqual([["2026-08-20", 60000n]]);
    expect(due("MA", "MA_WH", july)).toEqual([["2026-08-17", 60000n]]);
    expect(due("NJ", "NJ_WH", july)).toEqual([["2026-08-17", 60000n]]);
    expect(due("VA", "VA_WH", july, "va_wh", 20000)).toEqual([["2026-07-15", 30000n], ["2026-07-29", 30000n]]);
    // NJ-927: the 30th after the quarter; January 30, 2027 is a Saturday, so the Friday before.
    expect(due("NJ", "NJ_UI_ER", ["2026-08-14"], "nj_ui")).toEqual([["2026-10-30", 30000n]]);
    expect(due("NJ", "NJ_UI_ER", ["2026-12-15"], "nj_ui")).toEqual([["2027-01-29", 30000n]]);
    expect(formsFor(2026, "2026-12-31", pack("NJ")).find((f) => f.slug === "nj927" && f.quarter === 4)?.dueDate).toBe("2027-01-29");
  });
});

describe("Pennsylvania and Ohio, with entered local taxes", () => {
  const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
  const pack = (region: string) => statePackFor({ country: "US", region }, "2026-09-01");
  const local = (region: string, id: string) => pack(region).payroll.localIncomeTaxes!.find((l) => l.id === id)!;
  const lw = (region: string, id: string, state: Parameters<typeof localWithholding>[2], wages: number, periods: number, onDate?: string) =>
    localWithholding(local(region, id), pack(region).payroll.incomeTax, state, new D(wages), periods, onDate).toFixed(2);

  it("withholds Ohio by the August 2026 formula", () => {
    const w = (state: Parameters<typeof stateWithholding>[1]["state"], wages: number, periods: number) =>
      stateWithholding(pack("OH").payroll.incomeTax, { state }, new D(wages), periods).toFixed(2);
    // $1,000 a week, 1 exemption: (52,000 - 650 - 26,050) x 2.99% + 416.80, over 52.
    expect(w({ allowances: 1 }, 1000, 52)).toBe(new D(25300).mul("0.0299").add("416.80").div(52).toFixed(2));
    expect(w(null, 400, 52)).toBe(new D(20800).mul("0.016").div(52).toFixed(2));
    // Above $100,000: $2,627.91 plus 3.4%.
    expect(w(null, 150000, 1)).toBe("4327.91");
  });

  it("takes Pennsylvania's flat 3.07% and the employee's 0.07% UC", () => {
    const weekly: EmployeePayInput = { employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "25.00", regularHours: "40", w4: { filingStatus: "single_or_mfs", step2Checked: false } };
    const p = calculatePaycheck(weekly, { federal, state: pack("PA"), provenance: [] }, {}, "2026-09-04");
    const amount = (code: string) => p.taxes.find((t) => t.code === code)?.amountMinor;
    expect([amount("PA_WH"), amount("PA_UC_EE")]).toEqual([3070n, 70n]);
    // Local taxes only when ticked and entered.
    expect(amount("PA_EIT")).toBeUndefined();
    const withLocal = calculatePaycheck({ ...weekly, stateWithholding: { localities: ["pa_eit", "pa_lst"], localRates: { pa_eit: "0.012", pa_lst: "52" } } },
      { federal, state: pack("PA"), provenance: [] }, {}, "2026-09-04");
    expect(withLocal.taxes.find((t) => t.code === "PA_EIT")?.amountMinor).toBe(1200n);
    expect(withLocal.taxes.find((t) => t.code === "PA_LST")?.amountMinor).toBe(100n);
  });

  it("caps entered local taxes and changes Philadelphia's rate on July 1", () => {
    expect(lw("PA", "pa_lst", { localities: ["pa_lst"], localRates: { pa_lst: "80" } }, 1000, 26)).toBe("2.00");
    expect(lw("PA", "pa_eit", { localities: ["pa_eit"], localRates: { pa_eit: "0.2" } }, 1000, 52)).toBe("50.00");
    expect(lw("PA", "pa_eit", { localRates: { pa_eit: "0.01" } }, 1000, 52)).toBe("0.00");
    expect(lw("PA", "phl_res", { localities: ["phl_res"] }, 1000, 52, "2026-06-30")).toBe("37.40");
    expect(lw("PA", "phl_res", { localities: ["phl_res"] }, 1000, 52, "2026-07-01")).toBe("37.35");
    expect(lw("PA", "phl_nr", { localities: ["phl_nr"] }, 1000, 52, "2026-09-04")).toBe("34.25");
  });

  it("works Ohio school district tax on the right base", () => {
    const state = { allowances: 2, localities: ["oh_sd", "oh_sd_ei", "oh_city"], localRates: { oh_sd: "0.01", oh_sd_ei: "0.01", oh_city: "0.025" } };
    // Traditional base: wages less 2 x $650 over 52 weeks.
    expect(lw("OH", "oh_sd", state, 1000, 52)).toBe(new D(1000).sub(new D(1300).div(52)).mul("0.01").toFixed(2));
    expect(lw("OH", "oh_sd_ei", state, 1000, 52)).toBe("10.00");
    expect(lw("OH", "oh_city", state, 1000, 52)).toBe("25.00");
  });

  it("pays Pennsylvania semi-monthly in the middle tier and local taxes 30 days after the quarter", () => {
    const run = (id: string, payDate: string, code: string, amount: number): RunTaxes => ({ payRunId: id, payDate, byTax: { [code]: BigInt(amount * 100), FIT: 10000n } });
    const due = (code: string, kind: string, prior: Record<string, bigint>, dates = ["2026-07-08", "2026-07-22"]) =>
      depositSchedule(dates.map((d, i) => run(`r${i}`, d, code, 300)), "semiweekly", { country: "US", region: "PA" }, { priorYearMinorByCode: prior })
        .filter((d) => d.kind === kind).map((d) => [d.dueDate, d.amountMinor]);
    expect(due("PA_WH", "pa_wh", {})).toEqual([["2026-08-17", 60000n]]);
    // $10,000 last year: the 1st-15th half is due July 20 (third business day after the 15th), the rest August 5.
    expect(due("PA_WH", "pa_wh", { PA_WH: 1000000n })).toEqual([["2026-07-20", 30000n], ["2026-08-05", 30000n]]);
    expect(due("PA_WH", "pa_wh", { PA_WH: 3000000n })).toEqual([["2026-07-15", 30000n], ["2026-07-29", 30000n]]);
    expect(due("PA_EIT", "pa_local", {})).toEqual([["2026-10-30", 60000n]]);
  });
});

describe("Indiana, Maryland, Missouri, Wisconsin, Minnesota and South Carolina", () => {
  const pack = (region: string) => statePackFor({ country: "US", region }, "2026-09-01");
  const w = (region: string, state: Parameters<typeof stateWithholding>[1]["state"], wages: number, periods: number) =>
    stateWithholding(pack(region).payroll.incomeTax, { state }, new D(wages), periods).toFixed(2);
  const lw = (region: string, id: string, state: Parameters<typeof localWithholding>[2], wages: number, periods: number) =>
    localWithholding(pack(region).payroll.localIncomeTaxes!.find((l) => l.id === id)!, pack(region).payroll.incomeTax, state, new D(wages), periods).toFixed(2);

  it("matches Indiana's Departmental Notice #1 example, county tax included", () => {
    // $800 a week; 5 personal, 4 dependent and 2 adopted child exemptions; taxable $473.08; county 1%.
    const state = { allowances: 5, allowances2: 4, allowances3: 2, localities: ["in_county"], localRates: { in_county: "0.01" } };
    expect(w("IN", state, 800, 52)).toBe("13.96");
    expect(lw("IN", "in_county", state, 800, 52)).toBe("4.73");
  });

  it("matches the South Carolina WH-1603F example and drops the deduction with no allowances", () => {
    expect(w("SC", { allowances: 3 }, 750, 52)).toBe("10.58");
    expect(w("SC", null, 750, 52)).toBe(new D(39000 - 18230).mul("0.06").add("437.70").div(52).toFixed(2));
    // The 10% deduction stops at $7,500.
    expect(w("SC", { allowances: 1 }, 100000, 1)).toBe(new D(100000 - 5000 - 7500 - 18230).mul("0.06").add("437.70").toFixed(2));
  });

  it("matches Wisconsin's three W-166 examples", () => {
    expect(w("WI", { filingStatus: "single", allowances: 1 }, 350, 52)).toBe("7.59");
    expect(w("WI", { filingStatus: "single", allowances: 3 }, 500, 52)).toBe("14.34");
    expect(w("WI", { filingStatus: "married", allowances: 3 }, 1000, 26)).toBe("22.08");
    // No deduction left at $73,630 or more (single).
    expect(w("WI", null, 80000, 1)).toBe(new D(80000 - 25520).mul("0.053").add("1045.04").toFixed(2));
  });

  it("works Minnesota's computer formula for single and married", () => {
    expect(w("MN", { filingStatus: "single", allowances: 1 }, 1000, 52)).toBe(new D(46700 - 38010).mul("0.068").add("1782.09").div(52).toFixed(2));
    expect(w("MN", { filingStatus: "married", allowances: 2 }, 2000, 26)).toBe(new D(52000 - 10600 - 14700).mul("0.0535").div(26).toFixed(2));
    expect(w("MN", null, 80, 52)).toBe("0.00");
  });

  it("rounds Missouri to the dollar and takes the Kansas City earnings tax", () => {
    // $1,000 a week single: $35,900 taxable; $262.86 through 4.5%, then 4.7% over $9,436.
    expect(w("MO", null, 1000, 52)).toBe("29.00");
    expect(w("MO", { filingStatus: "married_one_income" }, 1000, 52)).toBe(new D(52000 - 32200 - 9436).mul("0.047").add("262.86").div(52).toDecimalPlaces(0).toFixed(2));
    expect(lw("MO", "kc", { localities: ["kc"] }, 1000, 52)).toBe("10.00");
    expect(lw("MO", "stl", {}, 1000, 52)).toBe("0.00");
  });

  it("adds Maryland's county rate on the state's taxable wages, as in the 3.30% table", () => {
    const state = { filingStatus: "single", allowances: 1, localities: ["md_county"], localRates: { md_county: "0.033" } };
    // Weekly: $1,000 less $65.38 standard deduction and $61.54 exemption, at 8.05% combined.
    const combined = new D(w("MD", state, 1000, 52)).add(lw("MD", "md_county", state, 1000, 52));
    expect(combined.toFixed(2)).toBe(new D(1000).sub("65.38").sub("61.54").mul("0.0805").toFixed(2));
    expect(w("MD", { filingStatus: "married" }, 160000, 1)).toBe(new D(150000).mul("0.0475").add(new D(160000 - 3400 - 150000).mul("0.05")).toFixed(2));
  });

  it("takes Minnesota Paid Leave from the employee and the employer", () => {
    const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
    const p = calculatePaycheck({ employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "25.00", regularHours: "40", w4: { filingStatus: "single_or_mfs", step2Checked: false } },
      { federal, state: pack("MN"), provenance: [] }, {}, "2026-09-04");
    const amount = (code: string) => p.taxes.find((t) => t.code === code)?.amountMinor;
    expect([amount("MN_PFL_EE"), amount("MN_PFL_ER"), amount("MN_UI"), amount("MN_WEF")]).toEqual([440n, 440n, 1690n, 100n]);
  });

  it("dates Indiana's WH-1 on the 20th and Maryland's MW506 on the 15th", () => {
    const run = (code: string): RunTaxes => ({ payRunId: "r1", payDate: "2026-07-10", byTax: { [code]: 30000n, FIT: 10000n } });
    const due = (region: string, code: string, kind: string) =>
      depositSchedule([run(code)], "monthly", { country: "US", region }, {}).filter((d) => d.kind === kind).map((d) => d.dueDate);
    expect(due("IN", "IN_COUNTY", "in_wh")).toEqual(["2026-08-20"]);
    expect(due("MD", "MD_WH", "md_wh")).toEqual(["2026-08-17"]);
    expect(due("WI", "WI_WH", "wi_wh")).toEqual(["2026-08-31"]);
    expect(due("SC", "SC_WH", "sc_wh")).toEqual(["2026-08-17"]);
  });
});

describe("Alabama, Louisiana, Kentucky, Oklahoma, Connecticut and Iowa", () => {
  const pack = (region: string) => statePackFor({ country: "US", region }, "2026-09-01");
  const w = (region: string, state: Parameters<typeof stateWithholding>[1]["state"], wages: number, periods: number, fit = 0) =>
    stateWithholding(pack(region).payroll.incomeTax, { state }, new D(wages), periods, new D(fit)).toFixed(2);

  it("matches Alabama's M-2 example, subtracting federal withholding, and steps the standard deduction", () => {
    expect(w("AL", { filingStatus: "married", allowances: 2 }, 850, 52, 35.19)).toBe("29.59");
    // No A-4: "0". $30,000 a year: $2,775 standard deduction from the schedule, no exemption.
    expect(w("AL", null, 30000, 1)).toBe(new D(30000 - 2775 - 3000).mul("0.05").add(110).toFixed(2));
    // Dependents are $500 each from $50,000 to $100,000.
    expect(w("AL", { filingStatus: "married", allowances: 2 }, 60000, 1)).toBe(new D(60000 - 5000 - 3000 - 1000 - 6000).mul("0.05").add(220).toFixed(2));
    expect(w("AL", { filingStatus: "married_separate" }, 17600, 1)).toBe(new D(17600 - 2578 - 1500 - 3000).mul("0.05").add(110).toFixed(2));
  });

  it("matches Louisiana's two R-1306 examples", () => {
    expect(w("LA", { filingStatus: "single" }, 700, 52)).toBe("13.98");
    expect(w("LA", { filingStatus: "joint" }, 4600, 26)).toBe("111.54");
    expect(w("LA", null, 700, 52)).toBe("21.63");
  });

  it("matches Kentucky's 2026 formula examples", () => {
    expect(w("KY", null, 3270, 12)).toBe("104.65");
    // The PDF prints $47 for $1,247.40 ÷ 26.
    expect(w("KY", null, 1500, 26)).toBe("47.98");
  });

  it("matches the Oklahoma OW-2 example, rounded to the dollar", () => {
    expect(w("OK", { filingStatus: "married", allowances: 2 }, 1825, 24)).toBe("37.00");
    expect(w("OK", { filingStatus: "married_single_rate" }, 1825, 24)).toBe(new D(43800 - 13550).mul("0.045").add("109.25").div(24).toDecimalPlaces(0).toFixed(2));
  });

  it("matches Connecticut's 2026 weekly tables for every code, and 6.99% without a CT-W4", () => {
    // Each table row is the formula at the row's midpoint.
    const rows: [number, Record<string, string>][] = [
      [812, { A: "28.56", B: "14.22", C: "5.96", D: "31.73", F: "27.00" }],
      [995, { A: "39.97", B: "29.48", C: "15.89", D: "40.78", F: "36.27" }],
      [1432.5, { A: "69.17", B: "51.66", C: "49.36", D: "69.17", F: "66.29" }],
      [1913, { A: "95.60", B: "86.75", C: "74.18", D: "95.60", F: "95.12" }],
    ];
    for (const [wages, byCode] of rows) {
      for (const [code, amount] of Object.entries(byCode)) expect(w("CT", { filingStatus: code }, wages, 52)).toBe(amount);
    }
    expect(w("CT", null, 1000, 52)).toBe("69.90");
  });

  it("matches Iowa's 2026 formula examples", () => {
    expect(w("IA", { filingStatus: "other", allowances: 1 }, 2100, 26)).toBe("59.26");
    expect(w("IA", { filingStatus: "married_one_income", allowances: 2 }, 2100, 26)).toBe("38.72");
    expect(w("IA", { filingStatus: "head_of_household", allowances: 4 }, 2100, 26)).toBe("45.15");
  });

  it("takes Connecticut Paid Leave from the employee", () => {
    const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
    const p = calculatePaycheck({ employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "25.00", regularHours: "40", w4: { filingStatus: "single_or_mfs", step2Checked: false } },
      { federal, state: pack("CT"), provenance: [] }, {}, "2026-09-04");
    expect(p.taxes.find((t) => t.code === "CT_PL")?.amountMinor).toBe(500n);
  });

  it("dates each state's withholding deposit", () => {
    const run = (code: string): RunTaxes => ({ payRunId: "r1", payDate: "2026-07-10", byTax: { [code]: 30000n, FIT: 10000n } });
    const due = (region: string, code: string, kind: string) =>
      depositSchedule([run(code)], "monthly", { country: "US", region }, {}).filter((d) => d.kind === kind).map((d) => d.dueDate);
    expect(due("AL", "AL_WH", "al_wh")).toEqual(["2026-08-17"]);
    expect(due("LA", "LA_WH", "la_wh")).toEqual(["2026-08-31"]);
    expect(due("KY", "KY_WH", "ky_wh")).toEqual(["2026-08-17"]);
    expect(due("OK", "OK_WH", "ok_wh")).toEqual(["2026-08-20"]);
    expect(due("CT", "CT_WH", "ct_wh")).toEqual(["2026-08-17"]);
    expect(due("IA", "IA_WH", "ia_wh")).toEqual(["2026-08-17"]);
  });
});

describe("Arkansas, Delaware, Kansas, Mississippi and North Dakota", () => {
  const pack = (region: string) => statePackFor({ country: "US", region }, "2026-09-01");
  const w = (region: string, state: Parameters<typeof stateWithholding>[1]["state"], wages: number, periods: number) =>
    stateWithholding(pack(region).payroll.incomeTax, { state }, new D(wages), periods).toFixed(2);

  it("matches Arkansas's formula example, with the $50 midpoint and the top-bracket adjustments", () => {
    expect(w("AR", { allowances: 2 }, 2127, 12)).toBe("36.50");
    // $95,050 taxable (midpoint of $95,001-$95,100): 3.7% less $339.90, rounded.
    expect(w("AR", null, 97520, 1)).toBe("3177.00");
    // From $100,001 the exact figure: 3.7% less $79.90.
    expect(w("AR", null, 120000, 1)).toBe("4269.00");
  });

  it("matches Delaware's Employer's Guide examples", () => {
    expect(w("DE", { filingStatus: "single", allowances: 1 }, 500, 52)).toBe(new D(774).div(52).toFixed(2));
    expect(w("DE", { filingStatus: "married", allowances: 3 }, 500, 52)).toBe(new D(387).div(52).toFixed(2));
    expect(w("DE", { filingStatus: "single", allowances: 1 }, 31000, 1)).toBe("1043.63");
  });

  it("matches Kansas's KW-100 example and its single wage bracket table", () => {
    // The guide's per-period table gives $41.44.
    expect(w("KS", { filingStatus: "joint", allowances: 3 }, 2000, 24)).toBe("41.43");
    // Semi-monthly single, $1,985-$2,005 row: $78 with one allowance, $73 with two.
    expect(w("KS", { filingStatus: "single", allowances: 1 }, 1995, 24)).toBe("78.00");
    expect(new D(w("KS", { filingStatus: "single", allowances: 2 }, 1995, 24)).toDecimalPlaces(0).toFixed(2)).toBe("73.00");
  });

  it("works Mississippi out from the 2026 flowchart, rounded to the dollar", () => {
    expect(w("MS", { filingStatus: "single" }, 3000, 12)).toBe("59.00");
    expect(w("MS", { filingStatus: "head_of_family", allowances: 2 }, 1000, 52)).toBe("20.00");
    expect(w("MS", null, 1000, 52)).toBe(new D(52000 - 2300 - 10000).mul("0.04").div(52).toDecimalPlaces(0).toFixed(2));
  });

  it("matches North Dakota's 2026 weekly wage bracket table by federal W-4 status", () => {
    const nd = (w4Status: "single_or_mfs" | "mfj" | "hoh", wages: number) =>
      stateWithholding(pack("ND").payroll.incomeTax, { w4Status }, new D(wages), 52).toFixed(2);
    expect(nd("single_or_mfs", 1787.5)).toBe("13.00");
    expect(nd("single_or_mfs", 1812.5)).toBe("14.00");
    expect(nd("mfj", 2112.5)).toBe("20.00");
    expect(nd("hoh", 2112.5)).toBe("12.00");
  });

  it("dates each state's withholding deposit", () => {
    const run = (code: string): RunTaxes => ({ payRunId: "r1", payDate: "2026-07-10", byTax: { [code]: 30000n, FIT: 10000n } });
    const due = (region: string, code: string, kind: string) =>
      depositSchedule([run(code)], "monthly", { country: "US", region }, {}).filter((d) => d.kind === kind).map((d) => d.dueDate);
    expect(due("AR", "AR_WH", "ar_wh")).toEqual(["2026-08-17"]);
    expect(due("DE", "DE_WH", "de_wh")).toEqual(["2026-08-17"]);
    expect(due("KS", "KS_WH", "ks_wh")).toEqual(["2026-08-17"]);
    expect(due("MS", "MS_WH", "ms_wh")).toEqual(["2026-08-17"]);
    expect(due("ND", "ND_WH", "nd_wh")).toEqual(["2026-11-02"]);
  });
});

describe("Montana, New Mexico, Rhode Island, Vermont and West Virginia (from secondary sources)", () => {
  const pack = (region: string) => statePackFor({ country: "US", region }, "2026-09-01");
  const w = (region: string, state: Parameters<typeof stateWithholding>[1]["state"], wages: number, periods: number) =>
    stateWithholding(pack(region).payroll.incomeTax, { state }, new D(wages), periods).toFixed(2);

  it("matches the publishers' Montana single table: $2,233 at $63,600, then 5.65%", () => {
    expect(w("MT", { filingStatus: "single" }, 63600, 1)).toBe("2233.00");
    expect(w("MT", { filingStatus: "single" }, 73600, 1)).toBe("2798.00");
  });

  it("uses New Mexico's table for the federal W-4 status", () => {
    const nm = (w4Status: "single_or_mfs" | "mfj" | "hoh", wages: number) => stateWithholding(pack("NM").payroll.incomeTax, { w4Status }, new D(wages), 1).toFixed(2);
    // $82.50 at the top of the 1.5% band ($13,550).
    expect(nm("single_or_mfs", 13550)).toBe("82.50");
    expect(nm("mfj", 24100)).toBe("120.00");
  });

  it("drops Rhode Island's exemptions above $290,800", () => {
    expect(w("RI", { allowances: 2 }, 50000, 1)).toBe(new D(48000).mul("0.0375").toFixed(2));
    expect(w("RI", { allowances: 2 }, 300000, 1)).toBe(new D(82050).mul("0.0375").add(new D(104400).mul("0.0475")).add(new D(113550).mul("0.0599")).toFixed(2));
  });

  it("works Vermont and West Virginia out from their annual tables", () => {
    expect(w("VT", { filingStatus: "single", allowances: 1 }, 30000, 1)).toBe(new D(30000 - 5400 - 3925).mul("0.0335").toFixed(2));
    expect(w("WV", null, 7500, 1)).toBe("158.00");
    expect(w("WV", { filingStatus: "one_earner", allowances: 1 }, 12000, 1)).toBe("211.00");
  });

  it("takes Rhode Island TDI from the employee", () => {
    const federal = resolveRules({ country: "US", region: "CA" }, "2026-06-01").federal;
    const p = calculatePaycheck({ employeeId: "e1", name: "Pat", payFrequency: "weekly", hourlyRate: "25.00", regularHours: "40", w4: { filingStatus: "single_or_mfs", step2Checked: false } },
      { federal, state: pack("RI"), provenance: [] }, {}, "2026-09-04");
    expect(p.taxes.find((t) => t.code === "RI_TDI")?.amountMinor).toBe(1100n);
  });
});
