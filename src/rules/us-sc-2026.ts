import type { StateRulePack } from "./types.js";

// South Carolina 2026. Withholding follows SCDOR's WH-1603F, Formula for
// Computing South Carolina 2026 Withholding Tax (Rev. 11/4/25), read from the
// form itself on 2026-10-29: the year's wages less $5,000 for each SC W-4
// allowance and, once at least one is claimed, a standard deduction of 10%
// of wages up to $7,500; 0% to $3,640, 3% to $18,230 and 6% above. Act 110
// (2026) cut the income tax rates for 2026, but SCDOR hasn't published new
// withholding tables yet; this pack follows the published ones. Released
// 2026-10-29 after Greg's review (docs/rule-pack-review.md).
export const usSouthCarolina2026: StateRulePack = {
  kind: "state",
  id: "us-sc",
  version: "2026.1",
  name: "South Carolina",
  place: { country: "US", region: "SC" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "SCDOR WH-1603F, Formula for Computing South Carolina 2026 Withholding Tax (Rev. 11/4/25)", covers: "$5,000 per allowance; standard deduction of 10% of wages up to $7,500 with one or more allowances, none with zero; 0% to $3,640, 3% to $18,230, 6% above; the $750 weekly example ($10.58)", basis: "published" },
    { ref: "SCDOR withholding page and Information Letter #26-20 (Act 110)", covers: "deposits with the same frequency as federal payments; quarterly WH-1605 and WH-1606 due the last day of the month after the quarter; Act 110 rate changes with withholding tables still to be adjusted", basis: "published" },
    { ref: "SC DEW glossary and 2026 rate announcement", covers: "$14,000 wage base; 1.0% new-employer rate", basis: "published" },
    { ref: "SC Code 41-10 (no state minimum wage); SC Code 63-17-2310 (new hire reporting)", covers: "federal $7.25 minimum wage; no state paid sick leave law; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Act 110 (signed March 30, 2026) lowered the 2026 income tax rates to 1.99% and 5.21%. SCDOR says it will adjust the withholding tables but hasn't published new ones; until it does, employers use the WH-1603F above, which this pack follows. The daily rule watch looks for the new tables.",
    "SC W-4 allowances are $5,000 each. The 10% standard deduction (up to $7,500) applies only when at least one allowance is claimed. No SC W-4 on file: no allowances, so no deduction.",
    "Deposits: South Carolina withholding is due with the same frequency as your federal deposits (monthly by the 15th, or the semi-weekly dates). The quarterly WH-1605 (WH-1606 for the fourth quarter) is due the last day of the month after the quarter.",
    "UI rates are per employer: enter yours from the DEW rate notice. New employers pay 1.0%.",
    "Sales tax: TrailBook doesn't work out South Carolina sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "SC W-4",
      statuses: [{ id: "single", label: "Any", standardDeduction: "0", table: "all" }],
      noCertificateStatus: "single",
      allowances: [{ label: "SC W-4 allowances", amount: "5000" }],
      percentDeduction: { rate: "0.10", max: "7500" },
      tables: { all: [{ over: "0", rate: "0" }, { over: "3640", rate: "0.03" }, { over: "18230", rate: "0.06" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "SCDOR", code: "SC_WH", label: "South Carolina income tax", account: "sc_wh_payable" },
    taxes: [
      {
        code: "SC_UI", label: "South Carolina UI", agency: "DEW", paidBy: "employer", rate: "0.01", wageBase: "14000", account: "sc_ui_payable",
        assignedRate: { label: "Your South Carolina UI rate (%)", hint: "The rate on your DEW tax rate notice. New employers pay 1.0%." },
      },
    ],
    deposits: [
      { kind: "sc_wh", codes: ["SC_WH"], agency: "SCDOR", what: "South Carolina withholding", where: "MyDORWAY", schedule: "federal_timing_by_average", federalTimingAverageOver: null, report: "WH-1605/WH-1606" },
      { kind: "sc_ui", codes: ["SC_UI"], agency: "DEW", what: "South Carolina UI", where: "SC DEW State UI Tax System", schedule: "quarterly", report: "UCE-120" },
    ],
    employerAccount: { label: "SC DEW employer account number", hint: "The number on your DEW notices. It goes on the UCE-120. Withholding uses your SCDOR withholding number.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "South Carolina income tax payable", systemKey: "sc_wh_payable" },
      { code: "2350", name: "South Carolina UI payable", systemKey: "sc_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "WH-1605", slug: "wh1605", title: "SC Withholding Quarterly Tax Return (WH-1605, WH-1606 for the fourth quarter)", kind: "withholding_return", codes: ["SC_WH"], fileAt: "File through MyDORWAY" },
      { form: "UCE-120", slug: "uce120", title: "Employer Quarterly Contribution and Wage Report (UCE-120)", kind: "ui_wage_report", codes: ["SC_UI"], fileAt: "File and pay through the SC DEW State UI Tax System" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "South Carolina New Hire Reporting Program",
  },
  business: { salesTax: null },
};
