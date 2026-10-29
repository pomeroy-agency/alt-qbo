import type { StateRulePack } from "./types.js";

// New Mexico 2026. New Mexico has no withholding certificate; employers use
// the federal W-4 filing status. Withholding follows the Taxation and Revenue
// Department's FYI-104 (2026) percentage method as reproduced by the USDA
// National Finance Center and payroll publishers on 2026-10-29
// (www.tax.newmexico.gov isn't reachable from here): nothing up to $8,050
// single or $16,100 married, then 1.5% rising to 5.9%. Every figure is marked
// for checking. Released 2026-10-29 after Greg's review
// (docs/rule-pack-review.md).
export const usNewMexico2026: StateRulePack = {
  kind: "state",
  id: "us-nm",
  version: "2026.1",
  name: "New Mexico",
  place: { country: "US", region: "NM" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "NM Taxation and Revenue Department, FYI-104 (Rev. 11/2025, for wages paid from January 1, 2026), as reproduced in the USDA NFC bulletin and payroll publishers (not read directly)", covers: "single: nothing to $8,050, 1.5% to $13,550, 3.2% to $24,550, 4.3% to $41,550, 4.7% to $74,550, 4.9% to $218,050, 5.9% above; married: $16,100, $24,100, $41,100, $66,100, $116,100, $331,100; head of household from $12,075 (1.5% to $20,075, $1,739 plus 4.7% from $62,075)", basis: "working-knowledge" },
    { ref: "Payroll publishers on New Mexico DWS 2026 UI", covers: "wage base reported as $30,600 to $34,800 (most often $34,700); new-employer rates about 1.0% by industry", basis: "working-knowledge" },
    { ref: "N.M. Stat. 50-4-22 (minimum wage $12.00); Healthy Workplaces Act (N.M. Stat. 50-17); new hire reporting within 20 days", covers: "$12.00 minimum wage; 1 hour of sick leave per 30 worked, up to 64 hours a year", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "⚠️ check: every figure comes from reproductions of the FYI-104; www.tax.newmexico.gov isn't reachable from here.",
    "New Mexico follows the federal W-4 filing status. ⚠️ check: head of household employees use the single table here, because the head of household table's upper brackets weren't found; that withholds somewhat more than New Mexico's own table.",
    "Deposits: TrailBook shows New Mexico withholding monthly with the CRS-1 (TRD-41414), due the 25th of the next month. ⚠️ check: employers averaging under $500 a month can file quarterly, later than shown.",
    "UI rates are per employer: enter yours from the Department of Workforce Solutions rate notice. ⚠️ check: payroll publishers disagree on the 2026 wage base ($30,600 to $34,800); TrailBook uses $34,700.",
    "⚠️ check: New Mexico's workers' compensation fee ($4.30 a quarter per employee, part paid by the employee) isn't included yet.",
    "Sales tax: TrailBook doesn't work out New Mexico gross receipts tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: null,
      statuses: [
        { id: "single", label: "Single or head of household", standardDeduction: "0", table: "single" },
        { id: "married", label: "Married filing jointly", standardDeduction: "0", table: "married" },
      ],
      noCertificateStatus: "single",
      statusFromW4: { single_or_mfs: "single", mfj: "married", hoh: "single" },
      allowances: [],
      tables: {
        single: [
          { over: "0", rate: "0" }, { over: "8050", rate: "0.015" }, { over: "13550", rate: "0.032" }, { over: "24550", rate: "0.043" },
          { over: "41550", rate: "0.047" }, { over: "74550", rate: "0.049" }, { over: "218050", rate: "0.059" },
        ],
        married: [
          { over: "0", rate: "0" }, { over: "16100", rate: "0.015" }, { over: "24100", rate: "0.032" }, { over: "41100", rate: "0.043" },
          { over: "66100", rate: "0.047" }, { over: "116100", rate: "0.049" }, { over: "331100", rate: "0.059" },
        ],
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "NM Taxation and Revenue Department", code: "NM_WH", label: "New Mexico income tax", account: "nm_wh_payable" },
    taxes: [
      {
        code: "NM_UI", label: "New Mexico UI", agency: "NM DWS", paidBy: "employer", rate: "0.01", wageBase: "34700", account: "nm_ui_payable",
        assignedRate: { label: "Your New Mexico UI rate (%)", hint: "The rate on your Department of Workforce Solutions rate notice. New employers' rates depend on industry (about 1.0%)." },
      },
    ],
    deposits: [
      { kind: "nm_wh", codes: ["NM_WH"], agency: "NM Taxation and Revenue Department", what: "New Mexico withholding", where: "Taxpayer Access Point (TAP)", schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 25, report: "CRS-1 (TRD-41414)" },
      { kind: "nm_ui", codes: ["NM_UI"], agency: "NM DWS", what: "New Mexico UI", where: "New Mexico DWS employer portal", schedule: "quarterly", report: "ES-903A" },
    ],
    employerAccount: { label: "New Mexico DWS employer account number", hint: "The number on your Department of Workforce Solutions notices. It goes on the ES-903A. Withholding uses your CRS identification number.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "New Mexico income tax payable", systemKey: "nm_wh_payable" },
      { code: "2350", name: "New Mexico UI payable", systemKey: "nm_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "ES-903A", slug: "es903a", title: "Employer's Quarterly Wage and Contribution Report (ES-903A)", kind: "ui_wage_report", codes: ["NM_UI"], fileAt: "File and pay through the New Mexico DWS employer portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "12.00",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: { law: "Healthy Workplaces Act (N.M. Stat. 50-17)", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "64", accrualCapHours: null },
    newHireReportDays: 20, newHireReportTo: "New Mexico New Hire Reporting Center",
  },
  business: { salesTax: null },
};
