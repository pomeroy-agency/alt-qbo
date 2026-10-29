import type { StateRulePack } from "./types.js";

// Missouri 2026. Withholding follows the 2026 Missouri Withholding Tax
// Formula in the Department of Revenue's Employer's Tax Guide (Form 4282),
// read from the guide itself on 2026-10-29: the year's wages less the MO W-4
// standard deduction ($16,100; $32,200 when the spouse doesn't work; $24,150
// head of household), through the 0% to 4.7% rates, divided by the pay
// periods and rounded to the whole dollar. Kansas City and St. Louis levy a
// 1% earnings tax on residents and on nonresidents who work there. Released 2026-10-29
// after Greg's review (docs/rule-pack-review.md).
export const usMissouri2026: StateRulePack = {
  kind: "state",
  id: "us-mo",
  version: "2026.1",
  name: "Missouri",
  place: { country: "US", region: "MO" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Missouri DOR, Employer's Tax Guide (Form 4282), 2026 Missouri Withholding Tax Formula", covers: "standard deductions $16,100 / $32,200 / $24,150; annual brackets 0% to $1,348, then 2% to 4.5% in $1,348 steps, 4.7% over $9,436; rounding to the whole dollar", basis: "published" },
    { ref: "Missouri DOR, Employer's Tax Guide (Form 4282), filing frequencies and 2026 due dates", covers: "monthly ($500 a month in two of the last 12 months) by the 15th, the quarter's last month with the MO-941 by the end of the next month; quarterly and annual filers; quarter-monthly at $9,000 a month", basis: "published" },
    { ref: "Missouri DOLIR 2026 rates, as reported by Bloomberg Tax", covers: "$9,000 wage base; 2.376% new-employer rate (1% nonprofits)", basis: "published" },
    { ref: "RSMo 290.502 as amended by Proposition A (2024) and HB 567 (2025); Kansas City Code ch. 68 and St. Louis City earnings tax, as summarised by payroll publishers", covers: "$15.00 minimum wage from January 1, 2026; Proposition A's paid sick leave repealed from August 28, 2025; 1% Kansas City and St. Louis earnings taxes, paid on the state's frequency (Kansas City) or quarterly (St. Louis W-10)", basis: "published" },
    { ref: "RSMo 285.304 (new hire reporting)", covers: "report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "MO W-4 status: single, married with a working spouse and married filing separately share the $16,100 deduction; tick the box for a spouse who doesn't work ($32,200); head of household is $24,150. No MO W-4 on file: single. Missouri asks for each paycheck's withholding rounded to the whole dollar.",
    "Deposits: TrailBook shows Missouri withholding monthly by the 15th of the next month, which is what monthly filers owe for the first two months of each quarter (the third month can wait for the MO-941, so the date shown is earlier than needed). Quarter-monthly filers ($9,000 a month in two of the last 12 months) owe more often than shown; TrailBook doesn't work those out.",
    "Kansas City and St. Louis earnings taxes: tick the one that applies when the employee lives in the city or works there. Both are 1% of wages. Kansas City's is paid on the same schedule as Missouri withholding (RD-130M) with a quarterly RD-110; St. Louis's on the quarterly W-10. Work done outside the city by a nonresident isn't taxed; TrailBook doesn't split wages by where the work was done.",
    "UI rates are per employer: enter yours from the DOLIR rate notice. New employers pay 2.376% (nonprofits 1%).",
    "Missouri's Proposition A paid sick leave was repealed from August 28, 2025, so there's no state paid sick leave.",
    "Sales tax: TrailBook doesn't work out Missouri sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "MO W-4",
      statuses: [
        { id: "single", label: "Single, married with a working spouse, or married filing separately", standardDeduction: "16100", table: "all" },
        { id: "married_one_income", label: "Married, spouse doesn't work", standardDeduction: "32200", table: "all" },
        { id: "head_of_household", label: "Head of household", standardDeduction: "24150", table: "all" },
      ],
      noCertificateStatus: "single",
      allowances: [],
      tables: {
        all: [
          { over: "0", rate: "0" }, { over: "1348", rate: "0.02" }, { over: "2696", rate: "0.025" }, { over: "4044", rate: "0.03" },
          { over: "5392", rate: "0.035" }, { over: "6740", rate: "0.04" }, { over: "8088", rate: "0.045" }, { over: "9436", rate: "0.047" },
        ],
      },
      round: "dollar",
    },
    incomeTaxAgency: { agency: "Missouri DOR", code: "MO_WH", label: "Missouri income tax", account: "mo_wh_payable" },
    localIncomeTaxes: [
      {
        id: "kc", name: "Kansas City earnings tax", label: "Lives or works in Kansas City (1% earnings tax)", code: "KC_EARN", agency: "Kansas City Revenue",
        account: "mo_local_payable", w2Locality: "KANSAS CITY",
        rules: { method: "flat_rate", rate: "0.01" },
      },
      {
        id: "stl", name: "St. Louis earnings tax", label: "Lives or works in the City of St. Louis (1% earnings tax)", code: "STL_EARN", agency: "St. Louis Collector of Revenue",
        account: "mo_local_payable", w2Locality: "ST LOUIS",
        rules: { method: "flat_rate", rate: "0.01" },
      },
    ],
    taxes: [
      {
        code: "MO_UI", label: "Missouri UI", agency: "DOLIR", paidBy: "employer", rate: "0.02376", wageBase: "9000", account: "mo_ui_payable",
        assignedRate: { label: "Your Missouri UI rate (%)", hint: "The rate on your DOLIR rate notice. New employers pay 2.376% (nonprofits 1%)." },
      },
    ],
    deposits: [
      {
        kind: "mo_wh", codes: ["MO_WH"], agency: "Missouri DOR", what: "Missouri withholding", where: "MyTax Missouri",
        schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 15, report: "MO-941",
      },
      {
        kind: "kc_earn", codes: ["KC_EARN"], agency: "Kansas City Revenue", what: "Kansas City earnings tax", where: "Kansas City's online tax portal",
        schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 15, report: "RD-130M",
      },
      { kind: "stl_earn", codes: ["STL_EARN"], agency: "St. Louis Collector of Revenue", what: "St. Louis earnings tax", where: "The Collector of Revenue's online filing", schedule: "quarterly", report: "W-10" },
      { kind: "mo_ui", codes: ["MO_UI"], agency: "DOLIR", what: "Missouri UI", where: "Missouri UI Tax System (UInteract)", schedule: "quarterly", report: "MODES-4-7" },
    ],
    employerAccount: { label: "Missouri UI employer account number", hint: "The number on your DOLIR notices. It goes on the MODES-4-7. Withholding uses your Missouri tax ID.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Missouri income tax payable", systemKey: "mo_wh_payable" },
      { code: "2350", name: "Missouri UI payable", systemKey: "mo_ui_payable" },
      { code: "2360", name: "Kansas City and St. Louis earnings tax payable", systemKey: "mo_local_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "MODES-4-7", slug: "modes47", title: "Quarterly Contribution and Wage Report (MODES-4-7)", kind: "ui_wage_report", codes: ["MO_UI"], fileAt: "File and pay through UInteract" },
      { form: "RD-110", slug: "kc-rd110", title: "Kansas City Employer's Quarterly Return of Earnings Tax Withheld (RD-110)", kind: "withholding_return", codes: ["KC_EARN"], fileAt: "File with Kansas City Revenue" },
      { form: "W-10", slug: "stl-w10", title: "St. Louis Employer's Return of Earnings Tax Withheld (W-10)", kind: "withholding_return", codes: ["STL_EARN"], fileAt: "File with the St. Louis Collector of Revenue" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "15.00",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Missouri New Hire Reporting Program",
  },
  business: { salesTax: null },
};
