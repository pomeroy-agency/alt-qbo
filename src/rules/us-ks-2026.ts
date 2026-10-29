import type { StateRulePack } from "./types.js";

// Kansas 2026. Withholding follows the Department of Revenue's KW-100
// Withholding Tax Guide (Rev. 10-24, rates for wages paid from July 1, 2024,
// still the current guide) and its percentage method tables, read from them
// on 2026-10-29: the year's wages less the K-4 allowances ($9,160 for each
// personal allowance, one at the Single rate and two at the Joint rate, and
// $2,320 for each other allowance) and the $3,605 / $8,240 zero bracket,
// then 5.2% and 5.58%. Drafted 2026-10-29 for Greg's review
// (docs/rule-pack-review.md).
export const usKansas2026: StateRulePack = {
  kind: "state",
  id: "us-ks",
  version: "2026.1",
  name: "Kansas",
  place: { country: "US", region: "KS" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Kansas Department of Revenue, KW-100 Withholding Tax Guide (Rev. 10-24) and Tables for Percentage Method of Kansas Withholding (wages paid on and after July 1, 2024)", covers: "allowances $9,160 (single), $18,320 (joint), $2,320 per dependent or head of household allowance; zero bracket and 5.2% / 5.58% per payroll period (annual: single $3,605 then $23,000 of 5.2%, married $8,240 then $46,000); the $2,000 semi-monthly married example ($41.44); may round to the dollar; no K-4 means Single with no allowances", basis: "published" },
    { ref: "Same guide, Filing Frequencies and Due Dates", covers: "annual up to $200 a year, quarterly to $1,200 (25th after the quarter), monthly to $8,000 (15th of the next month), semi-monthly to $100,000, quad-monthly above", basis: "published" },
    { ref: "Kansas Legislative Research Department, Kansas Unemployment Insurance Trust Fund (August 2026)", covers: "$15,100 wage base for 2026; new employers 1.75% (construction 5.55%)", basis: "working-knowledge" },
    { ref: "K.S.A. 44-1203 (minimum wage follows the $7.25 federal rate); K.S.A. 39-7,119 (new hire reporting); no state paid sick leave law", covers: "$7.25 minimum wage; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "K-4: the allowance rate (Single or Joint) and the total allowances on line 4. TrailBook values the first allowance at $9,160 (two at the Joint rate) and the rest at $2,320, as the KW-100 wage bracket tables do. No K-4 on file: Single with no allowances, as the K-4 says.",
    "TrailBook works out the year's tax from the annual amounts; the guide's per-period tables round the brackets, so results can differ by a cent or two. The guide allows rounding to the dollar; TrailBook keeps cents.",
    "Deposits: TrailBook shows Kansas withholding monthly (KW-5), due the 15th of the next month. The Department assigns the frequency: employers withholding over $8,000 a year pay semi-monthly or quad-monthly, earlier than shown, and those under $1,200 can pay quarterly or yearly, later.",
    "UI rates are per employer: enter yours from the Kansas Department of Labor rate notice. New employers pay 1.75% (construction 5.55%). ⚠️ check: the $15,100 wage base comes from the Legislative Research Department; www.dol.ks.gov isn't reachable from here.",
    "Sales tax: TrailBook doesn't work out Kansas sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "K-4",
      statuses: [
        { id: "single", label: "Single allowance rate", standardDeduction: "3605", table: "single", firstAllowances: { count: 1, amount: "9160" } },
        { id: "joint", label: "Joint allowance rate", standardDeduction: "8240", table: "joint", firstAllowances: { count: 2, amount: "9160" } },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "K-4 allowances (line 4)", amount: "2320" }],
      tables: {
        single: [{ over: "0", rate: "0.052" }, { over: "23000", rate: "0.0558" }],
        joint: [{ over: "0", rate: "0.052" }, { over: "46000", rate: "0.0558" }],
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Kansas Department of Revenue", code: "KS_WH", label: "Kansas income tax", account: "ks_wh_payable" },
    taxes: [
      {
        code: "KS_UI", label: "Kansas UI", agency: "Kansas DOL", paidBy: "employer", rate: "0.0175", wageBase: "15100", account: "ks_ui_payable",
        assignedRate: { label: "Your Kansas UI rate (%)", hint: "The rate on your Kansas Department of Labor rate notice. New employers pay 1.75% (construction 5.55%)." },
      },
    ],
    deposits: [
      { kind: "ks_wh", codes: ["KS_WH"], agency: "Kansas Department of Revenue", what: "Kansas withholding", where: "Kansas Customer Service Center", schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 15, report: "KW-5" },
      { kind: "ks_ui", codes: ["KS_UI"], agency: "Kansas DOL", what: "Kansas UI", where: "KansasEmployer.gov", schedule: "quarterly", report: "K-CNS 100" },
    ],
    employerAccount: { label: "Kansas UI employer account number", hint: "The number on your Kansas Department of Labor notices. It goes on the K-CNS 100. Withholding uses your Department of Revenue withholding account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Kansas income tax payable", systemKey: "ks_wh_payable" },
      { code: "2350", name: "Kansas UI payable", systemKey: "ks_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "K-CNS 100", slug: "kcns100", title: "Employer's Quarterly Wage Report and Unemployment Tax Return (K-CNS 100)", kind: "ui_wage_report", codes: ["KS_UI"], fileAt: "File and pay through KansasEmployer.gov" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Kansas New Hire Directory",
  },
  business: { salesTax: null },
};
