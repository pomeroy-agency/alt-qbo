import type { StateRulePack } from "./types.js";

// Vermont 2026. Withholding follows the Department of Taxes' GB-1210, 2026
// Income Tax Withholding Instructions, Tables, and Charts, as quoted in
// search results and the USDA National Finance Center on 2026-10-29
// (tax.vermont.gov isn't reachable from here): the year's wages less $5,400
// for each W-4VT allowance, then nothing up to $3,925 single or $11,775
// married, 3.35%, 6.6%, 7.6% and 8.75%. The Child Care Contribution is
// shared between employer and employee. Every figure is marked for checking.
// Drafted 2026-10-29 for Greg's review (docs/rule-pack-review.md).
export const usVermont2026: StateRulePack = {
  kind: "state",
  id: "us-vt",
  version: "2026.1",
  name: "Vermont",
  place: { country: "US", region: "VT" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Vermont Department of Taxes, GB-1210 (2026) percentage method tables, as quoted in search results and the USDA NFC bulletin (not read directly)", covers: "$5,400 per allowance ($103.85 weekly), no standard deduction; single: 3.35% from $3,925, 6.6% from $54,675, 7.6% from $126,775, 8.75% from $260,225; married: $11,775, $96,475, $216,525, $323,825; no W-4VT means single with no allowances", basis: "working-knowledge" },
    { ref: "Vermont Child Care Contribution (Act 76 of 2023), payroll publishers", covers: "0.44% of wages from July 1, 2025; employers may withhold up to 0.11% from employees", basis: "working-knowledge" },
    { ref: "Payroll publishers on Vermont DOL 2026 UI", covers: "$15,400 wage base; 1.0% new-employer rate", basis: "working-knowledge" },
    { ref: "21 V.S.A. 384 (minimum wage $14.42 for 2026); 21 V.S.A. 481 to 487 (earned sick time); new hire reporting within 10 days", covers: "$14.42 minimum wage; 1 hour of earned sick time per 52 worked, up to 40 hours a year", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "⚠️ check: every figure comes from search results quoting the GB-1210 and from payroll publishers; tax.vermont.gov and labor.vermont.gov aren't reachable from here.",
    "W-4VT: single (also married filing separately) or married, and allowances worth $5,400 each. No W-4VT on file: single with no allowances.",
    "Child Care Contribution: 0.33% employer and 0.11% employee by default (0.44% in all, up to a quarter of it from the employee). Enter your shares in payroll settings; an employer that pays it all enters 0% for the employee share. Paid with the WHT-436 withholding return.",
    "Deposits: TrailBook shows Vermont withholding monthly, due the 25th of the next month, and on the federal deposit dates for employers who withheld more than $9,000 last year. ⚠️ check: Vermont's thresholds; employers withholding under $2,500 a year can pay quarterly.",
    "UI rates are per employer: enter yours from the Vermont DOL rate notice. New employers pay 1.0%.",
    "Sales tax: TrailBook doesn't work out Vermont sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "W-4VT",
      statuses: [
        { id: "single", label: "Single or married filing separately", standardDeduction: "0", table: "single" },
        { id: "married", label: "Married", standardDeduction: "0", table: "married" },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "W-4VT allowances", amount: "5400" }],
      tables: {
        single: [{ over: "0", rate: "0" }, { over: "3925", rate: "0.0335" }, { over: "54675", rate: "0.066" }, { over: "126775", rate: "0.076" }, { over: "260225", rate: "0.0875" }],
        married: [{ over: "0", rate: "0" }, { over: "11775", rate: "0.0335" }, { over: "96475", rate: "0.066" }, { over: "216525", rate: "0.076" }, { over: "323825", rate: "0.0875" }],
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Vermont Department of Taxes", code: "VT_WH", label: "Vermont income tax", account: "vt_wh_payable" },
    taxes: [
      {
        code: "VT_CCC_EE", label: "Vermont Child Care Contribution (employee)", agency: "Vermont Department of Taxes", paidBy: "employee", rate: "0.0011", wageBase: null, account: "vt_ccc_payable",
        assignedRate: { label: "Child Care Contribution employee share (%)", hint: "Up to 0.11%, or 0% if you pay it all." },
      },
      {
        code: "VT_CCC_ER", label: "Vermont Child Care Contribution (employer)", agency: "Vermont Department of Taxes", paidBy: "employer", rate: "0.0033", wageBase: null, account: "vt_ccc_payable",
        assignedRate: { label: "Child Care Contribution employer share (%)", hint: "The rest of the 0.44%: 0.33% if employees pay 0.11%, 0.44% if you pay it all." },
      },
      {
        code: "VT_UI", label: "Vermont UI", agency: "Vermont DOL", paidBy: "employer", rate: "0.01", wageBase: "15400", account: "vt_ui_payable",
        assignedRate: { label: "Your Vermont UI rate (%)", hint: "The rate on your Vermont DOL rate notice. New employers pay 1.0%." },
      },
    ],
    deposits: [
      { kind: "vt_wh", codes: ["VT_WH", "VT_CCC_EE", "VT_CCC_ER"], agency: "Vermont Department of Taxes", what: "Vermont withholding and Child Care Contribution", where: "myVTax", schedule: "monthly_or_larger", lookbackOver: "9000", largeFiler: "federal", dueDay: 25, report: "WHT-436" },
      { kind: "vt_ui", codes: ["VT_UI"], agency: "Vermont DOL", what: "Vermont UI", where: "Vermont DOL employer portal", schedule: "quarterly", report: "C-101" },
    ],
    employerAccount: { label: "Vermont DOL employer account number", hint: "The number on your Vermont DOL notices. It goes on the C-101. Withholding uses your myVTax account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Vermont income tax payable", systemKey: "vt_wh_payable" },
      { code: "2350", name: "Vermont UI payable", systemKey: "vt_ui_payable" },
      { code: "2360", name: "Vermont Child Care Contribution payable", systemKey: "vt_ccc_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "WHT-436", slug: "wht436", title: "Quarterly Withholding Reconciliation (WHT-436)", kind: "withholding_return", codes: ["VT_WH", "VT_CCC_EE", "VT_CCC_ER"], fileAt: "File through myVTax" },
      { form: "C-101", slug: "c101", title: "Employer's Quarterly Wage and Contribution Report (C-101)", kind: "ui_wage_report", codes: ["VT_UI"], fileAt: "File and pay through the Vermont DOL employer portal" },
    ],
    w2Box14: [{ code: "VT_CCC_EE", label: "VTCCC" }],
  },
  wageHour: {
    minimumWage: "14.42",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: { law: "Earned sick time (21 V.S.A. 481 to 487)", hoursWorkedPerHourAccrued: "52", annualUseCapHours: "40", accrualCapHours: null },
    newHireReportDays: 10, newHireReportTo: "Vermont New Hire Reporting",
  },
  business: { salesTax: null },
};
