import type { StateRulePack } from "./types.js";

// Mississippi 2026. Withholding follows the Department of Revenue's Computer
// Payroll Accounting flowchart for periods in 2026 and Pub 89-700 (revised
// January 13, 2026), read from them on 2026-10-29: the year's wages less the
// Form 89-350 exemption and the standard deduction for the status, 0% on the
// first $10,000 and 4% above, rounded to the dollar each paycheck. Released
// 2026-10-29 after Greg's review (docs/rule-pack-review.md).
export const usMississippi2026: StateRulePack = {
  kind: "state",
  id: "us-ms",
  version: "2026.1",
  name: "Mississippi",
  place: { country: "US", region: "MS" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Mississippi DOR, Computer Payroll Accounting - For Periods In 2026 (revised 8/13/25)", covers: "standard deduction $2,300 single or married with both spouses employed, $3,400 head of family, $4,600 married with one spouse employed; taxable income less the 89-350 line 6 exemption; 0% on the first $10,000 and 4% above; round to whole dollars", basis: "published" },
    { ref: "Mississippi DOR, Pub 89-700-25-1 (revised January 13, 2026)", covers: "exemptions $6,000 single, $9,500 head of family, $12,000 married (divided between working spouses), $1,500 per dependent, age or blindness; no 89-350 means zero exemption; filing frequency assigned by the Department; monthly returns by the 15th of the next month, quarterly by the 15th of the month after the quarter", basis: "published" },
    { ref: "Payroll publishers on MDES 2026 rates (the MDES site doesn't state them)", covers: "$14,000 wage base; 1.0% new-employer rate (1.1% second year, 1.2% third)", basis: "working-knowledge" },
    { ref: "Mississippi has no state minimum wage or paid sick leave law; Miss. Code 71-3-... new hire reporting", covers: "federal $7.25 minimum wage; report new hires within 15 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Form 89-350 status: single ($6,000 exemption, $2,300 standard deduction), head of family ($9,500, $3,400), married with a spouse who doesn't work ($12,000, $4,600), or married with a working spouse ($6,000 each by default, $2,300). Dependents, age and blindness are $1,500 each. ⚠️ check: the 89-350 asks for a dollar total of exemptions (line 6); TrailBook asks for the status and the number of $1,500 extras, so working spouses who split the $12,000 unevenly can't be entered exactly.",
    "No 89-350 on file: zero exemption, as Pub 89-700 says, with the $2,300 single standard deduction. ⚠️ check: the publication doesn't say which standard deduction applies then.",
    "Deposits: TrailBook shows Mississippi withholding monthly, due the 15th of the next month. The Department of Revenue assigns each employer its frequency; quarterly filers pay by the 15th of the month after the quarter, later than shown.",
    "UI rates are per employer: enter yours from the MDES rate notice. ⚠️ check: the $14,000 wage base and the 1.0% new-employer rate (1.1% in the second year, 1.2% in the third) are from payroll publishers.",
    "Sales tax: TrailBook doesn't work out Mississippi sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "Form 89-350",
      statuses: [
        { id: "none", label: "No 89-350 (no exemption)", standardDeduction: "2300", table: "all" },
        { id: "single", label: "Single", standardDeduction: "2300", exemption: "6000", table: "all" },
        { id: "head_of_family", label: "Head of family", standardDeduction: "3400", exemption: "9500", table: "all" },
        { id: "married", label: "Married, spouse not employed", standardDeduction: "4600", exemption: "12000", table: "all" },
        { id: "married_both_work", label: "Married, spouse employed", standardDeduction: "2300", exemption: "6000", table: "all" },
      ],
      noCertificateStatus: "none",
      allowances: [{ label: "89-350 dependents, age and blindness ($1,500 each)", amount: "1500" }],
      tables: { all: [{ over: "0", rate: "0" }, { over: "10000", rate: "0.04" }] },
      round: "dollar",
    },
    incomeTaxAgency: { agency: "Mississippi DOR", code: "MS_WH", label: "Mississippi income tax", account: "ms_wh_payable" },
    taxes: [
      {
        code: "MS_UI", label: "Mississippi UI", agency: "MDES", paidBy: "employer", rate: "0.01", wageBase: "14000", account: "ms_ui_payable",
        assignedRate: { label: "Your Mississippi UI rate (%)", hint: "The total rate on your MDES rate notice. New employers pay 1.0% in the first year." },
      },
    ],
    deposits: [
      { kind: "ms_wh", codes: ["MS_WH"], agency: "Mississippi DOR", what: "Mississippi withholding", where: "Taxpayer Access Point (TAP)", schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 15, report: "89-105" },
      { kind: "ms_ui", codes: ["MS_UI"], agency: "MDES", what: "Mississippi UI", where: "MDES EZ Tax", schedule: "quarterly", report: "UI-2/UI-3" },
    ],
    employerAccount: { label: "Mississippi MDES employer account number", hint: "The number on your MDES notices. It goes on the quarterly wage report. Withholding uses your DOR withholding account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Mississippi income tax payable", systemKey: "ms_wh_payable" },
      { code: "2350", name: "Mississippi UI payable", systemKey: "ms_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "UI-2/UI-3", slug: "ms-ui", title: "Employer's Quarterly Contribution and Wage Report (UI-2/UI-3)", kind: "ui_wage_report", codes: ["MS_UI"], fileAt: "File and pay through MDES EZ Tax" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 15, newHireReportTo: "Mississippi New Hire Reporting",
  },
  business: { salesTax: null },
};
