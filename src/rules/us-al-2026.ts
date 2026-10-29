import type { StateRulePack, WageRow } from "./types.js";

/** Alabama's standard deduction schedule: `start` up to `from`, then `less` off for each `every` (or part) above it, down to `floor`. */
function schedule(start: number, from: number, every: number, less: number, floor: number): WageRow[] {
  const rows: WageRow[] = [{ over: "0", amount: String(start) }];
  for (let k = 0; start - less * (k + 1) > floor; k++) rows.push({ over: String(from + every * k), amount: String(start - less * (k + 1)) });
  rows.push({ over: String(from + every * (rows.length - 1)), amount: String(floor) });
  return rows;
}

// Alabama 2026. Withholding follows the Department of Revenue's Withholding
// Tax Tables and Instructions booklet (whbooklet_0126), read from it on
// 2026-10-29: the year's wages less the standard deduction from the booklet's
// schedule (it shrinks from $35,500 down), the year's federal income tax
// withheld, the A-4 personal exemption and $1,000, $500 or $300 per
// dependent by wages; then 2% / 4% / 5%. Local occupational taxes
// (Birmingham, Gadsden and others) are entered per employee. Released
// 2026-10-29 after Greg's review (docs/rule-pack-review.md).
export const usAlabama2026: StateRulePack = {
  kind: "state",
  id: "us-al",
  version: "2026.1",
  name: "Alabama",
  place: { country: "US", region: "AL" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Alabama Department of Revenue, Withholding Tax Tables and Instructions (whbooklet_0126), Formula For Computing Alabama Withholding Tax and Schedule of Standard Deduction Amounts", covers: "standard deduction by status and wages; federal withholding subtracted; personal exemption $1,500 (S, MS) or $3,000 (M, H); dependents $1,000 / $500 over $50,000 / $300 over $100,000; 2% / 4% / 5% with brackets at $500 and $3,000 ($1,000 and $6,000 for M); zero exemptions without an A-4; the M-2 $850 weekly example ($29.59)", basis: "published" },
    { ref: "Same booklet, Withholding Tax Returns", covers: "monthly A-6 by the 15th once more than $1,000 is withheld in the first or second month of a quarter; quarterly A-1 by the last day of the month after the quarter; A-3 by January 31; occupational and UI taxes not administered by the Department", basis: "published" },
    { ref: "Alabama Department of Workforce 2026 rates, as reported by payroll publishers (adol.alabama.gov isn't reachable from here)", covers: "$8,000 wage base; 2.7% new-employer rate", basis: "working-knowledge" },
    { ref: "Alabama has no state minimum wage or paid sick leave law; Ala. Code 25-11-5 (new hire reporting within 7 days)", covers: "federal $7.25 minimum wage; report new hires within 7 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "A-4 status: 0 (no personal exemption), S (single, $1,500), MS (married filing separately, $1,500), M (married, $3,000) or H (head of family, $3,000). M uses the married brackets; the others use the single ones. Dependents (other than a spouse) go in the dependents box. No A-4 on file: \"0\", as the booklet says.",
    "Alabama subtracts the federal income tax withheld from the same paycheck (annualized). TrailBook takes it from the federal amount it works out for that paycheck, including any extra W-4 withholding.",
    "The booklet says the formula result may be rounded to the dollar; TrailBook keeps cents.",
    "Occupational tax: tick it and enter the city or county rate (Birmingham 1%, Bessemer 1%, Gadsden 2% and others) and the place. Each city or county collects its own; TrailBook shows one quarterly payment for all of them. ⚠️ check: some cities want monthly returns, and some also tax employers.",
    "Deposits: TrailBook shows Alabama withholding monthly (Form A-6), due the 15th of the next month. Employers who withhold $1,000 or less in a month can wait until the quarterly A-1 (the last day of the month after the quarter), so TrailBook may show a date earlier than needed.",
    "UI rates are per employer: enter yours from the Alabama Department of Workforce rate notice. New employers pay 2.7%. ⚠️ check: the $8,000 wage base and 2.7% are from payroll publishers; adol.alabama.gov isn't reachable from here.",
    "Sales tax: TrailBook doesn't work out Alabama sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "A-4",
      statuses: [
        { id: "zero", label: "0 (no personal exemption)", standardDeduction: "3000", deductionByWages: schedule(3000, 25999, 500, 25, 2500), table: "single" },
        { id: "single", label: "S (single)", standardDeduction: "3000", deductionByWages: schedule(3000, 25999, 500, 25, 2500), exemption: "1500", table: "single" },
        { id: "married_separate", label: "MS (married filing separately)", standardDeduction: "4250", deductionByWages: schedule(4250, 12999, 250, 88, 2500), exemption: "1500", table: "single" },
        { id: "married", label: "M (married)", standardDeduction: "8500", deductionByWages: schedule(8500, 25999, 500, 175, 5000), exemption: "3000", table: "married" },
        { id: "head_of_family", label: "H (head of family)", standardDeduction: "5200", deductionByWages: schedule(5200, 25999, 500, 135, 2500), exemption: "3000", table: "single" },
      ],
      noCertificateStatus: "zero",
      allowances: [{ label: "A-4 dependents", amount: "1000", byWages: [{ over: "0", amount: "1000" }, { over: "50000", amount: "500" }, { over: "100000", amount: "300" }] }],
      subtractFederalWithholding: true,
      tables: {
        single: [{ over: "0", rate: "0.02" }, { over: "500", rate: "0.04" }, { over: "3000", rate: "0.05" }],
        married: [{ over: "0", rate: "0.02" }, { over: "1000", rate: "0.04" }, { over: "6000", rate: "0.05" }],
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "ALDOR", code: "AL_WH", label: "Alabama income tax", account: "al_wh_payable" },
    localIncomeTaxes: [
      {
        id: "al_occupational", name: "Alabama occupational tax", label: "City or county occupational tax", code: "AL_OCC", agency: "City or county",
        account: "al_local_payable", w2Locality: "OCC",
        rules: {
          method: "employee_rate", base: "wages", maxRate: "0.02", rateLabel: "Occupational tax rate (%)", placeLabel: "City or county",
          hint: "The city or county where the employee works, if it has an occupational (license) tax, and its rate: Birmingham 1%, Gadsden 2% and so on.",
        },
      },
    ],
    taxes: [
      {
        code: "AL_UI", label: "Alabama UI", agency: "ADOW", paidBy: "employer", rate: "0.027", wageBase: "8000", account: "al_ui_payable",
        assignedRate: { label: "Your Alabama UI rate (%)", hint: "The total rate on your Alabama Department of Workforce rate notice. New employers pay 2.7%." },
      },
    ],
    deposits: [
      { kind: "al_wh", codes: ["AL_WH"], agency: "ALDOR", what: "Alabama withholding", where: "My Alabama Taxes", schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 15, report: "A-6 / A-1" },
      { kind: "al_occ", codes: ["AL_OCC"], agency: "City or county", what: "Alabama occupational tax", where: "Each city or county's tax office", schedule: "quarterly", report: "occupational tax return" },
      { kind: "al_ui", codes: ["AL_UI"], agency: "ADOW", what: "Alabama UI", where: "Alabama Department of Workforce employer portal", schedule: "quarterly", report: "UC-CR4" },
    ],
    employerAccount: { label: "Alabama UI employer account number", hint: "The number on your Department of Workforce notices. It goes on the UC-CR4. Withholding uses your ALDOR withholding account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Alabama income tax payable", systemKey: "al_wh_payable" },
      { code: "2350", name: "Alabama UI payable", systemKey: "al_ui_payable" },
      { code: "2360", name: "Alabama occupational tax payable", systemKey: "al_local_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "A-1", slug: "a1", title: "Employer's Quarterly Return of Income Tax Withheld (A-1)", kind: "withholding_return", codes: ["AL_WH"], fileAt: "File through My Alabama Taxes" },
      { form: "UC-CR4", slug: "uccr4", title: "Employer's Quarterly Contribution and Wage Report (UC-CR4)", kind: "ui_wage_report", codes: ["AL_UI"], fileAt: "File and pay through the Alabama Department of Workforce employer portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 7, newHireReportTo: "Alabama New Hire Reporting",
  },
  business: { salesTax: null },
};
