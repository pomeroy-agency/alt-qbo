import type { StateRulePack } from "./types.js";

// Kentucky 2026. Withholding follows the Department of Revenue's 2026
// Kentucky Withholding Tax Formula (42A003(TCF)(10-2025)), read from the copy
// Greg supplied on 2026-10-29 (revenue.ky.gov turns away automated
// visitors): the year's wages less the $3,360 standard deduction, at the flat
// 3.5%. City, county and school district occupational license taxes are
// entered per employee. Drafted 2026-10-29 for Greg's review
// (docs/rule-pack-review.md).
export const usKentucky2026: StateRulePack = {
  kind: "state",
  id: "us-ky",
  version: "2026.1",
  name: "Kentucky",
  place: { country: "US", region: "KY" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Kentucky Department of Revenue, 2026 Kentucky Withholding Tax Formula, 42A003(TCF)(10-2025)", covers: "$3,360 standard deduction; 3.5% flat rate on the rest; the $3,270 monthly example ($104.65)", basis: "published" },
    { ref: "103 KAR 18:150 and Kentucky withholding instructions, as summarized by payroll publishers (revenue.ky.gov isn't readable from here)", covers: "monthly K-1 by the 15th of the next month ($2,000 to $50,000 last year); twice-monthly over $50,000; quarterly or annual below; K-3 and K-5 by January 31", basis: "working-knowledge" },
    { ref: "Kentucky Office of Unemployment Insurance, 2026 Employer Guide", covers: "$12,000 wage base; 2.7% new-employer rate (9% for new contract construction employers); no Service Capacity Upgrade Fund in 2026", basis: "published" },
    { ref: "KRS 337.275 (minimum wage follows federal); KRS 341.190 (new hire reporting); no state paid sick leave law", covers: "$7.25 minimum wage; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Kentucky's formula has one standard deduction ($3,360) and no allowances; the K-4 only says whether the employee is exempt. No K-4 on file: withhold with the standard deduction.",
    "The formula's second example has a typo: $1,247.40 ÷ 26 is $47.98, which TrailBook withholds; the PDF prints $47.",
    "Occupational license taxes: tick the box and enter the combined rate the employee owes where they work (for example Louisville Metro or Lexington-Fayette, plus any county or school district tax) and the place. TrailBook withholds it from all wages and shows one quarterly payment. ⚠️ check: some places cap wages, exclude 401(k) deferrals, or want monthly returns, and each needs its own return (OL-3 and the like).",
    "Deposits: TrailBook shows Kentucky withholding monthly, due the 15th of the next month, and for employers with more than $50,000 last year on the federal deposit dates. Kentucky's twice-monthly filers actually pay by the 25th (1st to 15th) and the 10th of the next month (16th to the end), so that date can be off by a few days. Quarterly and annual filers can pay later than shown. ⚠️ check: the thresholds come from 103 KAR 18:150 as summarized by payroll publishers.",
    "Overtime: Kentucky also requires time and a half for hours on the seventh day when an employee works all seven days of a workweek (KRS 337.050). TrailBook only applies the 40-hour weekly rule; enter seventh-day hours as overtime by hand.",
    "UI rates are per employer: enter yours from the Kentucky Office of Unemployment Insurance rate notice. New employers pay 2.7% (new contract construction employers 9%).",
    "Sales tax: TrailBook doesn't work out Kentucky sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "K-4",
      statuses: [{ id: "single", label: "Any", standardDeduction: "3360", table: "all" }],
      noCertificateStatus: "single",
      allowances: [],
      tables: { all: [{ over: "0", rate: "0.035" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Kentucky DOR", code: "KY_WH", label: "Kentucky income tax", account: "ky_wh_payable" },
    localIncomeTaxes: [
      {
        id: "ky_occupational", name: "Kentucky occupational license tax", label: "City, county or school district occupational tax", code: "KY_OCC", agency: "City or county",
        account: "ky_local_payable", w2Locality: "OCC",
        rules: {
          method: "employee_rate", base: "wages", maxRate: "0.04", rateLabel: "Occupational tax rate (%)", placeLabel: "City or county",
          hint: "The combined occupational license tax rate where the employee works (city or metro, county and school district), and the place's name.",
        },
      },
    ],
    taxes: [
      {
        code: "KY_UI", label: "Kentucky UI", agency: "OUI", paidBy: "employer", rate: "0.027", wageBase: "12000", account: "ky_ui_payable",
        assignedRate: { label: "Your Kentucky UI rate (%)", hint: "The rate on your Office of Unemployment Insurance rate notice. New employers pay 2.7% (new contract construction employers 9%)." },
      },
    ],
    deposits: [
      { kind: "ky_wh", codes: ["KY_WH"], agency: "Kentucky DOR", what: "Kentucky withholding", where: "Kentucky Online Gateway (MyTaxes)", schedule: "monthly_or_larger", lookbackOver: "50000", largeFiler: "federal", dueDay: 15, report: "K-1" },
      { kind: "ky_occ", codes: ["KY_OCC"], agency: "City or county", what: "Kentucky occupational license tax", where: "Each city, county or school district's tax office", schedule: "quarterly", report: "OL-3 or the local return" },
      { kind: "ky_ui", codes: ["KY_UI"], agency: "OUI", what: "Kentucky UI", where: "Kentucky Unemployment Insurance employer portal", schedule: "quarterly", report: "UI-3" },
    ],
    employerAccount: { label: "Kentucky UI employer account number", hint: "The number on your Office of Unemployment Insurance notices. It goes on the UI-3. Withholding uses your Kentucky withholding account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Kentucky income tax payable", systemKey: "ky_wh_payable" },
      { code: "2350", name: "Kentucky UI payable", systemKey: "ky_ui_payable" },
      { code: "2360", name: "Kentucky occupational tax payable", systemKey: "ky_local_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "UI-3", slug: "ui3", title: "Employer's Quarterly Unemployment Wage and Tax Report (UI-3)", kind: "ui_wage_report", codes: ["KY_UI"], fileAt: "File and pay through the Kentucky Unemployment Insurance employer portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Kentucky New Hire Reporting Program",
  },
  business: { salesTax: null },
};
