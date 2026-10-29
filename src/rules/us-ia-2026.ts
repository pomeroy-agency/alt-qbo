import type { StateRulePack } from "./types.js";

// Iowa 2026. Withholding follows the Department of Revenue's Iowa
// Withholding Formula effective January 1, 2026 (released November 2025),
// read from it on 2026-10-29: wages less the deduction for the IA W-4
// marital status ($13,000 a year for "other" or married with a working
// spouse, $19,500 head of household, $26,000 married with a non-working
// spouse), at the flat 3.8%, less the IA W-4 allowance amount spread over
// the pay periods. Drafted 2026-10-29 for Greg's review
// (docs/rule-pack-review.md).
export const usIowa2026: StateRulePack = {
  kind: "state",
  id: "us-ia",
  version: "2026.1",
  name: "Iowa",
  place: { country: "US", region: "IA" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Iowa Department of Revenue, Iowa Withholding Formula, effective January 1, 2026 (released November 2025)", covers: "deductions $13,000 / $19,500 / $26,000 a year by IA W-4 marital status; 3.8% rate; allowance amount off the tax; $40 per allowance on 2023 and earlier IA W-4s; examples 1 to 3 ($59.26, $38.72, $45.15)", basis: "published" },
    { ref: "Iowa Department of Revenue, Iowa Withholding Tax Information and Filing Frequency and Return Due Dates pages", covers: "no IA W-4: an allowance amount of zero (701 IAC 307.3(3)\"a\"); quarterly under $6,000 a year; monthly $6,000 to $120,000 by the 15th for the first two months of a quarter; semimonthly over $120,000", basis: "published" },
    { ref: "Iowa Workforce Development 2026 rates, as reported by Bloomberg Tax", covers: "$20,400 wage base (down from $39,500); 1.0% new-employer rate", basis: "working-knowledge" },
    { ref: "Iowa Code 91D.1 (minimum wage $7.25); Iowa Code 252G.3 (new hire reporting within 15 days); no state paid sick leave law", covers: "$7.25 minimum wage; report new hires within 15 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "IA W-4 marital status: \"Other\" (or married filing jointly with a working spouse, or not given), head of household, or married filing jointly with a spouse who has no earned income (or qualifying surviving spouse).",
    "Allowances: the 2024 and later IA W-4 asks for a dollar total allowance amount (normally $40 for each person and dependent claimed). TrailBook asks for the number of $40 allowances, so enter the IA W-4 total ÷ 40. An older (2023 or earlier) IA W-4 counts allowances directly, at $40 each, the same way. ⚠️ check: an older IA W-4's \"single\" uses the $13,000 deduction and \"married\" the $26,000 one; pick those statuses for employees who haven't refiled.",
    "No IA W-4 on file: \"Other\" with no allowances.",
    "Deposits: TrailBook shows Iowa withholding monthly, due the 15th of the next month, and for employers with more than $120,000 last year on the federal deposit dates. Iowa's own dates differ a little: the third month of each quarter is paid with the quarterly return at the end of the next month, and semimonthly filers pay by the 25th and the 10th. Quarterly filers (under $6,000 a year) can pay later than shown.",
    "UI rates are per employer: enter yours from the Iowa Workforce Development rate notice. New employers pay 1.0%. The 2026 wage base fell to $20,400 (it rises to $21,100 in 2027).",
    "Sales tax: TrailBook doesn't work out Iowa sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "IA W-4",
      statuses: [
        { id: "other", label: "Other, or married with a spouse who works", standardDeduction: "13000", table: "all" },
        { id: "head_of_household", label: "Head of household", standardDeduction: "19500", table: "all" },
        { id: "married_one_income", label: "Married, spouse has no earned income (or surviving spouse)", standardDeduction: "26000", table: "all" },
      ],
      noCertificateStatus: "other",
      allowances: [{ label: "IA W-4 allowances ($40 each)", amount: "40", credit: true }],
      tables: { all: [{ over: "0", rate: "0.038" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Iowa Revenue", code: "IA_WH", label: "Iowa income tax", account: "ia_wh_payable" },
    taxes: [
      {
        code: "IA_UI", label: "Iowa UI", agency: "IWD", paidBy: "employer", rate: "0.01", wageBase: "20400", account: "ia_ui_payable",
        assignedRate: { label: "Your Iowa UI rate (%)", hint: "The rate on your Iowa Workforce Development rate notice. New employers pay 1.0%." },
      },
    ],
    deposits: [
      { kind: "ia_wh", codes: ["IA_WH"], agency: "Iowa Revenue", what: "Iowa withholding", where: "GovConnectIowa", schedule: "monthly_or_larger", lookbackOver: "120000", largeFiler: "federal", dueDay: 15, report: "quarterly withholding return" },
      { kind: "ia_ui", codes: ["IA_UI"], agency: "IWD", what: "Iowa UI", where: "My IowaUI employer account", schedule: "quarterly", report: "quarterly contribution and payroll report" },
    ],
    employerAccount: { label: "Iowa UI employer account number", hint: "The number on your Iowa Workforce Development notices. It goes on the quarterly payroll report. Withholding uses your Iowa withholding permit.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Iowa income tax payable", systemKey: "ia_wh_payable" },
      { code: "2350", name: "Iowa UI payable", systemKey: "ia_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "IA withholding", slug: "ia-wh", title: "Iowa Quarterly Withholding Tax Return", kind: "withholding_return", codes: ["IA_WH"], fileAt: "File through GovConnectIowa" },
      { form: "IA UI", slug: "ia-ui", title: "Iowa Quarterly Contribution and Payroll Report", kind: "ui_wage_report", codes: ["IA_UI"], fileAt: "File and pay through My IowaUI" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 15, newHireReportTo: "Iowa Centralized Employee Registry",
  },
  business: { salesTax: null },
};
