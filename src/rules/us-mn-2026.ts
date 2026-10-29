import type { StateRulePack } from "./types.js";

// Minnesota 2026. Withholding follows the computer formula in the Department
// of Revenue's 2026 Minnesota Income Tax Withholding booklet, read from the
// booklet itself on 2026-10-29: the year's wages less $5,300 for each W-4MN
// allowance, through the single or married schedule (5.35% to 9.85%),
// divided by the pay periods. Paid Leave premiums start in 2026: 0.88% of
// wages (0.66% for qualifying small employers), up to half of it from the
// employee. Released 2026-10-29 after Greg's
// review (docs/rule-pack-review.md).
export const usMinnesota2026: StateRulePack = {
  kind: "state",
  id: "us-mn",
  version: "2026.1",
  name: "Minnesota",
  place: { country: "US", region: "MN" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Minnesota Department of Revenue, 2026 Minnesota Income Tax Withholding instruction booklet, computer formula", covers: "$5,300 per allowance; single schedule from $4,700 (5.35%, 6.80% from $38,010, 7.85% from $114,130, 9.85% from $207,850); married from $14,700 (6.80% from $63,400, 7.85% from $208,180, 9.85% from $352,630)", basis: "published" },
    { ref: "Minnesota Department of Revenue, 2026 withholding booklet, deposit schedules", covers: "semiweekly or monthly (by the 15th) following the federal schedule when more than $1,500 was withheld in the previous quarter; otherwise quarterly with the return", basis: "published" },
    { ref: "Unemployment Insurance Minnesota (uimn.org), 2026 tax rate factors and new employer rates; Paid Leave small employer premium rate page", covers: "$44,000 wage base; 0.40% base tax; 14% additional assessment; new-employer rates by industry (1.00% to 4.06%); Paid Leave 0.88% (0.66% small employers)", basis: "published" },
    { ref: "Minnesota DEED Paid Leave premiums, as reported by PayrollOrg and EY", covers: "employees can be charged up to 50% of the premium (0.44%); the small employer share is 0.22%; premiums apply up to $185,000 of wages", basis: "published" },
    { ref: "Minnesota DLI minimum wage page; Minn. Stat. 181.9445 (earned sick and safe time); Minneapolis and St. Paul ordinances as reported", covers: "$11.41 minimum wage for 2026; 1 hour per 30 worked, up to 48 a year; $16.37 in Minneapolis and St. Paul", basis: "published" },
    { ref: "Minn. Stat. 256.998 (new hire reporting)", covers: "report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "W-4MN status: single, married, or married but withholding at the higher single rate. No W-4MN on file: single with no allowances.",
    "Deposits: TrailBook follows your federal deposit dates when the average quarter's Minnesota withholding last year was over $1,500 (Minnesota looks at the previous quarter), and otherwise shows it due with the quarterly return.",
    "UI rates are per employer: enter yours from the UI tax rate determination, with the 0.40% base tax and 14% additional assessment included. New employers get an industry rate; TrailBook's default is 1.08% plus the base tax and assessment (professional services, 1.69%). The 0.10% workforce enhancement fee is added separately.",
    "Paid Leave: TrailBook takes the employee's 0.44% from pay and adds the employer's share (0.44%, or 0.22% for small employers assigned the 0.66% rate). Employers that pay the whole premium themselves enter 0.88% as their share and the employee's is still taken; tell us if you need that switched off.",
    "Minneapolis and St. Paul have their own minimum wage ($16.37 in 2026); pick the area for employees working there. St. Paul's smaller employers may have a lower rate.",
    "Sales tax: TrailBook doesn't work out Minnesota sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "W-4MN",
      statuses: [
        { id: "single", label: "Single", standardDeduction: "0", table: "single" },
        { id: "married", label: "Married", standardDeduction: "0", table: "married" },
        { id: "married_single_rate", label: "Married, but withhold at the higher single rate", standardDeduction: "0", table: "single" },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "W-4MN allowances", amount: "5300" }],
      tables: {
        single: [{ over: "0", rate: "0" }, { over: "4700", rate: "0.0535" }, { over: "38010", rate: "0.068" }, { over: "114130", rate: "0.0785" }, { over: "207850", rate: "0.0985" }],
        married: [{ over: "0", rate: "0" }, { over: "14700", rate: "0.0535" }, { over: "63400", rate: "0.068" }, { over: "208180", rate: "0.0785" }, { over: "352630", rate: "0.0985" }],
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Minnesota Revenue", code: "MN_WH", label: "Minnesota income tax", account: "mn_wh_payable" },
    taxes: [
      { code: "MN_PFL_EE", label: "Minnesota Paid Leave (employee)", agency: "DEED", paidBy: "employee", rate: "0.0044", wageBase: "185000", account: "mn_pfl_payable" },
      {
        code: "MN_PFL_ER", label: "Minnesota Paid Leave (employer)", agency: "DEED", paidBy: "employer", rate: "0.0044", wageBase: "185000", account: "mn_pfl_payable",
        assignedRate: { label: "Your Paid Leave employer share (%)", hint: "0.44% normally; 0.22% if you were assigned the 0.66% small employer rate." },
      },
      {
        code: "MN_UI", label: "Minnesota UI", agency: "UI Minnesota", paidBy: "employer", rate: "0.0169", wageBase: "44000", account: "mn_ui_payable",
        assignedRate: { label: "Your Minnesota UI rate (%)", hint: "Your experience or new employer rate plus the 0.40% base tax, times 1.14 for the additional assessment, as on your rate determination." },
      },
      { code: "MN_WEF", label: "Minnesota workforce enhancement fee", agency: "UI Minnesota", paidBy: "employer", rate: "0.001", wageBase: "44000", account: "mn_ui_payable" },
    ],
    deposits: [
      { kind: "mn_wh", codes: ["MN_WH"], agency: "Minnesota Revenue", what: "Minnesota withholding", where: "Minnesota e-Services", schedule: "federal_timing_by_average", federalTimingAverageOver: "1500", report: "quarterly withholding return" },
      { kind: "mn_ui", codes: ["MN_UI", "MN_WEF"], agency: "UI Minnesota", what: "Minnesota UI", where: "UI Minnesota employer account", schedule: "quarterly", report: "Quarterly UI Wage Detail Report" },
      { kind: "mn_pfl", codes: ["MN_PFL_EE", "MN_PFL_ER"], agency: "DEED", what: "Minnesota Paid Leave premiums", where: "UI Minnesota employer account (Paid Leave)", schedule: "quarterly", report: "Paid Leave wage detail report" },
    ],
    employerAccount: { label: "Minnesota UI employer account number", hint: "The number on your UI Minnesota notices. It goes on the wage detail report. Withholding uses your Minnesota tax ID.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Minnesota income tax payable", systemKey: "mn_wh_payable" },
      { code: "2350", name: "Minnesota UI payable", systemKey: "mn_ui_payable" },
      { code: "2360", name: "Minnesota Paid Leave payable", systemKey: "mn_pfl_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "UI wage detail", slug: "mn-ui", title: "Quarterly UI Wage Detail Report", kind: "ui_wage_report", codes: ["MN_UI", "MN_WEF"], fileAt: "File and pay through your UI Minnesota employer account" },
      { form: "Paid Leave wage detail", slug: "mn-pfl", title: "Paid Leave quarterly wage detail and premiums", kind: "ui_wage_report", codes: ["MN_PFL_EE", "MN_PFL_ER"], fileAt: "File and pay through your UI Minnesota employer account" },
    ],
    w2Box14: [{ code: "MN_PFL_EE", label: "MN PFL" }],
  },
  wageHour: {
    minimumWage: "11.41",
    areas: [{ name: "Minneapolis", minimumWage: "16.37" }, { name: "St. Paul", minimumWage: "16.37" }],
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: { law: "Earned Sick and Safe Time (Minn. Stat. 181.9445)", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "48", accrualCapHours: "80" },
    newHireReportDays: 20, newHireReportTo: "Minnesota New Hire Reporting Center",
  },
  business: { salesTax: null },
};
