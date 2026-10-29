import type { StateRulePack } from "./types.js";

// Michigan 2026. Withholding is 4.25% of wages less $5,900 for each MI-W4
// exemption, spread over the pay periods (Treasury's 2026 calendar-year
// figures). michigan.gov refused our requests, so the figures were checked
// against Treasury's published data as reported elsewhere. City income taxes
// (Detroit, Grand Rapids and others) aren't withheld yet. Released
// 2026-10-29 after Greg's review (docs/rule-pack-review.md).
export const usMichigan2026: StateRulePack = {
  kind: "state",
  id: "us-mi",
  version: "2026.1",
  name: "Michigan",
  place: { country: "US", region: "MI" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Michigan Treasury, Withholding Tax Information by Calendar Year (2026), as reported by Bloomberg Tax and the USDA NFC payroll bulletin", covers: "4.25% rate; $5,900 a personal exemption (up from $5,800)", basis: "published" },
    { ref: "Michigan Treasury Form 446 (withholding guide), as summarised by payroll publishers", covers: "monthly payments due the 20th of the next month on Form 5080; accelerated filers on the federal dates", basis: "working-knowledge" },
    { ref: "Michigan UIA 2026 rates, as reported by Bloomberg Tax and EY", covers: "$9,000 wage base for employers in good standing ($9,500 if delinquent); 2.7% new-employer rate (5% for new construction employers)", basis: "published" },
    { ref: "Michigan LEO, minimum wage notice", covers: "$13.73 from January 1, 2026 ($15.00 from January 1, 2027)", basis: "published" },
    { ref: "Earned Sick Time Act (MCL 408.961 et seq., as amended February 2025)", covers: "1 hour per 30 worked; employers with 11 or more employees may cap use at 72 hours a year, smaller employers at 40", basis: "working-knowledge" },
    { ref: "MCL 421.13j (new hire reporting)", covers: "report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "michigan.gov answered our requests with 403, so the rate and exemption come from Treasury's figures as reported by Bloomberg Tax and the USDA payroll bulletin, not the Form 446 itself. Worth a look at Form 446 before release.",
    "No MI-W4 on file: no exemptions (4.25% of all wages).",
    "City income taxes (Detroit 2.4% resident and 1.2% nonresident, Grand Rapids, Lansing and about 20 others) aren't withheld. Employers with staff in those cities must withhold them separately for now.",
    "Withholding is paid monthly by the 20th of the next month (Form 5080). Accelerated filers pay on the federal dates; TrailBook keeps every Michigan employer on the monthly date, so an accelerated filer must follow Treasury's notice.",
    "UI rates are per employer: enter yours from the UIA rate notice. New employers pay 2.7%. The UI wage base is $9,000 for employers who file on time and owe nothing, $9,500 otherwise; TrailBook uses $9,000.",
    "Earned sick time: employers with 11 or more employees, 72 hours a year; 10 or fewer, 40 hours.",
    "Sales tax: TrailBook doesn't work out Michigan sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "MI-W4",
      statuses: [{ id: "single", label: "Any", standardDeduction: "0", table: "all" }],
      noCertificateStatus: "single",
      allowances: [{ label: "MI-W4 exemptions", amount: "5900" }],
      tables: { all: [{ over: "0", rate: "0.0425" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Treasury", code: "MI_WH", label: "Michigan income tax", account: "mi_wh_payable" },
    taxes: [
      {
        code: "MI_UI", label: "Michigan UI", agency: "UIA", paidBy: "employer", rate: "0.027", wageBase: "9000", account: "mi_ui_payable",
        assignedRate: { label: "Your Michigan UI rate (%)", hint: "It's on the rate notice UIA sends each year. New employers pay 2.7% (5% in construction)." },
      },
    ],
    deposits: [
      {
        kind: "mi_wh", codes: ["MI_WH"], agency: "Treasury", what: "Michigan withholding", where: "Michigan Treasury Online",
        schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 20, report: "Form 5080",
      },
      { kind: "mi_ui", codes: ["MI_UI"], agency: "UIA", what: "Michigan UI", where: "MiWAM", schedule: "quarterly", report: "UIA 1028" },
    ],
    employerAccount: { label: "Michigan UIA employer account number", hint: "The number on your UIA notices. It goes on the UIA 1028. Withholding uses your federal EIN.", pattern: "^[0-9]{7,10}$" },
    accounts: [
      { code: "2340", name: "Michigan income tax payable", systemKey: "mi_wh_payable" },
      { code: "2350", name: "Michigan UI payable", systemKey: "mi_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "UIA 1028", slug: "uia1028", title: "Employer's Quarterly Wage/Tax Report (UIA 1028)", kind: "ui_wage_report", codes: ["MI_UI"], fileAt: "File and pay through MiWAM" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "13.73",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: {
      law: "Earned Sick Time Act (MCL 408.961)", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "72", accrualCapHours: null,
      smallEmployer: { under: 11, annualUseCapHours: "40", accrualCapHours: null },
    },
    newHireReportDays: 20, newHireReportTo: "Michigan New Hire Operations Center",
  },
  business: { salesTax: null },
};
