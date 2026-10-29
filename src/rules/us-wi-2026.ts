import type { StateRulePack } from "./types.js";

// Wisconsin 2026. Withholding follows the alternate method in the Department
// of Revenue's Publication W-166 (laws as of January 15, 2026), read from the
// guide itself on 2026-10-29: the year's wages less a sliding deduction
// ($6,702 single, less 12% of wages over $17,780; $9,461 married, less 20%
// over $25,727) and $400 for each WT-4 exemption, through the 3.54% to 7.65%
// rates, divided by the pay periods. Released 2026-10-29 after Greg's
// review (docs/rule-pack-review.md).
export const usWisconsin2026: StateRulePack = {
  kind: "state",
  id: "us-wi",
  version: "2026.1",
  name: "Wisconsin",
  place: { country: "US", region: "WI" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Wisconsin DOR Publication W-166, Withholding Tax Guide, alternate method (laws as of January 15, 2026)", covers: "deduction $6,702 single (less 12% over $17,780, none from $73,630) and $9,461 married (less 20% over $25,727, none from $73,032); $400 per exemption; 3.54% to $12,760, 4.65% to $25,520, 5.30% to $280,950, 7.65% above; the three worked examples", basis: "published" },
    { ref: "Wisconsin DOR Publication W-166, filing frequency and due dates", covers: "frequency assigned by the department; monthly and quarterly WT-6 due the last day of the next month; semi-monthly due the last day of the month (1st to 15th) and the 15th of the next (16th to month end)", basis: "published" },
    { ref: "Wisconsin DWD UI financing summary and 2026 rates, as summarised by payroll publishers", covers: "$14,000 wage base; 3.05% new-employer rate (2.50% construction is per payroll size)", basis: "published" },
    { ref: "Wis. Stat. 104 (minimum wage); Publication W-166 (new hire reporting)", covers: "$7.25 minimum wage; no state paid sick leave law; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "WT-4 status: single, married, or married but withholding at the higher single rate. No WT-4 on file: single with no exemptions.",
    "Deposits: the department assigns each employer a frequency. TrailBook shows the WT-6 monthly, due the last day of the next month. Employers assigned semi-monthly owe the first half of each month by its last day and the second half by the 15th of the next month, earlier than shown; quarterly and annual filers can pay later.",
    "UI rates are per employer: enter yours from the DWD rate notice. Most new employers pay 3.05%.",
    "Sales tax: TrailBook doesn't work out Wisconsin sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "WT-4",
      statuses: [
        { id: "single", label: "Single", standardDeduction: "6702", table: "all", phaseOut: { from: "17780", rate: "0.12" } },
        { id: "married", label: "Married", standardDeduction: "9461", table: "all", phaseOut: { from: "25727", rate: "0.20" } },
        { id: "married_single_rate", label: "Married, but withhold at the higher single rate", standardDeduction: "6702", table: "all", phaseOut: { from: "17780", rate: "0.12" } },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "WT-4 exemptions", amount: "400" }],
      tables: { all: [{ over: "0", rate: "0.0354" }, { over: "12760", rate: "0.0465" }, { over: "25520", rate: "0.053" }, { over: "280950", rate: "0.0765" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Wisconsin DOR", code: "WI_WH", label: "Wisconsin income tax", account: "wi_wh_payable" },
    taxes: [
      {
        code: "WI_UI", label: "Wisconsin UI", agency: "DWD", paidBy: "employer", rate: "0.0305", wageBase: "14000", account: "wi_ui_payable",
        assignedRate: { label: "Your Wisconsin UI rate (%)", hint: "The rate on your DWD rate notice, including the solvency rate. Most new employers pay 3.05%." },
      },
    ],
    deposits: [
      {
        kind: "wi_wh", codes: ["WI_WH"], agency: "Wisconsin DOR", what: "Wisconsin withholding", where: "My Tax Account",
        schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: "last", report: "WT-6",
      },
      { kind: "wi_ui", codes: ["WI_UI"], agency: "DWD", what: "Wisconsin UI", where: "DWD UI Employer Portal", schedule: "quarterly", report: "UCT-101" },
    ],
    employerAccount: { label: "Wisconsin UI employer account number", hint: "The number on your DWD notices. It goes on the UCT-101. Withholding uses your 15-digit Wisconsin withholding number.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Wisconsin income tax payable", systemKey: "wi_wh_payable" },
      { code: "2350", name: "Wisconsin UI payable", systemKey: "wi_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "UCT-101", slug: "uct101", title: "Quarterly Contribution Report and wage report (UCT-101)", kind: "ui_wage_report", codes: ["WI_UI"], fileAt: "File and pay through the DWD UI Employer Portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Wisconsin New Hire Reporting Center",
  },
  business: { salesTax: null },
};
