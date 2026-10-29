import type { StateRulePack } from "./types.js";

// West Virginia 2026. Withholding follows the Tax Division's IT-100.2A
// percentage method tables (March 2026, after SB 392's 5% rate cut back to
// January 1, 2026) as quoted in search results and the USDA National Finance
// Center on 2026-10-29 (tax.wv.gov isn't reachable from here): the year's
// wages less $2,000 for each IT-104 exemption, through the two-earner table
// unless the employee claims the one-earner table, 2.11% rising to 4.58%,
// rounded to the dollar. Every figure is marked for checking. Released
// 2026-10-29 after Greg's review (docs/rule-pack-review.md).
export const usWestVirginia2026: StateRulePack = {
  kind: "state",
  id: "us-wv",
  version: "2026.1",
  name: "West Virginia",
  place: { country: "US", region: "WV" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "WV Tax Division, IT-100.2A Tables for Percentage Method of Withholding (March 2026), as quoted in search results and the USDA NFC bulletin (not read directly)", covers: "$2,000 per exemption; one-earner: 2.11% to $10,000, 2.81% to $25,000, 3.16% to $40,000, 4.22% to $60,000, 4.58% above; two-earner: 2.11% to $7,500 ($158.25), then 2.81%, 3.16% and 4.22%, 4.58% above $45,000; the two-earner table unless IT-104 line 5 is checked; round to the dollar", basis: "working-knowledge" },
    { ref: "Payroll publishers on WorkForce West Virginia 2026 UI", covers: "$9,500 wage base; 2.7% new-employer rate", basis: "working-knowledge" },
    { ref: "W. Va. Code 21-5C-2 (minimum wage $8.75); no state paid sick leave law; new hire reporting within 14 days", covers: "$8.75 minimum wage", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "⚠️ check: every figure comes from search results quoting the IT-100.2A; tax.wv.gov and workforcewv.org aren't reachable from here. The two-earner table's middle brackets ($18,750 and $30,000) are worked out as three quarters of the one-earner ones, matching its known $7,500 and $45,000 edges; they weren't seen in a source.",
    "IT-104: exemptions ($2,000 each) and line 5 (one earner, a lower withholding table). No IT-104 on file: the two-earner table with no exemptions.",
    "Deposits: TrailBook shows West Virginia withholding monthly, due the 15th of the next month. ⚠️ check: smaller employers may file quarterly or yearly, and December's payment is due with the annual return.",
    "⚠️ check: city service fees (Charleston, Huntington and others charge a few dollars a week) aren't included yet.",
    "UI rates are per employer: enter yours from the WorkForce West Virginia rate notice. New employers pay 2.7%.",
    "Sales tax: TrailBook doesn't work out West Virginia sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "WV/IT-104",
      statuses: [
        { id: "two_earner", label: "Two earners or two jobs (standard)", standardDeduction: "0", table: "two_earner" },
        { id: "one_earner", label: "One earner (IT-104 line 5)", standardDeduction: "0", table: "one_earner" },
      ],
      noCertificateStatus: "two_earner",
      allowances: [{ label: "IT-104 exemptions", amount: "2000" }],
      tables: {
        one_earner: [{ over: "0", rate: "0.0211" }, { over: "10000", rate: "0.0281" }, { over: "25000", rate: "0.0316" }, { over: "40000", rate: "0.0422" }, { over: "60000", rate: "0.0458" }],
        two_earner: [{ over: "0", rate: "0.0211" }, { over: "7500", rate: "0.0281" }, { over: "18750", rate: "0.0316" }, { over: "30000", rate: "0.0422" }, { over: "45000", rate: "0.0458" }],
      },
      round: "dollar",
    },
    incomeTaxAgency: { agency: "WV Tax Division", code: "WV_WH", label: "West Virginia income tax", account: "wv_wh_payable" },
    taxes: [
      {
        code: "WV_UI", label: "West Virginia UI", agency: "WorkForce West Virginia", paidBy: "employer", rate: "0.027", wageBase: "9500", account: "wv_ui_payable",
        assignedRate: { label: "Your West Virginia UI rate (%)", hint: "The rate on your WorkForce West Virginia rate notice. New employers pay 2.7%." },
      },
    ],
    deposits: [
      { kind: "wv_wh", codes: ["WV_WH"], agency: "WV Tax Division", what: "West Virginia withholding", where: "MyTaxes", schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 15, report: "IT-101V" },
      { kind: "wv_ui", codes: ["WV_UI"], agency: "WorkForce West Virginia", what: "West Virginia UI", where: "WorkForce West Virginia employer portal", schedule: "quarterly", report: "WVUC-A-154" },
    ],
    employerAccount: { label: "WorkForce West Virginia employer account number", hint: "The number on your WorkForce West Virginia notices. It goes on the quarterly wage report. Withholding uses your Tax Division account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "West Virginia income tax payable", systemKey: "wv_wh_payable" },
      { code: "2350", name: "West Virginia UI payable", systemKey: "wv_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "WVUC-A-154", slug: "wvuc154", title: "Employer's Quarterly Contribution and Wage Report (WVUC-A-154)", kind: "ui_wage_report", codes: ["WV_UI"], fileAt: "File and pay through the WorkForce West Virginia employer portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "8.75",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 14, newHireReportTo: "West Virginia New Hire Reporting Center",
  },
  business: { salesTax: null },
};
