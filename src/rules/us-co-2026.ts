import type { StateRulePack } from "./types.js";

// Colorado 2026. Withholding follows the 2026 Colorado Withholding Worksheet
// for Employers (DR 1098, 10/21/25), read from the worksheet itself on
// 2026-10-29: 4.4% of the year's wages less the DR 0004 line 2 allowance, or
// without one $11,000 (married filing jointly on the W-4) or $5,500.
// Released 2026-10-29 after Greg's review (docs/rule-pack-review.md).
export const usColorado2026: StateRulePack = {
  kind: "state",
  id: "us-co",
  version: "2026.1",
  name: "Colorado",
  place: { country: "US", region: "CO" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "CDOR, DR 1098 (10/21/25), 2026 Colorado Withholding Worksheet for Employers", covers: "4.40% of annualized wages less the DR 0004 line 2 allowance, or $11,000 married filing jointly / $5,500 otherwise from the W-4; single when no certificate; DR 0004 line 3 extra withholding", basis: "published" },
    { ref: "CDOR, Colorado Wage Withholding Tax Guide (FYI Withholding)", covers: "deposits: quarterly under $7,000 a year, monthly by the 15th, weekly over $50,000 (third business day after the Friday of the payroll week); DR 1094 return", basis: "working-knowledge" },
    { ref: "CDLE 2026 UI premiums, as summarised by payroll publishers (Eddy, December 2025)", covers: "$30,600 wage base; 3.05% new-employer rate including the support surcharge", basis: "published" },
    { ref: "SB 25-144; FAMLI Division (as summarised by Ogletree and Fisher Phillips)", covers: "0.88% FAMLI premium for 2026, up to half from the employee; employers with fewer than 10 employees don't pay the employer half; up to the Social Security wage base", basis: "published" },
    { ref: "CDLE, 2026 minimum wage; Denver, Boulder and Edgewater ordinances (as reported in January 2026)", covers: "$15.16 statewide; Denver $19.29; Edgewater $18.17; City of Boulder and unincorporated Boulder County $16.82", basis: "published" },
    { ref: "COMPS Order #39 (as summarised by payroll publishers)", covers: "$57,784 exempt salary for 2026; overtime after 40 hours a week or 12 hours a day", basis: "published" },
    { ref: "C.R.S. 8-13.3-401 to 8-13.3-418 (Healthy Families and Workplaces Act)", covers: "1 hour of paid sick leave per 30 worked, up to 48 hours a year", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "An employee who files a DR 0004 has their line 2 allowance used as is, including zero. Without one, the allowance follows the federal W-4 status: $11,000 for married filing jointly, $5,500 otherwise; with neither form, single.",
    "Deposits: monthly by the 15th; weekly (third business day after the Friday of the payroll week) if more than $50,000 was withheld last year. Quarterly filers (under $7,000 a year) may pay monthly instead. CDOR's assigned frequency controls.",
    "UI rates are per employer: enter yours from the CDLE rate notice. New employers pay 3.05%.",
    "FAMLI: the employee pays 0.44% (half of 0.88%); employers with 10 or more employees pay the other 0.44% (enter it in payroll settings). TrailBook stops both at the Social Security wage base.",
    "Local occupational privilege taxes (Denver $5.75 a month from the employee and $4 from the employer; Aurora, Glendale, Greenwood Village, Sheridan) aren't calculated.",
    "Minimum wage depends on where the employee works: Denver, Edgewater and Boulder have higher rates. Choose the area on each employee.",
    "Daily overtime: TrailBook pays overtime after 12 hours a day as well as 40 a week; the 12-consecutive-hours rule isn't checked.",
    "Sales tax: TrailBook doesn't work out Colorado sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "DR 0004",
      statuses: [
        { id: "single", label: "Single or head of household (W-4)", standardDeduction: "5500", table: "all" },
        { id: "mfj", label: "Married filing jointly (W-4)", standardDeduction: "11000", table: "all" },
      ],
      noCertificateStatus: "single",
      statusFromW4: { single_or_mfs: "single", mfj: "mfj", hoh: "single" },
      allowances: [],
      dollarAllowance: { label: "DR 0004 line 2 allowance for the year ($)" },
      tables: { all: [{ over: "0", rate: "0.044" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "CDOR", code: "CO_WH", label: "Colorado income tax", account: "co_wh_payable" },
    taxes: [
      { code: "CO_FAMLI_EE", label: "Colorado FAMLI (employee)", agency: "FAMLI", paidBy: "employee", rate: "0.0044", wageBase: "184500", account: "co_famli_payable" },
      {
        code: "CO_UI", label: "Colorado UI", agency: "CDLE", paidBy: "employer", rate: "0.0305", wageBase: "30600", account: "co_ui_payable",
        assignedRate: { label: "Your Colorado UI rate (%)", hint: "The total rate on your CDLE rate notice, including the support surcharge. New employers pay 3.05%." },
      },
      {
        code: "CO_FAMLI_ER", label: "Colorado FAMLI (employer)", agency: "FAMLI", paidBy: "employer", rate: "0", wageBase: "184500", account: "co_famli_payable",
        assignedRate: { label: "Your FAMLI employer share (%)", hint: "Employers with 10 or more employees pay 0.44%; smaller employers pay nothing (leave this blank)." },
      },
    ],
    deposits: [
      {
        kind: "co_wh", codes: ["CO_WH"], agency: "CDOR", what: "Colorado withholding", where: "Revenue Online",
        schedule: "monthly_or_larger", lookbackOver: "50000", largeFiler: "weekly", dueDay: 15, report: "DR 1094",
      },
      { kind: "co_ui", codes: ["CO_UI"], agency: "CDLE", what: "Colorado UI", where: "MyUI Employer+", schedule: "quarterly", report: "UITR-1" },
      { kind: "co_famli", codes: ["CO_FAMLI_EE", "CO_FAMLI_ER"], agency: "FAMLI", what: "FAMLI premiums", where: "My FAMLI+ Employer", schedule: "quarterly", report: "FAMLI wage report" },
    ],
    employerAccount: { label: "Colorado UI employer account number", hint: "The number on your CDLE notices. It goes on the UITR-1. Withholding uses your Colorado Account Number from CDOR.", pattern: "^[0-9]{6,9}$" },
    accounts: [
      { code: "2340", name: "Colorado income tax payable", systemKey: "co_wh_payable" },
      { code: "2350", name: "Colorado UI payable", systemKey: "co_ui_payable" },
      { code: "2360", name: "Colorado FAMLI payable", systemKey: "co_famli_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "DR 1094", slug: "dr1094", title: "Colorado Wage Withholding Tax Return (DR 1094)", kind: "withholding_return", codes: ["CO_WH"], fileAt: "File and pay through Revenue Online" },
      { form: "UITR-1", slug: "uitr1", title: "Colorado UI Premium and Wage Report (UITR-1)", kind: "ui_wage_report", codes: ["CO_UI"], fileAt: "File and pay through MyUI Employer+" },
      { form: "FAMLI wage report", slug: "co-famli", title: "Colorado FAMLI Quarterly Wage Report", kind: "ui_wage_report", codes: ["CO_FAMLI_EE", "CO_FAMLI_ER"], fileAt: "File and pay through My FAMLI+ Employer" },
    ],
    w2Box14: [{ code: "CO_FAMLI_EE", label: "CO FAMLI" }],
  },
  wageHour: {
    minimumWage: "15.16",
    defaultAreaName: "Rest of Colorado",
    areas: [
      { name: "Denver", minimumWage: "19.29" },
      { name: "Edgewater", minimumWage: "18.17" },
      { name: "City of Boulder or unincorporated Boulder County", minimumWage: "16.82" },
    ],
    exemptAnnualSalaryMinimum: "57784",
    overtime: { weeklyAfter: "40", dailyAfter: "12" },
    sickLeave: { law: "Healthy Families and Workplaces Act (C.R.S. 8-13.3-401)", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "48", accrualCapHours: "48" },
    newHireReportDays: 20, newHireReportTo: "Colorado State Directory of New Hires",
  },
  business: { salesTax: null },
};
