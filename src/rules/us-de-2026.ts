import type { StateRulePack } from "./types.js";

// Delaware 2026. Withholding follows the Division of Revenue's Employer's
// Guide (Withholding Regulations and Employer's Duties), read from it on
// 2026-10-29: the year's wages less the $3,250 standard deduction ($6,500
// married filing jointly), 0% to $2,000 then 2.2% rising to 6.6% over
// $60,000, less a $110 personal credit for each exemption. Wilmington's
// 1.25% earned income tax is withheld for employees who live or work there.
// Delaware Paid Leave contributions started in 2025. Drafted 2026-10-29 for
// Greg's review (docs/rule-pack-review.md).
export const usDelaware2026: StateRulePack = {
  kind: "state",
  id: "us-de",
  version: "2026.1",
  name: "Delaware",
  place: { country: "US", region: "DE" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Delaware Division of Revenue, Employer's Guide (Withholding Regulations and Employer's Duties), revenue.delaware.gov", covers: "annualized wages less $3,250 (single or married filing separately) or $6,500 (married filing jointly); the supplemental wage examples ($884 tax on $22,750, $1,153.63 on $27,750, $717 on $19,500 married) that fix the 0% / 2.2% / 3.9% / 4.8% / 5.2% / 5.55% / 6.6% brackets; $110 credit per allowance; quarterly up to $6,020 withheld in the July-June lookback, monthly by the 15th to $33,460, eighth-monthly above", basis: "published" },
    { ref: "Payroll publishers on Delaware DOL 2026 rates and Delaware Paid Leave (labor.delaware.gov pages read didn't state them)", covers: "$14,500 wage base; 1.0% new-employer rate; Paid Leave 0.8% for 25 or more employees (up to half from employees), 0.32% for 10 to 24, none under 10, up to the Social Security wage base", basis: "working-knowledge" },
    { ref: "19 Del. C. 902 (minimum wage $15.00 from January 1, 2025); Wilmington earned income tax 1.25%; no state paid sick leave law", covers: "$15.00 minimum wage; Wilmington 1.25%; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "⚠️ check: the 6.6% top bracket from $60,000 isn't reached by the Employer's Guide examples (the rate tables are on revenuefiles.delaware.gov, which isn't reachable from here); it matches Delaware's income tax rates.",
    "DE W-4: single (also married filing separately) or married filing jointly, and the number of exemptions, each a $110 credit off the year's tax. ⚠️ check: with no DE W-4 on file TrailBook uses single with no exemptions.",
    "Wilmington: tick it for employees who live in Wilmington or work there; TrailBook withholds 1.25% of wages and shows one quarterly payment to the City of Wilmington. ⚠️ check: Wilmington's own filing frequency.",
    "Delaware Paid Leave: 0.4% employee and 0.4% employer by default (0.8% split evenly, for 25 or more employees). Employers with 10 to 24 employees pay 0.32% (only parental leave); under 10, nothing. Enter your shares in payroll settings; an employer that pays it all enters 0% for the employee share. ⚠️ check: whether TrailBook should let the employee share follow headcount automatically.",
    "Deposits: TrailBook shows Delaware withholding monthly (W-1), due the 15th of the next month, and weekly for employers who withheld more than $33,460 in the July-June lookback. Delaware's eighth-monthly periods are due three business days after each period ends, so the weekly dates are close but not exact. Employers who withheld $6,020 or less pay quarterly (W-1Q), later than shown.",
    "UI rates are per employer: enter yours from the Delaware DOL rate notice. ⚠️ check: the $14,500 wage base and 1.0% new-employer rate are from payroll publishers.",
    "⚠️ check: the Paid Leave rates and headcount tiers are from payroll publishers.",
    "Sales tax: Delaware has no sales tax.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "DE W-4",
      statuses: [
        { id: "single", label: "Single or married filing separately", standardDeduction: "3250", table: "all" },
        { id: "married", label: "Married filing jointly", standardDeduction: "6500", table: "all" },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "DE W-4 exemptions ($110 credit each)", amount: "110", credit: true }],
      tables: {
        all: [
          { over: "0", rate: "0" }, { over: "2000", rate: "0.022" }, { over: "5000", rate: "0.039" }, { over: "10000", rate: "0.048" },
          { over: "20000", rate: "0.052" }, { over: "25000", rate: "0.0555" }, { over: "60000", rate: "0.066" },
        ],
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Delaware Division of Revenue", code: "DE_WH", label: "Delaware income tax", account: "de_wh_payable" },
    localIncomeTaxes: [
      {
        id: "wilmington", name: "Wilmington earned income tax", label: "Lives or works in Wilmington", code: "WILM_EIT", agency: "City of Wilmington",
        account: "de_local_payable", w2Locality: "WILMINGTON",
        rules: { method: "flat_rate", rate: "0.0125" },
      },
    ],
    taxes: [
      {
        code: "DE_PL_EE", label: "Delaware Paid Leave (employee)", agency: "Delaware DOL", paidBy: "employee", rate: "0.004", wageBase: "184500", account: "de_pl_payable",
        assignedRate: { label: "Paid Leave employee share (%)", hint: "Up to half the total: 0.4% for 25 or more employees, 0.16% for 10 to 24, 0% under 10 or if you pay it all." },
      },
      {
        code: "DE_PL_ER", label: "Delaware Paid Leave (employer)", agency: "Delaware DOL", paidBy: "employer", rate: "0.004", wageBase: "184500", account: "de_pl_payable",
        assignedRate: { label: "Paid Leave employer share (%)", hint: "The rest of the total: 0.4% for 25 or more employees (0.8% if you pay it all), 0.16% for 10 to 24, 0% under 10." },
      },
      {
        code: "DE_UI", label: "Delaware UI", agency: "Delaware DOL", paidBy: "employer", rate: "0.01", wageBase: "14500", account: "de_ui_payable",
        assignedRate: { label: "Your Delaware UI rate (%)", hint: "The rate on your Delaware DOL rate notice. New employers pay 1.0%." },
      },
    ],
    deposits: [
      { kind: "de_wh", codes: ["DE_WH"], agency: "Delaware Division of Revenue", what: "Delaware withholding", where: "Delaware Taxpayer Portal", schedule: "monthly_or_larger", lookbackOver: "33460", largeFiler: "weekly", dueDay: 15, report: "W-1" },
      { kind: "de_wilm", codes: ["WILM_EIT"], agency: "City of Wilmington", what: "Wilmington earned income tax", where: "City of Wilmington", schedule: "quarterly", report: "Wilmington W-1" },
      { kind: "de_pl", codes: ["DE_PL_EE", "DE_PL_ER"], agency: "Delaware DOL", what: "Delaware Paid Leave contributions", where: "Delaware Paid Leave employer portal", schedule: "quarterly", report: "Paid Leave wage report" },
      { kind: "de_ui", codes: ["DE_UI"], agency: "Delaware DOL", what: "Delaware UI", where: "Delaware DOL employer portal", schedule: "quarterly", report: "UC-8" },
    ],
    employerAccount: { label: "Delaware DOL employer account number", hint: "The number on your Delaware DOL notices. It goes on the UC-8. Withholding uses your Division of Revenue account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Delaware income tax payable", systemKey: "de_wh_payable" },
      { code: "2350", name: "Delaware UI payable", systemKey: "de_ui_payable" },
      { code: "2360", name: "Delaware Paid Leave payable", systemKey: "de_pl_payable" },
      { code: "2370", name: "Wilmington earned income tax payable", systemKey: "de_local_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "UC-8", slug: "uc8", title: "Employer's Quarterly Contribution Report (UC-8)", kind: "ui_wage_report", codes: ["DE_UI"], fileAt: "File and pay through the Delaware DOL employer portal" },
      { form: "DE Paid Leave", slug: "de-pl", title: "Delaware Paid Leave quarterly wage report", kind: "ui_wage_report", codes: ["DE_PL_EE", "DE_PL_ER"], fileAt: "File and pay through the Delaware Paid Leave employer portal" },
    ],
    w2Box14: [{ code: "DE_PL_EE", label: "DEPL" }],
  },
  wageHour: {
    minimumWage: "15.00",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Delaware New Hire Reporting",
  },
  business: { salesTax: null },
};
