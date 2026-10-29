import type { StateRulePack } from "./types.js";

// North Dakota 2026. Withholding follows the Office of State Tax
// Commissioner's 2026 Income Tax Withholding Rates and Instructions,
// Section 2 (Forms W-4 for 2020 and after), read from it on 2026-10-29:
// there's no state certificate; the year's wages through the annual table
// for the federal W-4 filing status (nothing up to $57,625 single, $57,500
// married filing jointly or $78,475 head of household, then 1.95% and
// 2.5%), divided by the paychecks and rounded to the dollar. Drafted
// 2026-10-29 for Greg's review (docs/rule-pack-review.md).
export const usNorthDakota2026: StateRulePack = {
  kind: "state",
  id: "us-nd",
  version: "2026.1",
  name: "North Dakota",
  place: { country: "US", region: "ND" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "North Dakota Office of State Tax Commissioner, 2026 Income Tax Withholding Rates and Instructions, Section 2 (Annual Percentage Method Tables and weekly wage bracket table, Forms W-4 for 2020 and after)", covers: "single 0% to $57,625, 1.95% to $258,450 ($3,916.09), 2.5% above; married filing jointly $57,500 and $168,525 ($2,164.99); head of household $78,475 and $289,675 ($4,118.40); filing status from the federal W-4 Step 1(c), single with no W-4; round to the nearest dollar", basis: "published" },
    { ref: "Same Office, Guideline – Income Tax Withholding and Information Returns", covers: "Form 306 quarterly by the last day of the month after the quarter; annual filing by January 31 for employers who withheld under $1,000 the year before and filed on time", basis: "published" },
    { ref: "Bloomberg Tax and payroll publishers on Job Service North Dakota 2026 rates", covers: "$46,600 wage base; 1.00% new-employer rate (construction 9.67%)", basis: "working-knowledge" },
    { ref: "N.D.C.C. 34-06-22 (minimum wage follows the $7.25 federal rate); N.D.C.C. 50-09-02.2 (new hire reporting); no state paid sick leave law", covers: "$7.25 minimum wage; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "North Dakota has no withholding certificate of its own; TrailBook uses the filing status on the employee's federal W-4 (Step 1(c)). Employees still on a pre-2020 W-4 should be asked for a current one: TrailBook doesn't use the booklet's Section 1 allowance tables.",
    "⚠️ check: the booklet's single-filer example ($1,800 weekly, $734 a year) doesn't match its own 2026 table, which gives $701.51 a year ($13 a week); the 2026 wage bracket table agrees with the annual table, so TrailBook follows the table.",
    "Deposits: TrailBook shows North Dakota withholding quarterly with Form 306, due the last day of the month after the quarter. Employers who withheld under $1,000 last year can file once a year by January 31 instead.",
    "UI rates are per employer: enter yours from the Job Service North Dakota rate notice. ⚠️ check: the $46,600 wage base and the 1.00% new-employer rate are from Bloomberg Tax and payroll publishers.",
    "Sales tax: TrailBook doesn't work out North Dakota sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: null,
      statuses: [
        { id: "single", label: "Single or married filing separately", standardDeduction: "0", table: "single" },
        { id: "married", label: "Married filing jointly", standardDeduction: "0", table: "married" },
        { id: "head_of_household", label: "Head of household", standardDeduction: "0", table: "head_of_household" },
      ],
      noCertificateStatus: "single",
      statusFromW4: { single_or_mfs: "single", mfj: "married", hoh: "head_of_household" },
      allowances: [],
      tables: {
        single: [{ over: "0", rate: "0" }, { over: "57625", rate: "0.0195" }, { over: "258450", rate: "0.025" }],
        married: [{ over: "0", rate: "0" }, { over: "57500", rate: "0.0195" }, { over: "168525", rate: "0.025" }],
        head_of_household: [{ over: "0", rate: "0" }, { over: "78475", rate: "0.0195" }, { over: "289675", rate: "0.025" }],
      },
      round: "dollar",
    },
    incomeTaxAgency: { agency: "ND Office of State Tax Commissioner", code: "ND_WH", label: "North Dakota income tax", account: "nd_wh_payable" },
    taxes: [
      {
        code: "ND_UI", label: "North Dakota UI", agency: "Job Service North Dakota", paidBy: "employer", rate: "0.01", wageBase: "46600", account: "nd_ui_payable",
        assignedRate: { label: "Your North Dakota UI rate (%)", hint: "The rate on your Job Service North Dakota rate notice. New employers pay 1.00% (construction 9.67%)." },
      },
    ],
    deposits: [
      { kind: "nd_wh", codes: ["ND_WH"], agency: "ND Office of State Tax Commissioner", what: "North Dakota withholding", where: "North Dakota Taxpayer Access Point (ND TAP)", schedule: "quarterly", report: "Form 306" },
      { kind: "nd_ui", codes: ["ND_UI"], agency: "Job Service North Dakota", what: "North Dakota UI", where: "UI EASY", schedule: "quarterly", report: "UI contribution and wage report" },
    ],
    employerAccount: { label: "Job Service North Dakota employer account number", hint: "The number on your Job Service North Dakota notices. It goes on the quarterly wage report. Withholding uses your ND TAP withholding account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "North Dakota income tax payable", systemKey: "nd_wh_payable" },
      { code: "2350", name: "North Dakota UI payable", systemKey: "nd_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "Form 306", slug: "nd306", title: "Income Tax Withholding Return (Form 306)", kind: "withholding_return", codes: ["ND_WH"], fileAt: "File and pay through ND TAP" },
      { form: "ND UI", slug: "nd-ui", title: "Quarterly Contribution and Wage Report", kind: "ui_wage_report", codes: ["ND_UI"], fileAt: "File and pay through UI EASY" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "North Dakota New Hire Reporting Center",
  },
  business: { salesTax: null },
};
