import type { StateRulePack } from "./types.js";

// Maryland 2026. Withholding follows the Comptroller's 2026 Maryland Employer
// Withholding Guide (revised December 2025) and percentage method tables,
// read from them on 2026-10-29: the year's wages less a $3,400 standard
// deduction and $3,200 for each MW507 exemption, at the state rate for the
// bracket (4.75% to 6.5%; the guide starts at 4.75%, not the return's 2% to
// 4% steps) plus the employee's county rate (2.25% to 3.30%). Nonresidents
// pay the special 2.25% nonresident rate in place of a county rate. Draft
// until Greg reviews it (docs/rule-pack-review.md).
export const usMaryland2026: StateRulePack = {
  kind: "state",
  id: "us-md",
  version: "2026.1",
  name: "Maryland",
  place: { country: "US", region: "MD" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Comptroller of Maryland, 2026 percentage method of withholding tables (e.g. 3.30 percent local income tax)", covers: "$3,400 standard deduction; $3,200 per exemption; combined rates from 8.05% (4.75% + 3.30%) with brackets at $150,000 joint / $100,000 single and up", basis: "published" },
    { ref: "Comptroller of Maryland, Central Payroll Bureau memo, 2026 Maryland State and Local Income Tax Withholding Information (February 4, 2026)", covers: "state brackets to 6.5% over $1,200,000 joint / $1,000,000 single; 2026 county rates (Anne Arundel and Frederick by income); 3.30% when no county is known; nonresident special rate 2.25%", basis: "published" },
    { ref: "Comptroller of Maryland, 2026 Maryland Employer Withholding Guide", covers: "monthly MW506 by the 15th of the next month (over $700 in a quarter); quarterly under $700; accelerated within 3 business days of payday after $15,000 last year once $700 builds up", basis: "published" },
    { ref: "Maryland Department of Labor 2026 Table A, with rates as reported by Bloomberg Tax", covers: "$8,500 wage base; 2.6% new-employer rate", basis: "published" },
    { ref: "Md. Code, Lab. & Empl. 3-413 (minimum wage), 3-1301 (Healthy Working Families Act), Fam. Law 10-108.6 (new hire reporting); HB 102 (2025) on FAMLI", covers: "$15.00 minimum wage; 1 hour of sick and safe leave per 30 worked, up to 40 used and 64 held a year (unpaid under 15 employees); report new hires within 20 days; FAMLI contributions start January 1, 2027", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Maryland's withholding combines the state tax and the county tax. TrailBook shows them as two lines (Maryland income tax and Maryland county income tax) and puts the county tax in W-2 boxes 18 to 20. ⚠️ check: Maryland may want state and county combined in box 17 instead.",
    "MW507 status: single (also married filing separately), married filing jointly, head of household (joint brackets), or married withholding at the single rate. Exemptions are $3,200 each; the MW507 worksheet lowers how many higher earners can claim. No MW507 on file: single with no exemptions, and you should withhold the 3.30% county rate.",
    "County tax: tick it and enter the rate of the county (or Baltimore City) the employee lives in, from the Comptroller's 2026 table, and the county's name. Anne Arundel and Frederick rates depend on income; use the one for the employee's expected wages. For a nonresident working in Maryland, enter 2.25% and \"Nonresident\".",
    "Small paychecks: the Comptroller's tables say not to withhold on very small paychecks (under $96 a week); TrailBook still works out the small amount.",
    "Deposits: TrailBook shows the MW506 monthly, due the 15th of the next month. Accelerated filers ($15,000 or more last year) owe within 3 business days of each payday once $700 builds up; TrailBook shows them on the federal semi-weekly dates, which can be a day or two later after a Saturday or Sunday payday. Quarterly filers (under $700 a quarter) can pay later.",
    "UI rates are per employer: enter yours from the Maryland Department of Labor rate notice. New employers pay 2.6%. ⚠️ check: a 0.15% administrative fee on taxable wages from 2026 is mentioned in a 2026 fiscal note; it isn't added here.",
    "FAMLI (paid family and medical leave) contributions start January 1, 2027; nothing is taken in 2026.",
    "Sales tax: TrailBook doesn't work out Maryland sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "MW507",
      statuses: [
        { id: "single", label: "Single or married filing separately", standardDeduction: "3400", table: "single" },
        { id: "married", label: "Married filing jointly", standardDeduction: "3400", table: "joint" },
        { id: "head_of_household", label: "Head of household", standardDeduction: "3400", table: "joint" },
        { id: "married_single_rate", label: "Married, but withhold at the single rate", standardDeduction: "3400", table: "single" },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "MW507 exemptions", amount: "3200" }],
      tables: {
        single: [
          { over: "0", rate: "0.0475" }, { over: "100000", rate: "0.05" }, { over: "125000", rate: "0.0525" }, { over: "150000", rate: "0.055" },
          { over: "250000", rate: "0.0575" }, { over: "500000", rate: "0.0625" }, { over: "1000000", rate: "0.065" },
        ],
        joint: [
          { over: "0", rate: "0.0475" }, { over: "150000", rate: "0.05" }, { over: "175000", rate: "0.0525" }, { over: "225000", rate: "0.055" },
          { over: "300000", rate: "0.0575" }, { over: "600000", rate: "0.0625" }, { over: "1200000", rate: "0.065" },
        ],
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Comptroller of Maryland", code: "MD_WH", label: "Maryland income tax", account: "md_wh_payable" },
    localIncomeTaxes: [
      {
        id: "md_county", name: "Maryland county income tax", label: "Maryland county income tax (or the nonresident rate)", code: "MD_COUNTY", agency: "Comptroller of Maryland",
        account: "md_wh_payable", w2Locality: "COUNTY",
        rules: {
          method: "employee_rate", base: "state_taxable", maxRate: "0.033", rateLabel: "County tax rate (%)", placeLabel: "County",
          hint: "The county or Baltimore City where the employee lives and its 2026 rate (2.25% to 3.30%); for a nonresident, 2.25% and \"Nonresident\".",
        },
      },
    ],
    taxes: [
      {
        code: "MD_UI", label: "Maryland UI", agency: "Maryland Labor", paidBy: "employer", rate: "0.026", wageBase: "8500", account: "md_ui_payable",
        assignedRate: { label: "Your Maryland UI rate (%)", hint: "The rate on your Maryland Department of Labor rate notice. New employers pay 2.6%." },
      },
    ],
    deposits: [
      {
        kind: "md_wh", codes: ["MD_WH", "MD_COUNTY"], agency: "Comptroller of Maryland", what: "Maryland state and county withholding", where: "Maryland Tax Connect",
        schedule: "monthly_or_larger", lookbackOver: "14999.99", largeFiler: "federal", dueDay: 15, report: "MW506",
      },
      { kind: "md_ui", codes: ["MD_UI"], agency: "Maryland Labor", what: "Maryland UI", where: "BEACON", schedule: "quarterly", report: "Quarterly contribution and employment report" },
    ],
    employerAccount: { label: "Maryland UI employer account number", hint: "The number on your Maryland Department of Labor notices. Withholding uses your 8-digit Maryland CRN.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Maryland income tax payable", systemKey: "md_wh_payable" },
      { code: "2350", name: "Maryland UI payable", systemKey: "md_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "MD UI report", slug: "md-ui", title: "Maryland Quarterly Contribution and Employment Report", kind: "ui_wage_report", codes: ["MD_UI"], fileAt: "File and pay through BEACON" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "15.00",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: {
      law: "Healthy Working Families Act (Md. Code, Lab. & Empl. 3-1301)", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "40", accrualCapHours: "64",
    },
    newHireReportDays: 20, newHireReportTo: "Maryland New Hire Registry",
  },
  business: { salesTax: null },
};
