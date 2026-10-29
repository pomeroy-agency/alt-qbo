import type { StateRulePack } from "./types.js";

// Indiana 2026. Withholding follows the Department of Revenue's Departmental
// Notice #1 (R47 / 10-26), read from the notice itself on 2026-10-29: 2.95%
// of wages less $1,000 for each WH-4 personal exemption, $1,500 for each
// dependent and first-time dependent exemption and $3,000 for each adopted
// child, spread over the pay periods. County income tax is withheld on the
// same base at the rate of the county the employee lived in on January 1
// (or worked in, for someone living out of state), entered for each
// employee from the notice's county table. Draft until Greg reviews it
// (docs/rule-pack-review.md).
export const usIndiana2026: StateRulePack = {
  kind: "state",
  id: "us-in",
  version: "2026.1",
  name: "Indiana",
  place: { country: "US", region: "IN" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Indiana Department of Revenue, Departmental Notice #1 (R47 / 10-26, effective October 1, 2026)", covers: "2.95% state rate for 2026; $1,000 per personal exemption (WH-4 line 5), $1,500 per dependent and first-time dependent exemption (lines 6 and 7), $3,000 per adopted child (line 8); county tax on the same base at the January 1 county of residence (or of principal work for nonresidents); the 92 county rates; the $800 weekly example", basis: "published" },
    { ref: "Indiana Department of Revenue filing calendar, as summarised by Thomson Reuters and payroll publishers", covers: "WH-1 monthly, due the 20th of the next month for early filers (over $1,000 a month on average last year), the 30th for others", basis: "published" },
    { ref: "Indiana DWD 2026 rates, as summarised by payroll publishers", covers: "$9,500 wage base; 2.5% new-employer rate", basis: "published" },
    { ref: "IC 22-2-2 (minimum wage); IC 22-4-10-1.5 (new hire reporting)", covers: "$7.25 minimum wage; no state paid sick leave law; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "WH-4 line 5 is personal exemptions ($1,000 each, including 65 or older and blind); lines 6 and 7 together are dependent exemptions ($1,500 each); line 8 is adopted children ($3,000 each). No WH-4 on file: no exemptions.",
    "County tax: tick it and enter the rate from the county table in Departmental Notice #1 for the county the employee lived in on January 1 (or worked in, if they lived outside Indiana), and the county's name. It's withheld on the same base as the state tax and paid with the WH-1.",
    "Deposits: TrailBook shows the WH-1 due on the 20th of the next month, the early-filer date. Employers with $1,000 a month or less on average have until the 30th, so the dates shown are earlier than needed for them.",
    "UI rates are per employer: enter yours from the DWD rate notice. New employers pay 2.5%.",
    "Sales tax: TrailBook doesn't work out Indiana sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "WH-4",
      statuses: [{ id: "single", label: "Any", standardDeduction: "0", table: "all" }],
      noCertificateStatus: "single",
      allowances: [
        { label: "WH-4 personal exemptions (line 5)", amount: "1000" },
        { label: "WH-4 dependent exemptions (lines 6 and 7)", amount: "1500" },
        { label: "WH-4 adopted child exemptions (line 8)", amount: "3000" },
      ],
      tables: { all: [{ over: "0", rate: "0.0295" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Indiana Revenue", code: "IN_WH", label: "Indiana income tax", account: "in_wh_payable" },
    localIncomeTaxes: [
      {
        id: "in_county", name: "Indiana county income tax", label: "Indiana county income tax", code: "IN_COUNTY", agency: "Indiana Revenue",
        account: "in_wh_payable", w2Locality: "COUNTY",
        rules: {
          method: "employee_rate", base: "less_state_exemptions", maxRate: "0.035", rateLabel: "County tax rate (%)", placeLabel: "County",
          hint: "The county the employee lived in on January 1 (or worked in, if they lived outside Indiana), and its rate from Departmental Notice #1.",
        },
      },
    ],
    taxes: [
      {
        code: "IN_UI", label: "Indiana UI", agency: "DWD", paidBy: "employer", rate: "0.025", wageBase: "9500", account: "in_ui_payable",
        assignedRate: { label: "Your Indiana UI rate (%)", hint: "The rate on your DWD rate notice. New employers pay 2.5%." },
      },
    ],
    deposits: [
      {
        kind: "in_wh", codes: ["IN_WH", "IN_COUNTY"], agency: "Indiana Revenue", what: "Indiana state and county withholding", where: "INTIME",
        schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 20, report: "WH-1",
      },
      { kind: "in_ui", codes: ["IN_UI"], agency: "DWD", what: "Indiana UI", where: "Uplink Employer Self-Service", schedule: "quarterly", report: "UC-1/UC-5A" },
    ],
    employerAccount: { label: "Indiana DWD employer account number", hint: "The number on your DWD notices. It goes on the UC-1. Withholding uses your Indiana taxpayer ID.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Indiana income tax payable", systemKey: "in_wh_payable" },
      { code: "2350", name: "Indiana UI payable", systemKey: "in_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "UC-1/UC-5A", slug: "uc1", title: "Employer's Quarterly Contribution and Wage Report (UC-1/UC-5A)", kind: "ui_wage_report", codes: ["IN_UI"], fileAt: "File and pay through Uplink" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Indiana New Hire Reporting Center",
  },
  business: { salesTax: null },
};
