import type { StateRulePack } from "./types.js";

// Virginia 2026. Withholding follows the formula in Virginia Tax's Employer
// Withholding Instructions (2614086 Rev. 10/26), read from the booklet itself
// on 2026-10-29: the year's wages less $8,750, $930 for each personal
// exemption and $800 for each age 65 or blind exemption, through the 2% to
// 5.75% rates, rounded to the dollar and divided by the pay periods. Draft
// until Greg reviews it (docs/rule-pack-review.md).
export const usVirginia2026: StateRulePack = {
  kind: "state",
  id: "us-va",
  version: "2026.1",
  name: "Virginia",
  place: { country: "US", region: "VA" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Virginia Tax, Employer Withholding Instructions (2614086 Rev. 10/26), formula for taxable year 2025 and after", covers: "$8,750 deduction; $930 per personal exemption (E1) and $800 per age 65 or blind exemption (E2); 2%, 3%, 5%, 5.75% brackets; the $109.50 example", basis: "published" },
    { ref: "Virginia Tax, Employer Withholding Instructions, filing frequency and Forms VA-5, VA-15, VA-16", covers: "quarterly under $300 a quarter, monthly from $300 to $2,999 (VA-5 due the 25th), semi-weekly from $3,000 a quarter (within 3 banking days of the federal cutoff)", basis: "published" },
    { ref: "VEC 2026 rates, as summarised by Paychex and Paylocity", covers: "$8,000 wage base; 2.5% new-employer rate", basis: "published" },
    { ref: "Virginia DOLI, minimum wage notice (July 2025)", covers: "$12.77 from January 1, 2026", basis: "published" },
    { ref: "Va. Code 63.2-1946 (new hire reporting)", covers: "report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "The annual tax is rounded to the whole dollar before dividing, as in Virginia's own example ($2,628 / 24 = $109.50).",
    "VA-4 line 1 is personal exemptions (E1, $930 each); line 2 is exemptions for age 65 or blindness (E2, $800 each). No VA-4 on file: no exemptions.",
    "Withholding is paid monthly by the 25th (VA-5), or semi-weekly on the federal dates from $3,000 a quarter (VA-15, with the VA-16 each quarter). TrailBook decides from last year's withholding; Virginia Tax's filing-frequency letter controls. Quarterly filers (under $300 a quarter) can pay monthly.",
    "UI rates are per employer: enter yours from the VEC rate notice, including the fund-building and pool charges. New employers pay 2.5%.",
    "Virginia has no general paid sick leave law (only home health workers are covered).",
    "Sales tax: TrailBook doesn't work out Virginia sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "VA-4",
      statuses: [{ id: "single", label: "Any", standardDeduction: "8750", table: "all" }],
      noCertificateStatus: "single",
      allowances: [{ label: "VA-4 personal exemptions", amount: "930" }, { label: "VA-4 exemptions for age 65 or blindness", amount: "800" }],
      tables: { all: [{ over: "0", rate: "0.02" }, { over: "3000", rate: "0.03" }, { over: "5000", rate: "0.05" }, { over: "17000", rate: "0.0575" }] },
      round: "annual_dollar",
    },
    incomeTaxAgency: { agency: "Virginia Tax", code: "VA_WH", label: "Virginia income tax", account: "va_wh_payable" },
    taxes: [
      {
        code: "VA_UI", label: "Virginia UI", agency: "VEC", paidBy: "employer", rate: "0.025", wageBase: "8000", account: "va_ui_payable",
        assignedRate: { label: "Your Virginia UI rate (%)", hint: "The total rate on your VEC rate notice. New employers pay 2.5%." },
      },
    ],
    deposits: [
      {
        kind: "va_wh", codes: ["VA_WH"], agency: "Virginia Tax", what: "Virginia withholding", where: "Virginia Tax online services for businesses",
        schedule: "monthly_or_larger", lookbackOver: "12000", largeFiler: "federal", dueDay: 25, report: "VA-5",
      },
      { kind: "va_ui", codes: ["VA_UI"], agency: "VEC", what: "Virginia UI", where: "VEC Employer Services", schedule: "quarterly", report: "VEC-FC-20/21" },
    ],
    employerAccount: { label: "VEC employer account number", hint: "The number on your VEC notices. It goes on the VEC-FC-20. Withholding uses your Virginia Tax account number.", pattern: "^[0-9 -]{6,12}$" },
    accounts: [
      { code: "2340", name: "Virginia income tax payable", systemKey: "va_wh_payable" },
      { code: "2350", name: "Virginia UI payable", systemKey: "va_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "VEC-FC-20/21", slug: "vecfc20", title: "Employer's Quarterly Tax and Payroll Report (VEC-FC-20/21)", kind: "ui_wage_report", codes: ["VA_UI"], fileAt: "File and pay through VEC Employer Services" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "12.77",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Virginia New Hire Reporting Center",
  },
  business: { salesTax: null },
};
