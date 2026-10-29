import type { StateRulePack } from "./types.js";

// Idaho 2026. Withholding follows the percentage computation tables
// (EPB00744, 07-23-2026), read from the table itself on 2026-10-29: 5.3% of
// wages above $16,100 a year (single and head of household) or $32,200
// (married). The Idaho child tax credit ended, so ID W-4 allowances no longer
// reduce withholding from July 31, 2026; this pack has only the current
// figures. Draft until Greg reviews it (docs/rule-pack-review.md).
export const usIdaho2026: StateRulePack = {
  kind: "state",
  id: "us-id",
  version: "2026.1",
  name: "Idaho",
  place: { country: "US", region: "ID" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Idaho State Tax Commission, EPB00744 (07-23-2026), Table for Percentage Computation Method of Withholding; press release July 31, 2026", covers: "5.3% over $16,100 single / $32,200 married a year ($1,342 / $2,683 monthly); child tax credit allowances no longer apply (Idaho Code 63-3029L)", basis: "published" },
    { ref: "Idaho State Tax Commission, Withholding Due Dates", covers: "monthly filers pay by the 20th of the next month; semimonthly, quarterly and annual filers on their own dates; Form 910", basis: "published" },
    { ref: "Idaho Department of Labor 2026 UI rates, as summarised by payroll publishers", covers: "$58,300 wage base; 1.0% new-employer rate", basis: "published" },
    { ref: "Idaho Code 44-1502 (minimum wage)", covers: "$7.25 minimum wage; no state paid sick leave law", basis: "working-knowledge" },
    { ref: "Idaho Code 72-1601 (new hire reporting)", covers: "report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Pay runs before July 31, 2026 used tables that subtracted child tax credit allowances; TrailBook uses the current tables for the whole year.",
    "No ID W-4 on file: single. Married withholding at the single rate uses the single figures.",
    "Deposits: monthly by the 20th of the next month. Semimonthly filers (the 20th and the 5th) and quarterly or annual filers have other dates; the Tax Commission's assigned frequency controls.",
    "UI rates are per employer: enter yours from the Idaho Department of Labor rate notice. New employers pay 1.0%.",
    "Sales tax: TrailBook doesn't work out Idaho sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "ID W-4",
      statuses: [
        { id: "single", label: "Single or head of household", standardDeduction: "16100", table: "all" },
        { id: "married", label: "Married", standardDeduction: "32200", table: "all" },
        { id: "married_single_rate", label: "Married, but withhold at the single rate", standardDeduction: "16100", table: "all" },
      ],
      noCertificateStatus: "single",
      allowances: [],
      tables: { all: [{ over: "0", rate: "0.053" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "ISTC", code: "ID_WH", label: "Idaho income tax", account: "id_wh_payable" },
    taxes: [
      {
        code: "ID_UI", label: "Idaho UI", agency: "IDOL", paidBy: "employer", rate: "0.01", wageBase: "58300", account: "id_ui_payable",
        assignedRate: { label: "Your Idaho UI rate (%)", hint: "The total on your Idaho Department of Labor rate notice. New employers pay 1.0%." },
      },
    ],
    deposits: [
      {
        kind: "id_wh", codes: ["ID_WH"], agency: "ISTC", what: "Idaho withholding", where: "Taxpayer Access Point (TAP)",
        schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 20, report: "Form 910",
      },
      { kind: "id_ui", codes: ["ID_UI"], agency: "IDOL", what: "Idaho UI", where: "Idaho Department of Labor employer portal", schedule: "quarterly", report: "TAX020" },
    ],
    employerAccount: { label: "Idaho UI account number", hint: "The number on your Idaho Department of Labor notices. It goes on the quarterly UI report. Withholding uses your Idaho withholding account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Idaho income tax payable", systemKey: "id_wh_payable" },
      { code: "2350", name: "Idaho UI payable", systemKey: "id_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "Form 910", slug: "id910", title: "Idaho Withholding Payment Voucher (Form 910)", kind: "withholding_return", codes: ["ID_WH"], fileAt: "File and pay through Taxpayer Access Point (TAP)" },
      { form: "TAX020", slug: "tax020", title: "Idaho Quarterly Unemployment Insurance Tax Report", kind: "ui_wage_report", codes: ["ID_UI"], fileAt: "File and pay through the Idaho Department of Labor employer portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Idaho Department of Labor (New Hire Reporting)",
  },
  business: { salesTax: null },
};
