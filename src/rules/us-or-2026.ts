import type { StateRulePack } from "./types.js";

// Oregon 2026. Withholding follows the Department of Revenue's computer
// formula (150-206-436, Rev. 12-31-25), read from the publication itself on
// 2026-10-29. Greg reviewed and released it on 2026-10-29 (docs/rule-pack-review.md).
const FED_CAP = "8750";

export const usOregon2026: StateRulePack = {
  kind: "state",
  id: "us-or",
  version: "2026.1",
  name: "Oregon",
  place: { country: "US", region: "OR" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Oregon DOR, Withholding Tax Formulas, 150-206-436 (Rev. 12-31-25), effective January 1, 2026", covers: "brackets, $2,910/$5,820 standard deductions, $263 exemption credit, $8,750 federal tax subtraction and its phase-out, allowance limits, 8% without a certificate, deposits on the federal schedule", basis: "published" },
    { ref: "Oregon Employment Department, 2026 tax rates (press release 2025-11-18)", covers: "$56,700 UI wage base; tax schedule 3; 2.4% new-employer rate", basis: "published" },
    { ref: "Oregon DOR, Statewide Transit Tax page (Measure 120 failed May 19, 2026)", covers: "0.1% employee statewide transit tax", basis: "published" },
    { ref: "Paid Leave Oregon, 2026 contribution rate", covers: "1% up to $184,500: employees 0.6%, employers with 25+ employees 0.4%", basis: "published" },
    { ref: "DCBS, Workers' Benefit Fund page", covers: "1.8 cents per hour worked in 2026, half from the employee", basis: "published" },
    { ref: "BOLI, 2026 minimum wage announcement (April 23, 2026)", covers: "$15.05 / $16.30 / $14.05 to June 30, 2026; $15.55 / $16.80 / $14.55 from July 1, 2026", basis: "published" },
    { ref: "ORS 653.601 to 653.661 (sick time)", covers: "1 hour per 30 worked, up to 40 hours a year; paid for employers with 10+ employees (6+ with a Portland location)", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Withholding uses the annual formula divided by the pay periods, exactly as the publication describes; amounts aren't rounded to whole dollars (allowed, not required).",
    "An employee with no OR-W-4 on file is withheld at a flat 8% (HB 2119), with a warning on the paycheck.",
    "Single with 3 or more allowances uses the married table and deduction but the single phase-out and $100,000 allowance limit, per the publication's FAQ 7.",
    "Oregon withholding and the statewide transit tax are deposited on your federal deposit dates; UI and the Workers' Benefit Fund are paid with the quarterly Form OQ.",
    "The Workers' Benefit Fund is charged on hours worked; salaried employees count as 40 hours a week.",
    "TriMet and Lane Transit District payroll taxes apply only to work inside those districts; enter your rate (TriMet 0.8237%, Lane 0.80% in 2026 per payroll publishers) in payroll settings if they apply.",
    "Paid Leave Oregon's employer share is only for employers with 25 or more employees; enter 0.4% in payroll settings if that's you.",
    "Minimum wage depends on where the employee works: Portland metro (inside the urban growth boundary), standard, or nonurban counties. Choose the area on each employee.",
    "Sick time: up to 40 hours may be used a year, and balances may be capped at 80 hours (ORS 653.606); TrailBook caps accrual at 80.",
    "Employers with fewer than 10 employees (6 in Portland) must give sick time but needn't pay it; TrailBook tracks it the same way.",
    "Sales tax: Oregon has none. Corporate Activity Tax isn't payroll and isn't calculated.",
  ],
  payroll: {
    incomeTax: {
      method: "or_formula", certificate: "OR-W-4", noCertificateRate: "0.08",
      standardDeduction: { single: "2910", married: "5820" },
      federalSubtraction: {
        single: [
          { wagesFrom: "0", cap: FED_CAP }, { wagesFrom: "125000", cap: "7000" }, { wagesFrom: "130000", cap: "5250" },
          { wagesFrom: "135000", cap: "3500" }, { wagesFrom: "140000", cap: "1750" }, { wagesFrom: "145000", cap: "0" },
        ],
        married: [
          { wagesFrom: "0", cap: FED_CAP }, { wagesFrom: "250000", cap: "7000" }, { wagesFrom: "260000", cap: "5250" },
          { wagesFrom: "270000", cap: "3500" }, { wagesFrom: "280000", cap: "1750" }, { wagesFrom: "290000", cap: "0" },
        ],
      },
      exemptionCredit: "263",
      allowancesZeroAbove: { single: "100000", married: "200000" },
      highWageFrom: "50000",
      brackets: {
        low: {
          single: [{ over: "0", base: "263", rate: "0.0475" }, { over: "4550", base: "479", rate: "0.0675" }, { over: "11400", base: "941", rate: "0.0875" }],
          married: [{ over: "0", base: "263", rate: "0.0475" }, { over: "9100", base: "695", rate: "0.0675" }, { over: "22800", base: "1620", rate: "0.0875" }],
        },
        high: {
          single: [{ over: "11400", base: "678", rate: "0.0875" }, { over: "125000", base: "10618", rate: "0.099" }],
          married: [{ over: "22800", base: "1357", rate: "0.0875" }, { over: "250000", base: "21237", rate: "0.099" }],
        },
      },
    },
    incomeTaxAgency: { agency: "DOR", code: "OR_WH", label: "Oregon income tax", account: "or_wh_payable" },
    taxes: [
      { code: "OR_STT", label: "Oregon statewide transit tax", agency: "DOR", paidBy: "employee", rate: "0.001", wageBase: null, account: "or_stt_payable" },
      { code: "OR_PFML_EE", label: "Paid Leave Oregon (employee)", agency: "OED", paidBy: "employee", rate: "0.006", wageBase: "184500", account: "or_pfml_payable" },
      { code: "OR_WBF_EE", label: "Workers' Benefit Fund (employee)", agency: "DCBS", paidBy: "employee", rate: "0", perHour: "0.009", wageBase: null, account: "or_wbf_payable" },
      {
        code: "OR_UI", label: "Oregon UI", agency: "OED", paidBy: "employer", rate: "0.024", wageBase: "56700", account: "or_ui_payable",
        assignedRate: { label: "Your Oregon UI rate (%)", hint: "It's on the rate notice the Employment Department sends each year. New employers pay 2.4%." },
      },
      { code: "OR_WBF_ER", label: "Workers' Benefit Fund (employer)", agency: "DCBS", paidBy: "employer", rate: "0", perHour: "0.009", wageBase: null, account: "or_wbf_payable" },
      {
        code: "OR_PFML_ER", label: "Paid Leave Oregon (employer)", agency: "OED", paidBy: "employer", rate: "0", wageBase: "184500", account: "or_pfml_payable",
        assignedRate: { label: "Your Paid Leave Oregon employer share (%)", hint: "Employers with 25 or more employees pay 0.4%; smaller employers pay nothing (leave this blank)." },
      },
      {
        code: "OR_TRANSIT", label: "TriMet or Lane transit tax", agency: "DOR", paidBy: "employer", rate: "0", wageBase: null, account: "or_transit_payable",
        assignedRate: { label: "TriMet or Lane Transit payroll tax rate (%)", hint: "Only for work inside the TriMet or Lane Transit district: 0.8237% or 0.80% in 2026. Leave blank otherwise." },
      },
    ],
    deposits: [
      { kind: "or_wh", codes: ["OR_WH", "OR_STT"], agency: "DOR", what: "Oregon withholding and statewide transit tax", where: "Revenue Online", schedule: "federal_timing_by_average", federalTimingAverageOver: null, report: "OQ" },
      { kind: "or_ui", codes: ["OR_UI", "OR_WBF_EE", "OR_WBF_ER"], agency: "OED", what: "UI and Workers' Benefit Fund", where: "Frances Online", schedule: "quarterly", report: "OQ" },
      { kind: "or_pfml", codes: ["OR_PFML_EE", "OR_PFML_ER"], agency: "OED", what: "Paid Leave Oregon contributions", where: "Frances Online", schedule: "quarterly", report: "Paid Leave Oregon report" },
      { kind: "or_transit", codes: ["OR_TRANSIT"], agency: "DOR", what: "TriMet / Lane transit payroll tax", where: "Revenue Online", schedule: "quarterly", report: "OTTR" },
    ],
    employerAccount: { label: "Oregon Business Identification Number (BIN)", hint: "The number on your Oregon payroll tax notices. It goes on Form OQ.", pattern: "^[0-9]{7,9}$" },
    accounts: [
      { code: "2340", name: "Oregon income tax payable", systemKey: "or_wh_payable" },
      { code: "2345", name: "Oregon statewide transit tax payable", systemKey: "or_stt_payable" },
      { code: "2350", name: "Oregon UI payable", systemKey: "or_ui_payable" },
      { code: "2355", name: "Workers' Benefit Fund payable", systemKey: "or_wbf_payable" },
      { code: "2360", name: "Paid Leave Oregon payable", systemKey: "or_pfml_payable" },
      { code: "2370", name: "Transit district payroll tax payable", systemKey: "or_transit_payable" },
    ],
  },
  forms: {
    quarterly: [
      {
        form: "OQ", slug: "oq", title: "Oregon Quarterly Tax Report (Form OQ)", kind: "combined_return",
        codes: ["OR_UI", "OR_WBF_EE", "OR_WBF_ER"], withholdingCodes: ["OR_WH", "OR_STT"], fileAt: "File through Frances Online",
      },
      { form: "Paid Leave Oregon report", slug: "or-paid-leave", title: "Paid Leave Oregon Quarterly Contribution Report", kind: "ui_wage_report", codes: ["OR_PFML_EE", "OR_PFML_ER"], fileAt: "File and pay through Frances Online" },
    ],
    w2Box14: [{ code: "OR_STT", label: "OR STT" }, { code: "OR_PFML_EE", label: "OR PFML" }],
  },
  wageHour: {
    minimumWage: "15.05", minimumWageChanges: [{ from: "2026-07-01", rate: "15.55" }],
    defaultAreaName: "Standard (most of Oregon)",
    areas: [
      { name: "Portland metro", minimumWage: "16.30", minimumWageChanges: [{ from: "2026-07-01", rate: "16.80" }] },
      { name: "Nonurban counties", minimumWage: "14.05", minimumWageChanges: [{ from: "2026-07-01", rate: "14.55" }] },
    ],
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: { law: "ORS 653.601 to 653.661", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "40", accrualCapHours: "80" },
    newHireReportDays: 20, newHireReportTo: "Oregon Department of Justice, Division of Child Support (New Hire Reporting)",
  },
  business: { salesTax: null },
};
