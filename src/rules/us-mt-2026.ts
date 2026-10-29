import type { StateRulePack } from "./types.js";

// Montana 2026. Withholding follows the Department of Revenue's 2026
// withholding changes (HB 337: 4.7% on taxable income up to $47,500, $95,000
// joint or $71,250 head of household, 5.65% above) with the federal standard
// deduction as the zero band, as described in the Department's 2026
// withholding update and payroll publishers on 2026-10-29 (revenue.mt.gov
// isn't reachable from here, so the Employer's Guide wasn't read). Every
// figure is marked for checking. Released 2026-10-29 after Greg's review
// (docs/rule-pack-review.md).
export const usMontana2026: StateRulePack = {
  kind: "state",
  id: "us-mt",
  version: "2026.1",
  name: "Montana",
  place: { country: "US", region: "MT" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Montana Department of Revenue, 2026 Withholding Updates news release, as quoted in search results (not read directly)", covers: "tables, Employer's Guide and MW-4 updated December 2025; top rate 5.65% from January 1, 2026; 4.7% on income up to $95,000 joint, $71,250 head of household, $47,500 other; the method now resembles the federal one", basis: "working-knowledge" },
    { ref: "Payroll publishers' 2026 Montana tables (getuku, nationaltaxtools)", covers: "no withholding up to $16,100 single ($24,150 head of household), 4.7% to $63,600, $2,233 plus 5.65% above; MW-4 filing status, no allowances; rounded to the dollar", basis: "working-knowledge" },
    { ref: "Payroll publishers on Montana UI 2026", covers: "$47,300 wage base; new-employer rates by industry, about 1.18% to 2.18% with the administrative fund tax", basis: "working-knowledge" },
    { ref: "Montana minimum wage notice (CPI-adjusted); M.C.A. 39-51-... new hire reporting; no state paid sick leave law", covers: "$10.85 minimum wage for 2026; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "⚠️ check: revenue.mt.gov isn't reachable from here, so the 2026 Employer's Guide and its tables weren't read. The brackets are the federal 2026 standard deduction ($16,100 / $32,200 / $24,150) plus HB 337's 4.7% bands, which fits the Department's description and the publishers' single table; re-check the joint and head of household tables and the rounding once the site can be read.",
    "MW-4 (2026): single (or married filing separately), married filing jointly, or head of household; no allowances. ⚠️ check: with no MW-4 on file TrailBook uses single.",
    "Deposits: TrailBook shows Montana withholding monthly, due the 15th of the next month, and on the federal deposit dates for employers who withheld more than $12,000 in the lookback year. ⚠️ check: Montana's thresholds; employers withholding under $1,200 a year can pay once a year.",
    "UI rates are per employer and by industry for new employers: enter yours from the Montana Department of Labor and Industry rate notice, including the administrative fund tax. ⚠️ check: the $47,300 wage base is from payroll publishers.",
    "Montana has no sales tax.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "MW-4",
      statuses: [
        { id: "single", label: "Single or married filing separately", standardDeduction: "16100", table: "single" },
        { id: "married", label: "Married filing jointly", standardDeduction: "32200", table: "married" },
        { id: "head_of_household", label: "Head of household", standardDeduction: "24150", table: "head_of_household" },
      ],
      noCertificateStatus: "single",
      allowances: [],
      tables: {
        single: [{ over: "0", rate: "0.047" }, { over: "47500", rate: "0.0565" }],
        married: [{ over: "0", rate: "0.047" }, { over: "95000", rate: "0.0565" }],
        head_of_household: [{ over: "0", rate: "0.047" }, { over: "71250", rate: "0.0565" }],
      },
      round: "dollar",
    },
    incomeTaxAgency: { agency: "Montana Department of Revenue", code: "MT_WH", label: "Montana income tax", account: "mt_wh_payable" },
    taxes: [
      {
        code: "MT_UI", label: "Montana UI", agency: "Montana DLI", paidBy: "employer", rate: "0.0118", wageBase: "47300", account: "mt_ui_payable",
        assignedRate: { label: "Your Montana UI rate (%)", hint: "The total rate on your Department of Labor and Industry rate notice, including the administrative fund tax. New employers' rates depend on industry." },
      },
    ],
    deposits: [
      { kind: "mt_wh", codes: ["MT_WH"], agency: "Montana Department of Revenue", what: "Montana withholding", where: "TransAction Portal (TAP)", schedule: "monthly_or_larger", lookbackOver: "12000", largeFiler: "federal", dueDay: 15, report: "withholding payment" },
      { kind: "mt_ui", codes: ["MT_UI"], agency: "Montana DLI", what: "Montana UI", where: "Montana UI eServices for Employers", schedule: "quarterly", report: "UI-5" },
    ],
    employerAccount: { label: "Montana UI employer account number", hint: "The number on your Department of Labor and Industry notices. It goes on the UI-5. Withholding uses your Department of Revenue account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Montana income tax payable", systemKey: "mt_wh_payable" },
      { code: "2350", name: "Montana UI payable", systemKey: "mt_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "UI-5", slug: "mt-ui5", title: "Unemployment Insurance Quarterly Report (UI-5)", kind: "ui_wage_report", codes: ["MT_UI"], fileAt: "File and pay through Montana UI eServices for Employers" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "10.85",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Montana New Hire Reporting",
  },
  business: { salesTax: null },
};
