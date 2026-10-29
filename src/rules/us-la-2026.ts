import type { StateRulePack } from "./types.js";

// Louisiana 2026. Withholding follows the Department of Revenue's R-1306
// (1/26), Louisiana Withholding Tables and Formulas effective January 1,
// 2026, read from it on 2026-10-29: wages less the L-4 standard deduction
// spread over the pay periods ($12,875 single or married separate, $25,750
// married joint, qualifying surviving spouse or head of household, nothing
// for "0"), at 3.09%. Released 2026-10-29 after Greg's review
// (docs/rule-pack-review.md).
export const usLouisiana2026: StateRulePack = {
  kind: "state",
  id: "us-la",
  version: "2026.1",
  name: "Louisiana",
  place: { country: "US", region: "LA" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Louisiana Department of Revenue, R-1306 (1/26), Louisiana Withholding Tables and Formulas", covers: "3.09% rate; standard deduction $12,875 (L-4 \"1\") or $25,750 (L-4 \"2\"), none for \"0\"; the $700 weekly example ($13.98) and $4,600 biweekly example ($111.54)", basis: "published" },
    { ref: "Louisiana Department of Revenue, Withholding page (updated June 30, 2026)", covers: "quarterly L-1 return; payments quarterly under $500 a month on average, monthly $500 to $5,000, semi-monthly $5,000 or more; L-3 annual reconciliation", basis: "published" },
    { ref: "Louisiana Workforce Commission 2026 rates, as reported by Bloomberg Tax and payroll publishers", covers: "$7,000 wage base; new employers pay their industry's average rate (at least 1%, at most 6.2%)", basis: "working-knowledge" },
    { ref: "Louisiana has no state minimum wage or paid sick leave law; La. R.S. 23:1291.1 (new hire reporting)", covers: "federal $7.25 minimum wage; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "L-4 standard deduction: \"0\" (none), \"1\" (single or married filing separately, $12,875) or \"2\" (married filing jointly, qualifying surviving spouse or head of household, $25,750). The L-4 no longer has dependents. ⚠️ check: with no L-4 on file TrailBook uses \"0\" (no deduction), the cautious choice; R-1306 doesn't say.",
    "Deposits: TrailBook shows Louisiana withholding monthly, due the last day of the next month, and for employers who withheld more than $60,000 last year ($5,000 a month) on the federal deposit dates. ⚠️ check: Louisiana's semi-monthly and monthly due dates are on LDR's filing calendar, which TrailBook doesn't have yet; quarterly payers (under $500 a month) can pay later than shown.",
    "UI rates are per employer and there is no single new-employer rate: Louisiana assigns new employers their industry's average. Pay runs wait until you enter yours from the Louisiana Workforce Commission rate notice.",
    "Sales tax: TrailBook doesn't work out Louisiana sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "L-4",
      statuses: [
        { id: "none", label: "0 (no standard deduction)", standardDeduction: "0", table: "all" },
        { id: "single", label: "1 (single or married filing separately)", standardDeduction: "12875", table: "all" },
        { id: "joint", label: "2 (married joint, surviving spouse or head of household)", standardDeduction: "25750", table: "all" },
      ],
      noCertificateStatus: "none",
      allowances: [],
      tables: { all: [{ over: "0", rate: "0.0309" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "LDR", code: "LA_WH", label: "Louisiana income tax", account: "la_wh_payable" },
    taxes: [
      {
        code: "LA_UI", label: "Louisiana UI", agency: "LWC", paidBy: "employer", rate: "0.01", wageBase: "7000", account: "la_ui_payable",
        assignedRate: { label: "Your Louisiana UI rate (%)", hint: "The rate on your Louisiana Workforce Commission rate notice. New employers get their industry's average rate.", required: true },
      },
    ],
    deposits: [
      { kind: "la_wh", codes: ["LA_WH"], agency: "LDR", what: "Louisiana withholding", where: "LaTAP", schedule: "monthly_or_larger", lookbackOver: "60000", largeFiler: "federal", dueDay: "last", report: "L-1" },
      { kind: "la_ui", codes: ["LA_UI"], agency: "LWC", what: "Louisiana UI", where: "LWC employer portal (LaWage)", schedule: "quarterly", report: "LWC-UI-4" },
    ],
    employerAccount: { label: "Louisiana UI employer account number", hint: "The number on your Louisiana Workforce Commission notices. It goes on the quarterly wage report. Withholding uses your LDR account number.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Louisiana income tax payable", systemKey: "la_wh_payable" },
      { code: "2350", name: "Louisiana UI payable", systemKey: "la_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "L-1", slug: "l1", title: "Employer's Quarterly Return of Louisiana Withholding Tax (L-1)", kind: "withholding_return", codes: ["LA_WH"], fileAt: "File through LaTAP" },
      { form: "LWC-UI-4", slug: "lwc-ui4", title: "Employer's Quarterly Report of Wages Paid (LWC-UI-4)", kind: "ui_wage_report", codes: ["LA_UI"], fileAt: "File and pay through the LWC employer portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Louisiana New Hire Registry",
  },
  business: { salesTax: null },
};
