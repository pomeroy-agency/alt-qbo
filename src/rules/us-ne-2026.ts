import type { StateRulePack } from "./types.js";

/** Circular EN's annual table as rate × wages less a fixed amount, so the table's base amounts come out exactly. */
function table(rows: [over: number, base: number, rate: number][]) {
  return [{ over: "0", rate: "0", subtract: "0" }, ...rows.map(([over, base, rate]) => ({ over: String(over), rate: String(rate), subtract: (rate * over - base).toFixed(2) }))];
}

// Nebraska 2026. Withholding follows the Department of Revenue's 2026
// Nebraska Circular EN (Rev. 11-2025, for wages paid on or after January 1,
// 2026), read from it on 2026-10-29: the year's wages less $2,440 for each
// W-4N allowance, through Table 7 for the annual payroll period (nothing up
// to $3,430 single or $8,190 married, then 2.26% rising to 4.6%), divided by
// the pay periods. Drafted 2026-10-29 for Greg's review
// (docs/rule-pack-review.md).
export const usNebraska2026: StateRulePack = {
  kind: "state",
  id: "us-ne",
  version: "2026.1",
  name: "Nebraska",
  place: { country: "US", region: "NE" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Nebraska Department of Revenue, 2026 Nebraska Circular EN (8-429-1998 Rev. 11-2025), Percentage Method and Table 7 (annual payroll period)", covers: "$2,440 per W-4N allowance; single (including head of household) nothing to $3,430, 2.26% to $6,710, $74.13 + 3.22% to $21,810, $560.35 + 4.21% to $31,610, $972.93 + 4.35% to $40,130, $1,343.55 + 4.48% to $75,370, $2,922.30 + 4.6% above; married (including surviving spouse) $8,190, $13,010 ($108.93), $32,400 ($733.29), $50,400 ($1,491.09), $62,530 ($2,018.75), $82,920 ($2,932.22); withholding below 1.5% of wages must be raised to at least half of what a single employee with one allowance (married, two) would have withheld; no W-4N means single with no allowances", basis: "published" },
    { ref: "Same Circular, Filing and Deposit Requirements", covers: "monthly deposits (Form 501N or EFT) by the 15th once more than $500 is withheld in the first or second month of a quarter; Form 941N by the last day of the month after the quarter; annual filers by January 31; W-3N by January 31", basis: "published" },
    { ref: "Nebraska DOL 2026 UI (dol.nebraska.gov isn't reachable from here)", covers: "$9,000 wage base ($24,000 for employers at the highest rate); 1.25% new-employer rate", basis: "working-knowledge" },
    { ref: "Neb. Rev. Stat. 48-1203 (minimum wage $15.00 from January 1, 2026); Paid Sick Time Act (Initiative 436, effective October 1, 2025, as amended in 2025); new hire reporting within 20 days", covers: "$15.00 minimum wage; 1 hour of paid sick time per 30 worked, up to 40 hours a year for employers with 11 or more employees", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "W-4N: single (also head of household) or married, and the number of allowances, $2,440 each. No W-4N on file: single with no allowances, as the Circular says. Employees with a federal W-4 from before 2020 who never filed a W-4N keep their federal status and allowances; enter them here.",
    "The annual table's base amounts are used exactly, so TrailBook matches Table 7.",
    "⚠️ check: Nebraska's 1.5% minimum withholding rule isn't applied automatically. When TrailBook's amount is under 1.5% of wages (usually employees claiming many allowances), the Circular asks for at least half of what a single employee with one allowance (married, two) would have withheld; add the difference as extra withholding.",
    "Deposits: TrailBook shows Nebraska withholding monthly, due the 15th of the next month (Form 501N or EFT). Employers who withhold $500 or less in a month can wait for the quarterly Form 941N (the last day of the month after the quarter), so TrailBook may show a date earlier than needed.",
    "UI rates are per employer: enter yours from the Nebraska DOL rate notice. ⚠️ check: the $9,000 wage base and 1.25% new-employer rate; dol.nebraska.gov isn't reachable from here.",
    "⚠️ check: paid sick time applies to employers with 11 or more employees after the 2025 amendments; Lincoln's local minimum wage rules (from July 18, 2026) aren't included.",
    "Sales tax: TrailBook doesn't work out Nebraska sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "W-4N",
      statuses: [
        { id: "single", label: "Single (or head of household)", standardDeduction: "0", table: "single" },
        { id: "married", label: "Married (or surviving spouse)", standardDeduction: "0", table: "married" },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "W-4N allowances", amount: "2440" }],
      tables: {
        single: table([[3430, 0, 0.0226], [6710, 74.13, 0.0322], [21810, 560.35, 0.0421], [31610, 972.93, 0.0435], [40130, 1343.55, 0.0448], [75370, 2922.3, 0.046]]),
        married: table([[8190, 0, 0.0226], [13010, 108.93, 0.0322], [32400, 733.29, 0.0421], [50400, 1491.09, 0.0435], [62530, 2018.75, 0.0448], [82920, 2932.22, 0.046]]),
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Nebraska Department of Revenue", code: "NE_WH", label: "Nebraska income tax", account: "ne_wh_payable" },
    taxes: [
      {
        code: "NE_UI", label: "Nebraska UI", agency: "Nebraska DOL", paidBy: "employer", rate: "0.0125", wageBase: "9000", account: "ne_ui_payable",
        assignedRate: { label: "Your Nebraska UI rate (%)", hint: "The rate on your Nebraska DOL rate notice. New employers pay 1.25%." },
      },
    ],
    deposits: [
      { kind: "ne_wh", codes: ["NE_WH"], agency: "Nebraska Department of Revenue", what: "Nebraska withholding", where: "Nebraska e-pay (EFT)", schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 15, report: "501N / 941N" },
      { kind: "ne_ui", codes: ["NE_UI"], agency: "Nebraska DOL", what: "Nebraska UI", where: "NEworks", schedule: "quarterly", report: "UI-11T" },
    ],
    employerAccount: { label: "Nebraska DOL employer account number", hint: "The number on your Nebraska DOL notices. It goes on the quarterly wage report. Withholding uses your Department of Revenue ID.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Nebraska income tax payable", systemKey: "ne_wh_payable" },
      { code: "2350", name: "Nebraska UI payable", systemKey: "ne_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "941N", slug: "ne941n", title: "Nebraska Income Tax Withholding Return (941N)", kind: "withholding_return", codes: ["NE_WH"], fileAt: "File through the Department of Revenue's 941N e-filing" },
      { form: "UI-11T", slug: "ui11t", title: "Combined Tax Report (UI-11T)", kind: "ui_wage_report", codes: ["NE_UI"], fileAt: "File and pay through NEworks" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "15.00",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: {
      law: "Paid Sick Time Act (Neb. Rev. Stat. 48-1501 and following)", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "40", accrualCapHours: null,
      smallEmployer: { under: 11, annualUseCapHours: "0", accrualCapHours: "0" },
    },
    newHireReportDays: 20, newHireReportTo: "Nebraska New Hire Reporting",
  },
  business: { salesTax: null },
};
