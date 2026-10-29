import type { StateRulePack } from "./types.js";

// Oklahoma 2026. Withholding follows the Tax Commission's OW-2, 2026
// Oklahoma Income Tax Withholding Tables, read from it on 2026-10-29: the
// year's wages less $1,000 for each OK-W-4 allowance, through the annual
// percentage table (nothing up to $10,100 single or $20,200 married, then
// 2.5%, 3.5% and 4.5%), rounded to the whole dollar each paycheck. Released
// 2026-10-29 after Greg's review (docs/rule-pack-review.md).
export const usOklahoma2026: StateRulePack = {
  kind: "state",
  id: "us-ok",
  version: "2026.1",
  name: "Oklahoma",
  place: { country: "US", region: "OK" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "Oklahoma Tax Commission, OW-2, 2026 Oklahoma Income Tax Withholding Tables (Table 7, annual payroll period)", covers: "$1,000 per allowance; single 0% to $10,100, 2.5% to $11,250, 3.5% to $13,550, 4.5% above; married 0% to $20,200, then $22,500 and $27,100; married at the higher single rate uses the single table; round to the whole dollar; the $1,825 semi-monthly example ($37)", basis: "published" },
    { ref: "Same publication, General Information", covers: "quarterly by the 20th after the quarter up to $500 a quarter; monthly by the 20th of the next month; federal semi-weekly dates from an average of $10,000 a month last fiscal year", basis: "published" },
    { ref: "Oklahoma Employment Security Commission, Important Numbers for 2026", covers: "$25,000 wage base; 1.5% new-employer rate; rates 0.2% to 5.8%", basis: "published" },
    { ref: "40 O.S. 197.2 (minimum wage follows federal); 40 O.S. 4-101.1 (new hire reporting); no state paid sick leave law", covers: "$7.25 minimum wage; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "OK-W-4 status: single, married, or married withholding at the higher single rate. Allowances are $1,000 each. ⚠️ check: with no OK-W-4 on file TrailBook uses single with no allowances; the OW-2 doesn't say.",
    "TrailBook works out the year's tax from the annual table and divides it by the paychecks; the OW-2's per-period tables round their brackets, so results can differ by a few cents before rounding to the dollar.",
    "Deposits: TrailBook shows Oklahoma withholding monthly, due the 20th of the next month, and for employers averaging $10,000 a month last year on the federal deposit dates. Employers withholding $500 or less a quarter can pay quarterly, later than shown.",
    "UI rates are per employer: enter yours from the OESC rate notice. New employers pay 1.5%. The 2026 wage base fell to $25,000.",
    "Sales tax: TrailBook doesn't work out Oklahoma sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "OK-W-4",
      statuses: [
        { id: "single", label: "Single", standardDeduction: "0", table: "single" },
        { id: "married", label: "Married", standardDeduction: "0", table: "married" },
        { id: "married_single_rate", label: "Married, but withhold at the higher single rate", standardDeduction: "0", table: "single" },
      ],
      noCertificateStatus: "single",
      allowances: [{ label: "OK-W-4 allowances", amount: "1000" }],
      tables: {
        single: [{ over: "0", rate: "0" }, { over: "10100", rate: "0.025" }, { over: "11250", rate: "0.035" }, { over: "13550", rate: "0.045" }],
        married: [{ over: "0", rate: "0" }, { over: "20200", rate: "0.025" }, { over: "22500", rate: "0.035" }, { over: "27100", rate: "0.045" }],
      },
      round: "dollar",
    },
    incomeTaxAgency: { agency: "OTC", code: "OK_WH", label: "Oklahoma income tax", account: "ok_wh_payable" },
    taxes: [
      {
        code: "OK_UI", label: "Oklahoma UI", agency: "OESC", paidBy: "employer", rate: "0.015", wageBase: "25000", account: "ok_ui_payable",
        assignedRate: { label: "Your Oklahoma UI rate (%)", hint: "The rate on your OESC rate notice. New employers pay 1.5%." },
      },
    ],
    deposits: [
      { kind: "ok_wh", codes: ["OK_WH"], agency: "OTC", what: "Oklahoma withholding", where: "OkTAP", schedule: "monthly_or_larger", lookbackOver: "120000", largeFiler: "federal", dueDay: 20, report: "WTH 10001" },
      { kind: "ok_ui", codes: ["OK_UI"], agency: "OESC", what: "Oklahoma UI", where: "EZ Tax Express", schedule: "quarterly", report: "OES-3" },
    ],
    employerAccount: { label: "Oklahoma OESC employer account number", hint: "The number on your OESC notices. It goes on the OES-3. Withholding uses your OTC withholding account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Oklahoma income tax payable", systemKey: "ok_wh_payable" },
      { code: "2350", name: "Oklahoma UI payable", systemKey: "ok_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "OES-3", slug: "oes3", title: "Employer's Quarterly Contribution Report (OES-3)", kind: "ui_wage_report", codes: ["OK_UI"], fileAt: "File and pay through EZ Tax Express" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Oklahoma New Hire Reporting Center",
  },
  business: { salesTax: null },
};
