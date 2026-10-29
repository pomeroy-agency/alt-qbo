import type { StateRulePack } from "./types.js";

// Rhode Island 2026. Withholding follows the Division of Taxation's 2026
// Employer's Income Tax Withholding Tables percentage method as quoted by
// search results and the USDA National Finance Center on 2026-10-29
// (tax.ri.gov isn't reachable from here): the year's wages less $1,000 for
// each RI W-4 exemption (none once wages pass $290,800), 3.75% to $82,050,
// 4.75% to $186,450 and 5.99% above, one table for every status. TDI comes
// from the employee. Every figure is marked for checking. Released 2026-10-29
// after Greg's review (docs/rule-pack-review.md).
export const usRhodeIsland2026: StateRulePack = {
  kind: "state",
  id: "us-ri",
  version: "2026.1",
  name: "Rhode Island",
  place: { country: "US", region: "RI" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "RI Division of Taxation, 2026 Employer's Income Tax Withholding Tables (percentage method, pages 9 and 10), as quoted in search results and the USDA NFC bulletin (not read directly)", covers: "$1,000 per exemption, none when annual wages are over $290,800; 3.75% to $82,050, 4.75% to $186,450, 5.99% above; one table for all statuses", basis: "working-knowledge" },
    { ref: "RI Department of Labor and Training, TDI / TCI for Employers, as quoted in search results", covers: "2026 TDI 1.1% employee deduction on the first $100,000", basis: "working-knowledge" },
    { ref: "Payroll publishers on RI DLT 2026 UI", covers: "$30,800 wage base ($32,300 for the highest rate group); 1.21% new-employer rate including the 0.21% Job Development Assessment", basis: "working-knowledge" },
    { ref: "R.I. Gen. Laws 28-12-3 (minimum wage $16.00 from January 1, 2026); Healthy and Safe Families and Workplaces Act (R.I. Gen. Laws 28-57); new hire reporting within 14 days", covers: "$16.00 minimum wage; 1 hour of sick leave per 35 worked, up to 40 hours a year, paid for employers with 18 or more employees", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "⚠️ check: every figure comes from search results quoting the Division of Taxation and DLT; tax.ri.gov and dlt.ri.gov aren't reachable from here.",
    "RI W-4: the number of exemptions, $1,000 each, and none once the year's wages are over $290,800. Filing status doesn't change the table. ⚠️ check: with no RI W-4 on file TrailBook uses no exemptions.",
    "TDI: 1.1% of each employee's wages up to $100,000, all from the employee, paid with the quarterly TX-17.",
    "Deposits: TrailBook shows Rhode Island withholding monthly, due the 20th of the next month, and weekly for employers who withheld $50,000 or more last year. ⚠️ check: Rhode Island's quarterly-monthly and daily schedules and thresholds.",
    "UI rates are per employer: enter yours from the DLT rate notice, including the Job Development Assessment. New employers pay 1.21%.",
    "Sick leave: employers with fewer than 18 employees must give the time but needn't pay it; TrailBook tracks paid hours only for larger employers.",
    "Sales tax: TrailBook doesn't work out Rhode Island sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "RI W-4",
      statuses: [{ id: "all", label: "RI W-4 on file", standardDeduction: "0", table: "all" }],
      noCertificateStatus: "all",
      allowances: [{ label: "RI W-4 exemptions", amount: "1000", byWages: [{ over: "0", amount: "1000" }, { over: "290800", amount: "0" }] }],
      tables: { all: [{ over: "0", rate: "0.0375" }, { over: "82050", rate: "0.0475" }, { over: "186450", rate: "0.0599" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "RI Division of Taxation", code: "RI_WH", label: "Rhode Island income tax", account: "ri_wh_payable" },
    taxes: [
      { code: "RI_TDI", label: "Rhode Island TDI", agency: "RI DLT", paidBy: "employee", rate: "0.011", wageBase: "100000", account: "ri_tdi_payable" },
      {
        code: "RI_UI", label: "Rhode Island UI", agency: "RI DLT", paidBy: "employer", rate: "0.0121", wageBase: "30800", account: "ri_ui_payable",
        assignedRate: { label: "Your Rhode Island UI rate (%)", hint: "The total rate on your DLT rate notice, including the Job Development Assessment. New employers pay 1.21%." },
      },
    ],
    deposits: [
      { kind: "ri_wh", codes: ["RI_WH"], agency: "RI Division of Taxation", what: "Rhode Island withholding", where: "Division of Taxation portal", schedule: "monthly_or_larger", lookbackOver: "50000", largeFiler: "weekly", dueDay: 20, report: "RI-941" },
      { kind: "ri_ui", codes: ["RI_TDI", "RI_UI"], agency: "RI DLT", what: "Rhode Island UI and TDI", where: "Division of Taxation employer tax portal", schedule: "quarterly", report: "TX-17" },
    ],
    employerAccount: { label: "Rhode Island employer account number", hint: "The number on your UI and TDI notices. It goes on the TX-17.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Rhode Island income tax payable", systemKey: "ri_wh_payable" },
      { code: "2350", name: "Rhode Island UI payable", systemKey: "ri_ui_payable" },
      { code: "2360", name: "Rhode Island TDI payable", systemKey: "ri_tdi_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "TX-17", slug: "tx17", title: "Employer's Quarterly Tax and Wage Report (TX-17)", kind: "ui_wage_report", codes: ["RI_UI", "RI_TDI"], fileAt: "File and pay through the Division of Taxation employer tax portal" },
    ],
    w2Box14: [{ code: "RI_TDI", label: "RITDI" }],
  },
  wageHour: {
    minimumWage: "16.00",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: {
      law: "Healthy and Safe Families and Workplaces Act (R.I. Gen. Laws 28-57)", hoursWorkedPerHourAccrued: "35", annualUseCapHours: "40", accrualCapHours: "40",
      smallEmployer: { under: 18, annualUseCapHours: "0", accrualCapHours: "0" },
    },
    newHireReportDays: 14, newHireReportTo: "Rhode Island New Hire Reporting Directory",
  },
  business: { salesTax: null },
};
