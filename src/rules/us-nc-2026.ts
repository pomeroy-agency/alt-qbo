import type { StateRulePack } from "./types.js";

// North Carolina 2026. Withholding follows the annualized wages method in
// NC-30 (2026), read from the publication itself on 2026-10-29: 4.09% (the
// 3.99% tax rate plus 0.1%) of the year's wages less the standard deduction
// and $2,500 an allowance, per pay period, rounded to the whole dollar.
// Draft until Greg reviews it (docs/rule-pack-review.md).
export const usNorthCarolina2026: StateRulePack = {
  kind: "state",
  id: "us-nc",
  version: "2026.1",
  name: "North Carolina",
  place: { country: "US", region: "NC" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "NCDOR, NC-30 Income Tax Withholding Tables and Instructions for Employers (2026), sections 15, 16 and 27 and pages 17 to 20", covers: "4.09% withholding rate; $12,750 standard deduction (single, married, surviving spouse) and $19,125 (head of household); $2,500 an allowance; round to the whole dollar; no NC-4 means single with no allowances; monthly NC-5 by the 15th for $250 to $2,000 a month, semiweekly with federal deposits from $2,000 a month", basis: "published" },
    { ref: "NC DES 2026 UI rates, as summarised by payroll publishers", covers: "$34,200 wage base; 1.0% new-employer rate", basis: "published" },
    { ref: "G.S. 95-25.3 (minimum wage follows the federal $7.25)", covers: "$7.25 minimum wage; no state paid sick leave law", basis: "working-knowledge" },
    { ref: "G.S. 110-129.2 (new hire reporting)", covers: "report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "No NC-4 on file: single with no allowances.",
    "Withholding is rounded to the whole dollar each paycheck, as NC-30 asks, before any extra withholding.",
    "Deposits: monthly by the 15th (December's by January 31; TrailBook shows January 15, which is early but safe), or on the federal semiweekly dates once you average $2,000 a month. TrailBook decides from last year's withholding; quarterly filers (under $250 a month) may pay monthly. NCDOR's assigned frequency controls.",
    "UI rates are per employer: enter yours from the DES rate notice. New employers pay 1.0%.",
    "Sales tax: TrailBook doesn't work out North Carolina sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "NC-4",
      statuses: [
        { id: "single", label: "Single", standardDeduction: "12750", table: "all" },
        { id: "married", label: "Married or surviving spouse", standardDeduction: "12750", table: "all" },
        { id: "hoh", label: "Head of household", standardDeduction: "19125", table: "all" },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "NC-4 allowances", amount: "2500" }],
      tables: { all: [{ over: "0", rate: "0.0409" }] },
      round: "dollar",
    },
    incomeTaxAgency: { agency: "NCDOR", code: "NC_WH", label: "North Carolina income tax", account: "nc_wh_payable" },
    taxes: [
      {
        code: "NC_UI", label: "North Carolina UI", agency: "DES", paidBy: "employer", rate: "0.01", wageBase: "34200", account: "nc_ui_payable",
        assignedRate: { label: "Your North Carolina UI rate (%)", hint: "It's on the rate notice DES sends each year. New employers pay 1.0%." },
      },
    ],
    deposits: [
      {
        kind: "nc_wh", codes: ["NC_WH"], agency: "NCDOR", what: "North Carolina withholding", where: "NCDOR online filing and payment (NC-5)",
        schedule: "monthly_or_larger", lookbackOver: "24000", largeFiler: "federal", dueDay: 15, report: "NC-5",
      },
      { kind: "nc_ui", codes: ["NC_UI"], agency: "DES", what: "North Carolina UI", where: "DES employer portal", schedule: "quarterly", report: "NCUI 101" },
    ],
    employerAccount: { label: "North Carolina DES account number", hint: "The number on your DES notices. It goes on the NCUI 101. Withholding uses your NCDOR withholding account ID.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "North Carolina income tax payable", systemKey: "nc_wh_payable" },
      { code: "2350", name: "North Carolina UI payable", systemKey: "nc_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "NC-5Q", slug: "nc5q", title: "North Carolina Quarterly Income Tax Withholding Return (NC-5 / NC-5Q)", kind: "withholding_return", codes: ["NC_WH"], fileAt: "File and pay through NCDOR's online services" },
      { form: "NCUI 101", slug: "ncui101", title: "Employer's Quarterly Tax and Wage Report (NCUI 101)", kind: "ui_wage_report", codes: ["NC_UI"], fileAt: "File and pay through the DES employer portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "North Carolina New Hire Reporting Program",
  },
  business: { salesTax: null },
};
