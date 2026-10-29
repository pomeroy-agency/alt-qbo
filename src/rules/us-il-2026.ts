import type { StateRulePack } from "./types.js";

// Illinois 2026. Withholding follows the automated payroll method in Booklet
// IL-700-T (R-12/25), read from the booklet itself on 2026-10-29: 4.95% of
// wages less $2,925 for each IL-W-4 line 1 allowance and $1,000 for each
// line 2 allowance, spread over the pay periods. Released 2026-10-29 after
// Greg's review (docs/rule-pack-review.md).
export const usIllinois2026: StateRulePack = {
  kind: "state",
  id: "us-il",
  version: "2026.1",
  name: "Illinois",
  place: { country: "US", region: "IL" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "IDOR Booklet IL-700-T (R-12/25), Illinois Withholding Tax Tables, effective January 1, 2026, page 3", covers: "4.95% rate; $2,925 per line 1 allowance and $1,000 per line 2 allowance; automated payroll method and its $32.13 example", basis: "published" },
    { ref: "IDOR, Form IL-941 instructions (tax.illinois.gov)", covers: "monthly payments for $12,000 or less withheld in the look-back period (July to June); semi-weekly above it; IL-941 filed quarterly", basis: "published" },
    { ref: "IDES 2026 contribution rates, as reported by Bloomberg Tax", covers: "$14,250 wage base; 3.35% new-employer rate including the 0.55% fund-building surtax (3.45% for NAICS sector 56)", basis: "published" },
    { ref: "820 ILCS 105/4 (Minimum Wage Law); Chicago and Cook County minimum wage notices (July 1, 2026, as reported by ABC7 Chicago)", covers: "$15.00 statewide; Chicago $16.60 to June 30 and $17.05 from July 1, 2026; Cook County $15.00 then $15.40", basis: "published" },
    { ref: "820 ILCS 192 (Paid Leave for All Workers Act)", covers: "1 hour of paid leave per 40 worked, up to 40 hours a year", basis: "working-knowledge" },
    { ref: "820 ILCS 405/1801.1 (new hire reporting)", covers: "report new hires to IDES within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "No IL-W-4 on file: no allowances (4.95% of all wages). IL-W-4 line 1 is the basic allowance count, line 2 the additional allowances for age 65 or blindness.",
    "The payroll period formula is computed for the year and divided by the pay periods; amounts can differ from the wage-bracket tables by a few cents.",
    "Withholding is paid monthly by the 15th of the next month, or semi-weekly on the federal dates once more than $12,000 was withheld in the look-back period. TrailBook uses last calendar year's withholding to decide; IDOR's notice of your payment schedule controls.",
    "UI rates are per employer: enter yours from the IDES rate notice. New employers pay 3.35% (3.45% in NAICS sector 56).",
    "Minimum wage depends on where the employee works: Chicago and the rest of Cook County have higher rates. Other local rates (Evanston, Oak Park and so on) aren't checked yet.",
    "Chicago's own paid leave and paid sick leave ordinance (40 hours each) replaces the state law there; TrailBook tracks the state's 40 hours.",
    "Paid leave carries over under the state law but use can be capped at 40 hours a year; TrailBook sets no balance cap.",
    "Sales tax: TrailBook doesn't work out Illinois sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "IL-W-4",
      statuses: [{ id: "single", label: "Any", standardDeduction: "0", table: "all" }],
      noCertificateStatus: "single",
      allowances: [{ label: "IL-W-4 line 1 allowances", amount: "2925" }, { label: "IL-W-4 line 2 allowances", amount: "1000" }],
      tables: { all: [{ over: "0", rate: "0.0495" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "IDOR", code: "IL_WH", label: "Illinois income tax", account: "il_wh_payable" },
    taxes: [
      {
        code: "IL_UI", label: "Illinois UI", agency: "IDES", paidBy: "employer", rate: "0.0335", wageBase: "14250", account: "il_ui_payable",
        assignedRate: { label: "Your Illinois UI rate (%)", hint: "It's on the rate notice IDES sends each year, including the fund-building surtax. New employers pay 3.35%." },
      },
    ],
    deposits: [
      {
        kind: "il_wh", codes: ["IL_WH"], agency: "IDOR", what: "Illinois withholding", where: "MyTax Illinois",
        schedule: "monthly_or_larger", lookbackOver: "12000", largeFiler: "federal", dueDay: 15, report: "IL-941",
      },
      { kind: "il_ui", codes: ["IL_UI"], agency: "IDES", what: "Illinois UI", where: "MyTax Illinois (IDES)", schedule: "quarterly", report: "UI-3/40" },
    ],
    employerAccount: { label: "IDES employer account number", hint: "The number on your IDES notices. It goes on the UI-3/40. Illinois withholding uses your federal EIN.", pattern: "^[0-9]{7,8}$" },
    accounts: [
      { code: "2340", name: "Illinois income tax payable", systemKey: "il_wh_payable" },
      { code: "2350", name: "Illinois UI payable", systemKey: "il_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "IL-941", slug: "il941", title: "Illinois Withholding Income Tax Return (IL-941)", kind: "withholding_return", codes: ["IL_WH"], fileAt: "File through MyTax Illinois" },
      { form: "UI-3/40", slug: "ui340", title: "Employer's Contribution and Wage Report (UI-3/40)", kind: "ui_wage_report", codes: ["IL_UI"], fileAt: "File and pay through MyTax Illinois" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "15.00",
    defaultAreaName: "Rest of Illinois",
    areas: [
      { name: "Chicago", minimumWage: "16.60", minimumWageChanges: [{ from: "2026-07-01", rate: "17.05" }] },
      { name: "Cook County, outside Chicago", minimumWage: "15.00", minimumWageChanges: [{ from: "2026-07-01", rate: "15.40" }] },
    ],
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: { law: "Paid Leave for All Workers Act (820 ILCS 192)", hoursWorkedPerHourAccrued: "40", annualUseCapHours: "40", accrualCapHours: null },
    newHireReportDays: 20, newHireReportTo: "Illinois Department of Employment Security (New Hire Directory)",
  },
  business: { salesTax: null },
};
