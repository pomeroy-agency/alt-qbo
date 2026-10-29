import type { StateRulePack } from "./types.js";

// Arizona 2026. Withholding is a flat percentage of each paycheck that the
// employee elects on Form A-4; there are no tables. The pack is a draft until
// Greg reviews it in docs/rule-pack-review.md. Figures were gathered on
// 2026-10-29 from payroll publishers; Arizona's own sites can't be opened from
// TrailBook's build machines, so the review notes say what to check.
export const usArizona2026: StateRulePack = {
  kind: "state",
  id: "us-az",
  version: "2026.1",
  name: "Arizona",
  place: { country: "US", region: "AZ" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Bloomberg Law, \"Arizona's 2026 Withholding Rates Unchanged From 2025\"; A.R.S. 43-401", covers: "A-4 choices 0.5% to 3.5% in half-point steps; 2.0% when no A-4 is filed; 0% may be elected when no Arizona tax is expected", basis: "published" },
    { ref: "Arizona DES 2026 UI rates, as summarised by Avionté and FirstHR", covers: "$8,000 wage base; 2.0% new-employer rate; 0.04% to 9.72% range", basis: "published" },
    { ref: "A.R.S. 23-769 (job training tax)", covers: "0.1% on the UI wage base for rated employers; not charged to new employers or those with a negative balance", basis: "working-knowledge" },
    { ref: "A.R.S. 23-363 (Proposition 206, CPI-indexed); Industrial Commission of Arizona", covers: "$15.15 minimum wage from January 1, 2026", basis: "published" },
    { ref: "A.R.S. 23-371 to 23-381 (Fair Wages and Healthy Families Act)", covers: "earned paid sick time: 1 hour per 30 worked; 40 hours a year for 15+ employees, 24 for fewer", basis: "working-knowledge" },
    { ref: "A.R.S. 43-403, 43-413; ADOR Form A1-QRT and A1-R instructions", covers: "quarterly withholding return; deposit timing follows the federal schedule when last year's quarterly average was over $1,500", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "A new employee who files no A-4 is withheld at 2.0%. An employee may elect 0% only if they expect no Arizona tax for the year; TrailBook takes that election as given.",
    "UI and job training tax rates are per employer: enter them from the DES rate notice. New employers pay 2.0% UI and no job training tax.",
    "Deposits: if last year's average quarterly Arizona withholding was over $1,500, deposits are due on the federal schedule; otherwise with the A1-QRT. Check ADOR's current threshold.",
    "Flagstaff ($18.35) and Tucson ($15.45) have higher local minimum wages that TrailBook doesn't check yet.",
    "Tipped employees ($12.15 cash wage) aren't modelled; TrailBook checks the full minimum wage.",
    "Paid sick time caps are read as both a use and an accrual cap (A.R.S. 23-372 allows carrying over up to 40 hours, or 24 for small employers).",
    "The A1-R annual reconciliation and W-2 state copies are prepared from the W-2 data; the A1-R itself isn't produced yet.",
    "Sales tax: Arizona's transaction privilege tax isn't worked out yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "elected_percent", certificate: "A-4",
      choices: ["0.005", "0.01", "0.015", "0.02", "0.025", "0.03", "0.035"], defaultRate: "0.02", zeroAllowed: true,
    },
    incomeTaxAgency: { agency: "ADOR", code: "AZ_WH", label: "Arizona income tax", account: "az_wh_payable" },
    taxes: [
      {
        code: "AZ_UI", label: "Arizona UI", agency: "DES", paidBy: "employer", rate: "0.02", wageBase: "8000", account: "az_ui_payable",
        assignedRate: { label: "Your Arizona UI rate (%)", hint: "It's on the rate notice DES sends each year. New employers pay 2.0%." },
      },
      {
        code: "AZ_JTT", label: "Arizona job training tax", agency: "DES", paidBy: "employer", rate: "0", wageBase: "8000", account: "az_jtt_payable",
        assignedRate: { label: "Your Arizona job training tax rate (%)", hint: "0.1% once DES gives you a rated account; new employers pay nothing (leave this blank)." },
      },
    ],
    deposits: [
      {
        kind: "az_wh", codes: ["AZ_WH"], agency: "ADOR", what: "Arizona withholding", where: "AZTaxes.gov",
        schedule: "federal_timing_by_average", federalTimingAverageOver: "1500", report: "A1-QRT",
      },
      { kind: "az_ui", codes: ["AZ_UI", "AZ_JTT"], agency: "DES", what: "Unemployment Tax and Wage Report", where: "DES employer online services", schedule: "quarterly", report: "UC-018" },
    ],
    employerAccount: { label: "Arizona DES employer account number", hint: "The number on your DES notices. It goes on the UC-018. Arizona withholding uses your federal EIN.", pattern: "^[0-9]{7,10}$" },
    accounts: [
      { code: "2340", name: "Arizona income tax payable", systemKey: "az_wh_payable" },
      { code: "2350", name: "Arizona UI payable", systemKey: "az_ui_payable" },
      { code: "2360", name: "Arizona job training tax payable", systemKey: "az_jtt_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "A1-QRT", slug: "a1-qrt", title: "Arizona Quarterly Withholding Tax Return (A1-QRT)", kind: "withholding_return", codes: ["AZ_WH"], fileAt: "File and pay at AZTaxes.gov" },
      { form: "UC-018", slug: "uc018", title: "Unemployment Tax and Wage Report (UC-018)", kind: "ui_wage_report", codes: ["AZ_UI", "AZ_JTT"], fileAt: "File and pay through DES employer online services" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "15.15",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: {
      law: "A.R.S. 23-371 to 23-381", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "40", accrualCapHours: "40",
      smallEmployer: { under: 15, annualUseCapHours: "24", accrualCapHours: "24" },
    },
    newHireReportDays: 20, newHireReportTo: "Arizona New Hire Reporting Center",
  },
  business: { salesTax: null },
};
