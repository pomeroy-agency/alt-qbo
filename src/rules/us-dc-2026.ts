import type { StateRulePack } from "./types.js";

// District of Columbia 2026. The rates come from the Office of Tax and
// Revenue's Individual and Fiduciary Income Tax Rates page (tax years after
// 2021), read from the copy Greg uploaded on 2026-10-29. The withholding
// method comes from a payroll publisher's 2026 page Greg uploaded
// (Halfpricesoft, following the National Finance Center's method), because
// OTR's own withholding instructions aren't reachable from here: the year's
// wages less $4,150 for each D-4 allowance, through the rate schedule (4%
// rising to 10.75%), one schedule for every filing status, divided by the
// pay periods. Drafted 2026-10-29 for Greg's review
// (docs/rule-pack-review.md).
export const usDistrictOfColumbia2026: StateRulePack = {
  kind: "state",
  id: "us-dc",
  version: "2026.1",
  name: "District of Columbia",
  place: { country: "US", region: "DC" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "DC Office of Tax and Revenue, DC Individual and Fiduciary Income Tax Rates (tax years beginning after 12/31/2021), otr.cfo.dc.gov, as uploaded", covers: "4% to $10,000; $400 + 6% to $40,000; $2,200 + 6.5% to $60,000; $3,500 + 8.5% to $250,000; $19,650 + 9.25% to $500,000; $42,775 + 9.75% to $1,000,000; $91,525 + 10.75% above", basis: "published" },
    { ref: "Halfpricesoft, District of Columbia 2026 Income Tax Withholding (last updated December 17, 2025), as uploaded; follows the National Finance Center's method (OTR's withholding instructions aren't reachable from here)", covers: "$4,150 per D-4 allowance subtracted from annual wages; one table for all filing statuses (the same rates as OTR's)", basis: "working-knowledge" },
    { ref: "DC DOES 2026 UI and Paid Family Leave, as reported by payroll publishers (Netchex, Warp, OnPay)", covers: "UI $9,000 wage base, 2.7% new-employer rate, 0.2% Administrative Funding Assessment; Universal Paid Leave 0.75% employer-only, no wage base", basis: "working-knowledge" },
    { ref: "DOES 2026 Minimum Wage Increase Notice; Accrued Sick and Safe Leave Act (D.C. Code 32-531.01 and following); new hire reporting within 20 days", covers: "minimum wage $17.95, $18.40 from July 1, 2026; 1 hour of sick leave per 37 worked, up to 40 hours a year (employers with 25 to 99 employees)", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "⚠️ check: the withholding method (annual wages less $4,150 a D-4 allowance, no separate standard deduction) comes from a payroll publisher, not OTR's own withholding instructions, which can't be reached from here. The rates themselves are OTR's. Recheck against OTR's 2026 Income Tax Withholding Instructions and Tables when they can be read.",
    "D-4: filing status and the number of allowances, $4,150 each. Every status uses the same table. ⚠️ check: no D-4 on file is treated as single with no allowances.",
    "Deposits: TrailBook shows DC withholding monthly (FR-900M), due the 20th of the next month. ⚠️ check: OTR may assign small employers quarterly (FR-900Q) or annual (FR-900A) filing, which would make the real due dates later than shown.",
    "UI rates are per employer: enter yours from the DOES rate notice. New employers pay 2.7%, plus the 0.2% Administrative Funding Assessment. ⚠️ check: these and the $9,000 wage base are from payroll publishers; does.dc.gov isn't reachable from here.",
    "⚠️ check: Universal Paid Leave is 0.75% of all wages, paid by the employer and never deducted from employees. One payroll publisher still lists the older 0.26% rate.",
    "⚠️ check: sick leave: TrailBook uses the middle tier (1 hour per 37 worked, up to 40 hours, for 25 to 99 employees). Employers with 100 or more give up to 56 hours; those with 24 or fewer give 1 hour per 87, up to 24 hours, which TrailBook shows only as the lower cap.",
    "Sales tax: TrailBook doesn't work out DC sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "D-4",
      statuses: [
        { id: "single", label: "Single", standardDeduction: "0", table: "all" },
        { id: "married_joint", label: "Married or registered domestic partners filing jointly", standardDeduction: "0", table: "all" },
        { id: "married_separate", label: "Married filing separately", standardDeduction: "0", table: "all" },
        { id: "head_of_household", label: "Head of household", standardDeduction: "0", table: "all" },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "D-4 allowances", amount: "4150" }],
      tables: {
        all: [
          { over: "0", rate: "0.04" },
          { over: "10000", rate: "0.06" },
          { over: "40000", rate: "0.065" },
          { over: "60000", rate: "0.085" },
          { over: "250000", rate: "0.0925" },
          { over: "500000", rate: "0.0975" },
          { over: "1000000", rate: "0.1075" },
        ],
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "DC Office of Tax and Revenue", code: "DC_WH", label: "DC income tax", account: "dc_wh_payable" },
    taxes: [
      {
        code: "DC_UI", label: "DC UI", agency: "DC DOES", paidBy: "employer", rate: "0.027", wageBase: "9000", account: "dc_ui_payable",
        assignedRate: { label: "Your DC UI rate (%)", hint: "The UI rate on your DOES rate notice, without the 0.2% Administrative Funding Assessment. New employers pay 2.7%." },
      },
      { code: "DC_AFA", label: "DC Administrative Funding Assessment", agency: "DC DOES", paidBy: "employer", rate: "0.002", wageBase: "9000", account: "dc_ui_payable" },
      { code: "DC_UPL", label: "DC Universal Paid Leave", agency: "DC DOES", paidBy: "employer", rate: "0.0075", wageBase: null, account: "dc_upl_payable" },
    ],
    deposits: [
      { kind: "dc_wh", codes: ["DC_WH"], agency: "DC Office of Tax and Revenue", what: "DC withholding", where: "MyTax.DC.gov", schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 20, report: "FR-900M" },
      { kind: "dc_ui", codes: ["DC_UI", "DC_AFA"], agency: "DC DOES", what: "DC UI", where: "DOES Employer Self Service Portal", schedule: "quarterly", report: "UC-30" },
      { kind: "dc_upl", codes: ["DC_UPL"], agency: "DC DOES", what: "DC Universal Paid Leave", where: "DOES Employer Self Service Portal", schedule: "quarterly", report: "Paid Family Leave quarterly report" },
    ],
    employerAccount: { label: "DC DOES employer account number", hint: "The number on your DOES notices. It goes on the quarterly UC-30. Withholding uses your MyTax.DC.gov account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "DC income tax payable", systemKey: "dc_wh_payable" },
      { code: "2350", name: "DC UI payable", systemKey: "dc_ui_payable" },
      { code: "2360", name: "DC Universal Paid Leave payable", systemKey: "dc_upl_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "UC-30", slug: "uc30", title: "Employer's Quarterly Contribution and Wage Report (UC-30)", kind: "ui_wage_report", codes: ["DC_UI", "DC_AFA"], fileAt: "File and pay through the DOES Employer Self Service Portal" },
      { form: "PFL report", slug: "dc-upl", title: "DC Paid Family Leave Quarterly Report", kind: "ui_wage_report", codes: ["DC_UPL"], fileAt: "File and pay through the DOES Employer Self Service Portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "17.95", minimumWageChanges: [{ from: "2026-07-01", rate: "18.40" }],
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: {
      law: "Accrued Sick and Safe Leave Act (D.C. Code 32-531.01 and following)", hoursWorkedPerHourAccrued: "37", annualUseCapHours: "40", accrualCapHours: null,
      smallEmployer: { under: 25, annualUseCapHours: "24", accrualCapHours: null },
    },
    newHireReportDays: 20, newHireReportTo: "DC New Hire Registry",
  },
  business: { salesTax: null },
};
