import type { StateRulePack } from "./types.js";

/** Booklet A's annual table as rate × wages less a fixed amount, so the table's rounded base amounts come out exactly. */
function table(rows: [over: number, base: number, rate: number][]) {
  return rows.map(([over, base, rate]) => ({ over: String(over), rate: String(rate), subtract: (rate * over - base).toFixed(2) }));
}

// Hawaii 2026. Withholding follows the Department of Taxation's Booklet A,
// Employer's Tax Guide (Rev. 2025), Appendix Part 1, Annualized Income Tax
// Withholding (effective December 5, 2025 for withholding from January 1,
// 2026), read from it on 2026-10-29: the year's wages less $1,144 for each
// HW-4 allowance and the $4,350 lump sum allowance, through the annual table
// (1.4% rising to 7.9%), divided by the pay periods. TDI is shared with the
// employee, up to 0.5% of weekly wages and $7.50 a week. Released
// 2026-10-29 after Greg's review (docs/rule-pack-review.md).
export const usHawaii2026: StateRulePack = {
  kind: "state",
  id: "us-hi",
  version: "2026.1",
  name: "Hawaii",
  place: { country: "US", region: "HI" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Hawaii Department of Taxation, Booklet A Employer's Tax Guide (Rev. 2025), Appendix Part 1, Annualized Income Tax Withholding (effective December 5, 2025 for withholding January 1, 2026 and after)", covers: "$1,144 per HW-4 allowance; $4,350 extra lump sum allowance; annual tables single (including unmarried heads of household) 1.4% to $9,600, $134 + 3.2% to $14,400, $288 + 5.5% to $19,200, $552 + 6.4% to $24,000, $859 + 6.8% to $36,000, $1,675 + 7.2% to $48,000, $2,539 + 7.6% to $125,000, $8,391 + 7.9% above; married at twice the brackets ($269, $576, $1,104, $1,718, $3,350, $5,078, $16,782); the $500 weekly example ($9.58)", basis: "published" },
    { ref: "Same booklet, Sections 3 and 6", covers: "VP-1 quarterly by the 15th after the quarter up to $5,000 a year, monthly by the 15th to $40,000, semi-weekly above or when federal deposits are semi-weekly; no HW-4 means single with no allowances; the federal W-4 can't be used", basis: "published" },
    { ref: "Hawaii DLIR Disability Compensation Division, 2026 Maximum Weekly Wage Base", covers: "TDI: employee share up to half the premium, at most 0.5% of weekly wages up to $1,500.21 ($7.50 a week)", basis: "published" },
    { ref: "Hawaii DLIR UI 2026 contribution rates, as reported by Bloomberg Tax and the DLIR table quoted in search results", covers: "$64,500 wage base; 2.4% new-employer rate; Employment and Training assessment 0.01%", basis: "working-knowledge" },
    { ref: "HRS 387-2 (minimum wage $16.00 from January 1, 2026); no state paid sick leave law; new hire reporting within 20 days", covers: "$16.00 minimum wage", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "HW-4: single, married, or married but withholding at the higher single rate (also for unmarried heads of household), and the number of allowances, $1,144 each. Every employee also gets the $4,350 lump sum allowance. No HW-4 on file: single with no allowances, as the booklet says.",
    "The annual table's base amounts are rounded (for example $134 rather than $134.40), and TrailBook uses them exactly, so it matches the booklet's example ($9.58 a week).",
    "TDI: TrailBook takes 0.5% of wages from the employee, at most $7.50 a week, and pays it to your TDI carrier. ⚠️ check: if your plan's premium is less than 1% of wages, the employee's half is less too; enter your plan's rate if TrailBook should take less. Employers may also pay it all.",
    "⚠️ check: Hawaii's Prepaid Health Care Act (employee share up to 1.5% of wages) isn't included.",
    "Deposits: TrailBook shows Hawaii withholding monthly (VP-1), due the 15th of the next month, and on the federal semi-weekly dates for employers who withheld over $40,000 last year. Employers withholding $5,000 or less a year can pay quarterly, later than shown.",
    "UI rates are per employer: enter yours from the DLIR rate notice, including the 0.01% Employment and Training assessment. ⚠️ check: the $64,500 wage base and 2.4% new-employer rate are from Bloomberg Tax and the DLIR table as quoted in search results.",
    "Sales tax: TrailBook doesn't work out Hawaii general excise tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "HW-4",
      statuses: [
        { id: "single", label: "Single (or unmarried head of household)", standardDeduction: "4350", table: "single" },
        { id: "married", label: "Married", standardDeduction: "4350", table: "married" },
        { id: "married_single_rate", label: "Married, but withhold at the higher single rate", standardDeduction: "4350", table: "single" },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "HW-4 allowances", amount: "1144" }],
      tables: {
        single: table([[0, 0, 0.014], [9600, 134, 0.032], [14400, 288, 0.055], [19200, 552, 0.064], [24000, 859, 0.068], [36000, 1675, 0.072], [48000, 2539, 0.076], [125000, 8391, 0.079]]),
        married: table([[0, 0, 0.014], [19200, 269, 0.032], [28800, 576, 0.055], [38400, 1104, 0.064], [48000, 1718, 0.068], [72000, 3350, 0.072], [96000, 5078, 0.076], [250000, 16782, 0.079]]),
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Hawaii Department of Taxation", code: "HI_WH", label: "Hawaii income tax", account: "hi_wh_payable" },
    taxes: [
      { code: "HI_TDI", label: "Hawaii TDI", agency: "TDI carrier", paidBy: "employee", rate: "0.005", wageBase: null, perWeekCap: "7.50", paidToCarrier: true, account: "hi_tdi_payable" },
      {
        code: "HI_UI", label: "Hawaii UI", agency: "Hawaii DLIR", paidBy: "employer", rate: "0.0241", wageBase: "64500", account: "hi_ui_payable",
        assignedRate: { label: "Your Hawaii UI rate (%)", hint: "The total rate on your DLIR rate notice, including the 0.01% Employment and Training assessment. New employers pay 2.4% plus the assessment." },
      },
    ],
    deposits: [
      { kind: "hi_wh", codes: ["HI_WH"], agency: "Hawaii Department of Taxation", what: "Hawaii withholding", where: "Hawaii Tax Online", schedule: "monthly_or_larger", lookbackOver: "40000", largeFiler: "federal", dueDay: 15, report: "VP-1" },
      { kind: "hi_tdi", codes: ["HI_TDI"], agency: "TDI carrier", what: "Hawaii TDI premiums", where: "Your TDI insurance carrier", schedule: "quarterly", report: "carrier premium statement" },
      { kind: "hi_ui", codes: ["HI_UI"], agency: "Hawaii DLIR", what: "Hawaii UI", where: "Hawaii DLIR UI employer portal", schedule: "quarterly", report: "UC-B6" },
    ],
    employerAccount: { label: "Hawaii DLIR employer account number", hint: "The number on your DLIR notices. It goes on the UC-B6. Withholding uses your Hawaii Tax ID (WH-).", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Hawaii income tax payable", systemKey: "hi_wh_payable" },
      { code: "2350", name: "Hawaii UI payable", systemKey: "hi_ui_payable" },
      { code: "2360", name: "Hawaii TDI payable", systemKey: "hi_tdi_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "HW-14", slug: "hw14", title: "Withholding Tax Return (HW-14)", kind: "withholding_return", codes: ["HI_WH"], fileAt: "File through Hawaii Tax Online" },
      { form: "UC-B6", slug: "ucb6", title: "Quarterly Wage, Contribution and Employment and Training Assessment Report (UC-B6)", kind: "ui_wage_report", codes: ["HI_UI"], fileAt: "File and pay through the DLIR UI employer portal" },
    ],
    w2Box14: [{ code: "HI_TDI", label: "HITDI" }],
  },
  wageHour: {
    minimumWage: "16.00",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Hawaii New Hire Reporting Center",
  },
  business: { salesTax: null },
};
