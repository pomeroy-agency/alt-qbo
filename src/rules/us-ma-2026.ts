import type { StateRulePack } from "./types.js";

// Massachusetts 2026. Withholding follows the percentage method in DOR
// Circular M (Rev. 12/25), read from the circular itself on 2026-10-29:
// wages less the employee's Social Security and Medicare (up to $2,000 a
// year), annualized, less the exemption factor ($3,400 plus $1,000 an
// exemption), at 5% (9% above $1,107,750), less $120 for head of household
// and $110 for each blind person. Released 2026-10-29 after Greg's review
// (docs/rule-pack-review.md).
export const usMassachusetts2026: StateRulePack = {
  kind: "state",
  id: "us-ma",
  version: "2026.1",
  name: "Massachusetts",
  place: { country: "US", region: "MA" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Massachusetts DOR, Circular M (Rev. 12/25), Income Tax Withholding Tables and percentage method from January 1, 2026", covers: "FICA subtraction up to $2,000; exemption factor $4,400 for one, $3,400 plus $1,000 each for more; 5% and 9% above $1,107,750; head of household $120 and blindness $110 a year; no withholding under $8,000 a year when an exemption is claimed", basis: "published" },
    { ref: "Massachusetts DOR, Form M-941 instructions, as summarised by payroll publishers", covers: "monthly payments by the 15th (the quarter's last month with the M-941 at month end) for $1,201 to $25,000 a year; quarter-monthly above $25,000", basis: "working-knowledge" },
    { ref: "Massachusetts DUA, Learn about UI contribution rates (mass.gov)", covers: "2.42% new-employer rate for 2026 (6.08% for new construction employers); $15,000 wage base (M.G.L. c. 151A, s. 14)", basis: "published" },
    { ref: "Massachusetts DFML 2026 contribution rates, as reported by Seyfarth and Fisher Phillips", covers: "0.88% of wages up to the Social Security wage base ($184,500); employees can be charged up to 0.46%; employers with 25 or more covered individuals pay the other 0.42%", basis: "published" },
    { ref: "M.G.L. c. 151A, s. 14L (Workforce Training Fund) and s. 14G (EMAC)", covers: "0.056% Workforce Training Fund on the UI wage base; EMAC from the employer's fourth year", basis: "working-knowledge" },
    { ref: "M.G.L. c. 151, s. 1 (minimum wage); c. 149, s. 148C (earned sick time)", covers: "$15.00 minimum wage; 1 hour per 30 worked, up to 40 hours a year (paid at 11 or more employees)", basis: "working-knowledge" },
    { ref: "M.G.L. c. 62E, s. 2 (new hire reporting)", covers: "report new hires within 14 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "The Social Security and Medicare subtraction uses this paycheck's amounts until the year's total reaches $2,000. Earlier pay this year is counted from the year-to-date wages, so an employee hired after other payroll in the year starts from the wages TrailBook has.",
    "M-4 line 1 is the exemption count. One exemption gives $4,400; each further one $1,000 more. No M-4 on file: no exemptions. Full-time students under $8,000 a year can be marked exempt.",
    "TrailBook works the formula over the year, so amounts can differ from the wage-bracket tables by a few cents.",
    "Withholding is paid monthly by the 15th; TrailBook uses the 15th for the quarter's last month too, though DOR allows until the M-941 at the end of the next month. Above $25,000 a year DOR wants quarter-monthly payments; TrailBook's nearest schedule is weekly, which pays at least as early.",
    "UI rates are per employer: enter yours from the DUA rate notice, including any COVID-19 Recovery Assessment. New employers pay 2.42%.",
    "EMAC applies from the employer's fourth year (0.12%, then 0.24%, then 0.34%); new employers leave it blank.",
    "PFML: TrailBook withholds the full 0.46% employee share; employers that choose to pay some of it for their employees can't set that yet. Employers with 25 or more covered individuals enter the 0.42% employer share.",
    "Earned sick time is paid at 11 or more employees; smaller employers must give the same hours unpaid.",
    "Sales tax: TrailBook doesn't work out Massachusetts sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "M-4",
      statuses: [
        { id: "single", label: "Not head of household", standardDeduction: "0", table: "all" },
        { id: "hoh", label: "Head of household", standardDeduction: "0", table: "all", credit: { base: "120", phaseOutFrom: "0", phaseOutRate: "0" } },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "M-4 exemptions", amount: "1000" }, { label: "M-4 blindness: blind people (you, your spouse)", amount: "110", credit: true }],
      exemptionBase: "3400",
      ficaDeductionCap: "2000",
      noTaxBelowAnnualWages: "8000",
      tables: { all: [{ over: "0", rate: "0.05" }, { over: "1107750", rate: "0.09" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "DOR", code: "MA_WH", label: "Massachusetts income tax", account: "ma_wh_payable" },
    taxes: [
      { code: "MA_PFML_EE", label: "Massachusetts PFML (employee)", agency: "DFML", paidBy: "employee", rate: "0.0046", wageBase: "184500", account: "ma_pfml_payable" },
      {
        code: "MA_PFML_ER", label: "Massachusetts PFML (employer)", agency: "DFML", paidBy: "employer", rate: "0", wageBase: "184500", account: "ma_pfml_payable",
        assignedRate: { label: "Your PFML employer share (%)", hint: "Employers with 25 or more covered individuals pay 0.42%; smaller employers pay nothing (leave this blank)." },
      },
      {
        code: "MA_UI", label: "Massachusetts UI", agency: "DUA", paidBy: "employer", rate: "0.0242", wageBase: "15000", account: "ma_ui_payable",
        assignedRate: { label: "Your Massachusetts UI rate (%)", hint: "It's on the rate notice DUA sends by January 31, including any COVID-19 Recovery Assessment. New employers pay 2.42%." },
      },
      { code: "MA_WTF", label: "Massachusetts Workforce Training Fund", agency: "DUA", paidBy: "employer", rate: "0.00056", wageBase: "15000", account: "ma_ui_payable" },
      {
        code: "MA_EMAC", label: "Massachusetts EMAC", agency: "DUA", paidBy: "employer", rate: "0", wageBase: "15000", account: "ma_ui_payable",
        assignedRate: { label: "Your EMAC rate (%)", hint: "From your fourth year with 6 or more employees: 0.12%, then 0.24%, then 0.34%. New employers leave this blank." },
      },
    ],
    deposits: [
      {
        kind: "ma_wh", codes: ["MA_WH"], agency: "DOR", what: "Massachusetts withholding", where: "MassTaxConnect",
        schedule: "monthly_or_larger", lookbackOver: "25000", largeFiler: "weekly", dueDay: 15, report: "M-941",
      },
      { kind: "ma_ui", codes: ["MA_UI", "MA_WTF", "MA_EMAC"], agency: "DUA", what: "Massachusetts UI", where: "UI Online for employers", schedule: "quarterly", report: "Employment and Wage Detail Report" },
      { kind: "ma_pfml", codes: ["MA_PFML_EE", "MA_PFML_ER"], agency: "DFML", what: "PFML contributions", where: "MassTaxConnect", schedule: "quarterly", report: "PFML quarterly return" },
    ],
    employerAccount: { label: "Massachusetts DUA employer account number", hint: "The number on your DUA notices. It goes on the wage detail report. Withholding and PFML use your MassTaxConnect account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Massachusetts income tax payable", systemKey: "ma_wh_payable" },
      { code: "2350", name: "Massachusetts UI payable", systemKey: "ma_ui_payable" },
      { code: "2360", name: "Massachusetts PFML payable", systemKey: "ma_pfml_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "M-941", slug: "m941", title: "Employer's Return of Income Taxes Withheld (M-941)", kind: "withholding_return", codes: ["MA_WH"], fileAt: "File and pay through MassTaxConnect" },
      { form: "Wage Detail Report", slug: "ma-wage-detail", title: "Massachusetts Employment and Wage Detail Report", kind: "ui_wage_report", codes: ["MA_UI", "MA_WTF", "MA_EMAC"], fileAt: "File and pay through UI Online for employers" },
      { form: "PFML return", slug: "ma-pfml", title: "Massachusetts PFML Quarterly Contribution Return", kind: "ui_wage_report", codes: ["MA_PFML_EE", "MA_PFML_ER"], fileAt: "File and pay through MassTaxConnect" },
    ],
    w2Box14: [{ code: "MA_PFML_EE", label: "MA PFML" }],
  },
  wageHour: {
    minimumWage: "15.00",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: { law: "Earned Sick Time Law (M.G.L. c. 149, s. 148C)", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "40", accrualCapHours: null },
    newHireReportDays: 14, newHireReportTo: "Massachusetts DOR New Hire Reporting",
  },
  business: { salesTax: null },
};
