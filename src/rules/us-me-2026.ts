import type { StateRulePack } from "./types.js";

/** The rate schedule as rate × income less a fixed amount, so the booklet's rounded base amounts come out exactly. */
function table(rows: [over: number, base: number, rate: number][]) {
  return rows.map(([over, base, rate]) => ({ over: String(over), rate: String(rate), subtract: (rate * over - base).toFixed(4) }));
}

// Maine 2026. Withholding follows Maine Revenue Services' 2026 Withholding
// Tables for Individual Income Tax (revised August 2026 for the larger
// standard deduction and the new surcharge), percentage method, read from
// the booklet Greg uploaded on 2026-10-29: the year's wages less $5,300 for
// each W-4ME allowance and the withholding standard deduction ($12,850
// single, $28,550 married, shrinking to nothing between $102,250 and
// $177,250 single or $204,550 and $354,550 married), 5.8% rising to 7.15%,
// plus the 2% surcharge over $1,000,000 ($1,500,000 married), divided by the
// pay periods and rounded to the dollar. Released 2026-10-29 after Greg's
// review (docs/rule-pack-review.md).
export const usMaine2026: StateRulePack = {
  kind: "state",
  id: "us-me",
  version: "2026.1",
  name: "Maine",
  place: { country: "US", region: "ME" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Maine Revenue Services, 2026 Withholding Tables for Individual Income Tax (revised August 2026), Maine Income Tax Withholding — Percentage Method — 2026", covers: "$5,300 per W-4ME allowance; withholding standard deduction $12,850 single to $102,250 of annual wages and $28,550 married to $204,550, then $12,850 × ($177,250 − wages) / $75,000 and $28,550 × ($354,550 − wages) / $150,000, nothing above; single 5.8% to $27,400, $1,589 + 6.75% to $64,850, $4,117 + 7.15% above; married $54,850 ($3,181) and $129,750 ($8,237); 2% surcharge on annualized income over $1,000,000 single or $1,500,000 married; round to the dollar; Examples 1 to 3 ($0, $32 and $256 a week)", basis: "published" },
    { ref: "Same booklet, items 4 to 7", covers: "married uses the married schedule; married but withholding at the higher single rate and single or head of household use the single schedule; no valid W-4ME means single with no allowances; supplemental wages paid separately may be withheld at 5%; Form 941ME quarterly by the last day of the month after the quarter; semiweekly payments when the July 2024 to June 2025 withholding was $18,000 or more (Wednesday to Friday paydays by the next Wednesday, Saturday to Tuesday by the next Friday), otherwise with the quarterly return", basis: "published" },
    { ref: "Maine DOL 2026 UI, as reported by Bloomberg Tax and payroll publishers (maine.gov isn't reachable from here)", covers: "$12,000 wage base; Schedule A; 2.54% new-employer rate (2.23% UC, 0.14% CSSF, 0.17% UPAF)", basis: "working-knowledge" },
    { ref: "Maine Paid Family and Medical Leave, as reported by NFIB and payroll publishers", covers: "1% of wages up to the Social Security wage base ($184,500); employers with 15 or more employees may deduct up to half from employees; smaller employers pay only the employee half (0.5%), which they may deduct", basis: "working-knowledge" },
    { ref: "26 M.R.S. 664 and 663(3)(K) (minimum wage $15.10 from January 1, 2026; exempt salary over 3,000 times the minimum wage a year); 26 M.R.S. 637 (earned paid leave); new hire reporting within 7 days", covers: "$15.10 minimum wage; $45,300 exempt salary; 1 hour of earned paid leave per 40 worked, up to 40 hours a year, for employers with more than 10 employees", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "W-4ME: single (also head of household), married, or married but withholding at the higher single rate, and the number of allowances, $5,300 each. No W-4ME on file: single with no allowances, as the booklet says.",
    "The rate schedule's base amounts are used exactly, so TrailBook matches the booklet's three examples ($0, $32 and $256 a week).",
    "The standard deduction phase-out is worked out as a rate of wages over the threshold ($12,850 ÷ $75,000 single, $28,550 ÷ $150,000 married), which gives the booklet's formula to within a fraction of a cent.",
    "Deposits: TrailBook shows Maine withholding on the federal deposit dates when last year's average quarter was over $4,500 (the booklet's $18,000 lookback test) and quarterly with the 941ME otherwise. ⚠️ check: Maine's semiweekly schedule applies whatever the federal schedule is, so an employer who deposits federal tax monthly but withheld $18,000 or more for Maine still pays Maine semiweekly.",
    "UI rates are per employer: enter yours from the Maine DOL rate notice, including the CSSF and UPAF parts. ⚠️ check: the $12,000 wage base and 2.54% new-employer rate are from Bloomberg Tax and payroll publishers; maine.gov isn't reachable from here.",
    "⚠️ check: Paid Family and Medical Leave: TrailBook takes 0.5% from the employee. Employers with 15 or more employees enter the 0.5% employer share; smaller employers leave it blank. Figures are from NFIB and payroll publishers.",
    "⚠️ check: city minimum wages (Portland $16.75 and Rockland $16.00 in 2026, as reported by NFIB) aren't included yet.",
    "Sales tax: TrailBook doesn't work out Maine sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "W-4ME",
      statuses: [
        { id: "single", label: "Single or head of household", standardDeduction: "12850", table: "single", phaseOut: { from: "102250", rate: "0.1713333333" } },
        { id: "married", label: "Married", standardDeduction: "28550", table: "married", phaseOut: { from: "204550", rate: "0.1903333333" } },
        { id: "married_single_rate", label: "Married, but withholding at the higher single rate", standardDeduction: "12850", table: "single", phaseOut: { from: "102250", rate: "0.1713333333" } },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "W-4ME allowances", amount: "5300" }],
      tables: {
        single: table([[0, 0, 0.058], [27400, 1589, 0.0675], [64850, 4117, 0.0715], [1000000, 4117 + 0.0715 * (1000000 - 64850), 0.0915]]),
        married: table([[0, 0, 0.058], [54850, 3181, 0.0675], [129750, 8237, 0.0715], [1500000, 8237 + 0.0715 * (1500000 - 129750), 0.0915]]),
      },
      round: "dollar",
    },
    incomeTaxAgency: { agency: "Maine Revenue Services", code: "ME_WH", label: "Maine income tax", account: "me_wh_payable" },
    taxes: [
      {
        code: "ME_UI", label: "Maine UI", agency: "Maine DOL", paidBy: "employer", rate: "0.0254", wageBase: "12000", account: "me_ui_payable",
        assignedRate: { label: "Your Maine UI rate (%)", hint: "The total rate on your Maine DOL rate notice (UC, CSSF and UPAF). New employers pay 2.54%." },
      },
      { code: "ME_PFML_EE", label: "Maine PFML (employee)", agency: "Maine PFML", paidBy: "employee", rate: "0.005", wageBase: "184500", account: "me_pfml_payable" },
      {
        code: "ME_PFML_ER", label: "Maine PFML (employer)", agency: "Maine PFML", paidBy: "employer", rate: "0", wageBase: "184500", account: "me_pfml_payable",
        assignedRate: { label: "Your PFML employer share (%)", hint: "Employers with 15 or more employees pay 0.5%; smaller employers pay nothing (leave this blank)." },
      },
    ],
    deposits: [
      { kind: "me_wh", codes: ["ME_WH"], agency: "Maine Revenue Services", what: "Maine withholding", where: "Maine Tax Portal", schedule: "federal_timing_by_average", federalTimingAverageOver: "4500", report: "941ME" },
      { kind: "me_ui", codes: ["ME_UI"], agency: "Maine DOL", what: "Maine UI", where: "ReEmployME", schedule: "quarterly", report: "ME UC-1" },
      { kind: "me_pfml", codes: ["ME_PFML_EE", "ME_PFML_ER"], agency: "Maine PFML", what: "Maine PFML contributions", where: "Maine PFML portal", schedule: "quarterly", report: "PFML quarterly return" },
    ],
    employerAccount: { label: "Maine DOL employer account number", hint: "The number on your Maine DOL notices. It goes on the quarterly UC wage report. Withholding uses your Maine Revenue Services withholding account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Maine income tax payable", systemKey: "me_wh_payable" },
      { code: "2350", name: "Maine UI payable", systemKey: "me_ui_payable" },
      { code: "2360", name: "Maine PFML payable", systemKey: "me_pfml_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "941ME", slug: "me941", title: "Employer's Return of Maine Income Tax Withheld (941ME)", kind: "withholding_return", codes: ["ME_WH"], fileAt: "File through the Maine Tax Portal" },
      { form: "ME UC-1", slug: "meuc1", title: "Unemployment Contributions Report (ME UC-1)", kind: "ui_wage_report", codes: ["ME_UI"], fileAt: "File and pay through ReEmployME" },
      { form: "PFML return", slug: "me-pfml", title: "Maine PFML Quarterly Contribution Return", kind: "ui_wage_report", codes: ["ME_PFML_EE", "ME_PFML_ER"], fileAt: "File and pay through the Maine PFML portal" },
    ],
    w2Box14: [{ code: "ME_PFML_EE", label: "ME PFML" }],
  },
  wageHour: {
    minimumWage: "15.10",
    exemptAnnualSalaryMinimum: "45300",
    overtime: { weeklyAfter: "40" },
    sickLeave: {
      law: "Earned paid leave (26 M.R.S. 637)", hoursWorkedPerHourAccrued: "40", annualUseCapHours: "40", accrualCapHours: null,
      smallEmployer: { under: 11, annualUseCapHours: "0", accrualCapHours: "0" },
    },
    newHireReportDays: 7, newHireReportTo: "Maine New Hire Reporting (Maine DHHS)",
  },
  business: { salesTax: null },
};
