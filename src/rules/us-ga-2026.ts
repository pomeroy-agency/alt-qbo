import type { StateRulePack } from "./types.js";

// Georgia 2026. Withholding follows the percentage method in the 2026
// Employer's Tax Guide (updated June 2026), read from the guide itself on
// 2026-10-29: 4.99% of wages less the standard deduction and $5,000 a
// dependent allowance (HB 463). Employers withheld 5.19% until they switched
// (from May 11, 2026); this pack has only the current figures. Released
// 2026-10-29 after Greg's review (docs/rule-pack-review.md).
export const usGeorgia2026: StateRulePack = {
  kind: "state",
  id: "us-ga",
  version: "2026.1",
  name: "Georgia",
  place: { country: "US", region: "GA" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Georgia DOR, 2026 Employer's Tax Guide (updated June 2026), What's New and Percentage Method (Table E)", covers: "4.99% from May 11, 2026 (5.19% before); $30,000 standard deduction married filing jointly with one income, $15,000 for every other status; $5,000 a dependent allowance; no G-4 means single with zero allowances", basis: "published" },
    { ref: "Georgia DOR, 2026 Employer's Tax Guide, payment schedules", covers: "monthly by the 15th for $50,000 or less in the lookback period; semi-weekly above it; G-7 quarterly", basis: "published" },
    { ref: "GDOL 2026 UI rates, as summarised by payroll publishers", covers: "$9,500 wage base; 2.7% new-employer rate (2.64% plus the 0.06% administrative assessment)", basis: "published" },
    { ref: "O.C.G.A. 34-4-3 (federal $7.25 minimum wage applies to covered employers)", covers: "$7.25 minimum wage; no state paid sick leave law", basis: "working-knowledge" },
    { ref: "O.C.G.A. 49-5-121 (new hire reporting)", covers: "report new hires within 10 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Pay runs before May 11, 2026 may have used 5.19% and the old deductions; TrailBook uses the current figures for the whole year.",
    "G-4 statuses: single (A), married filing jointly with both spouses working (B), married filing jointly with one income (C, the only one with the $30,000 deduction), married filing separately (D), head of household (E).",
    "Only dependent allowances are modelled, at $5,000 each. The G-4's additional allowances for itemized deductions aren't, so an employee who claims them is over-withheld; adjust with fewer extra dollars if needed.",
    "No G-4 on file: single with zero allowances.",
    "Deposits: monthly by the 15th, or semi-weekly on the federal dates above $50,000 in the lookback period. Quarterly and annual payers (under $200 a month) may pay monthly. TrailBook decides from last year's withholding.",
    "UI rates are per employer: enter yours (including the 0.06% administrative assessment) from the GDOL rate notice. New employers pay 2.7%.",
    "Georgia wants new hires reported within 10 days, faster than most states.",
    "Sales tax: TrailBook doesn't work out Georgia sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "G-4",
      statuses: [
        { id: "single", label: "A: Single", standardDeduction: "15000", table: "all" },
        { id: "mfj_both", label: "B: Married filing jointly, both spouses working", standardDeduction: "15000", table: "all" },
        { id: "mfj_one", label: "C: Married filing jointly, one spouse working", standardDeduction: "30000", table: "all" },
        { id: "mfs", label: "D: Married filing separately", standardDeduction: "15000", table: "all" },
        { id: "hoh", label: "E: Head of household", standardDeduction: "15000", table: "all" },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "G-4 dependent allowances", amount: "5000" }],
      tables: { all: [{ over: "0", rate: "0.0499" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "GA DOR", code: "GA_WH", label: "Georgia income tax", account: "ga_wh_payable" },
    taxes: [
      {
        code: "GA_UI", label: "Georgia UI", agency: "GDOL", paidBy: "employer", rate: "0.027", wageBase: "9500", account: "ga_ui_payable",
        assignedRate: { label: "Your Georgia UI rate (%)", hint: "The total on your GDOL rate notice, including the 0.06% administrative assessment. New employers pay 2.7%." },
      },
    ],
    deposits: [
      {
        kind: "ga_wh", codes: ["GA_WH"], agency: "GA DOR", what: "Georgia withholding", where: "Georgia Tax Center",
        schedule: "monthly_or_larger", lookbackOver: "50000", largeFiler: "federal", dueDay: 15, report: "G-7",
      },
      { kind: "ga_ui", codes: ["GA_UI"], agency: "GDOL", what: "Georgia UI", where: "GDOL Employer Portal", schedule: "quarterly", report: "DOL-4N" },
    ],
    employerAccount: { label: "GDOL employer account number", hint: "The number on your Georgia Department of Labor notices. It goes on the DOL-4N. Withholding uses your Georgia withholding number.", pattern: "^[0-9]{6,9}$" },
    accounts: [
      { code: "2340", name: "Georgia income tax payable", systemKey: "ga_wh_payable" },
      { code: "2350", name: "Georgia UI payable", systemKey: "ga_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "G-7", slug: "g7", title: "Georgia Quarterly Return for Monthly Payer (G-7)", kind: "withholding_return", codes: ["GA_WH"], fileAt: "File through the Georgia Tax Center" },
      { form: "DOL-4N", slug: "dol4n", title: "Employer's Quarterly Tax and Wage Report (DOL-4N)", kind: "ui_wage_report", codes: ["GA_UI"], fileAt: "File and pay through the GDOL Employer Portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 10, newHireReportTo: "Georgia New Hire Reporting Program",
  },
  business: { salesTax: null },
};
