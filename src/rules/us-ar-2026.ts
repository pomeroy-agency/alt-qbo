import type { StateRulePack } from "./types.js";

/** Arkansas's 3.7% top bracket: the adjustment shrinks by $10 for each $100 from $94,701, so the top rate catches up. */
const topRows = Array.from({ length: 30 }, (_, k) => ({ over: String(94701 + 100 * k), rate: "0.037", subtract: (369.9 - 10 * k).toFixed(2) }));

// Arkansas 2026. Withholding follows the Department of Finance and
// Administration's Withholding Tax Formula Method (effective 01/01/2026,
// revised May 2026 for the 3.7% top rate), read from it on 2026-10-29: the
// year's wages less the $2,470 standard deduction, looked up at the $50
// midpoint of each $100 below $100,001, times the bracket rate less its
// adjustment, rounded to the dollar, less $29 for each AR4EC exemption.
// Drafted 2026-10-29 for Greg's review (docs/rule-pack-review.md).
export const usArkansas2026: StateRulePack = {
  kind: "state",
  id: "us-ar",
  version: "2026.1",
  name: "Arkansas",
  place: { country: "US", region: "AR" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Arkansas DFA, Withholding Tax Formula Method, effective 01/01/2026 (revised May 2026)", covers: "$2,470 standard deduction; $50 midrange lookup below $100,001; 0% to $5,599, 2% less $111.98, 3% less $223.97, 3.4% less $287.97, 3.7% less $367.16 from $26,400, then the adjustment falls $10 for each $100 from $94,701 ($369.90) to $97,601 ($79.90); round the year's tax; $29 credit per AR4EC exemption; the $2,127 monthly example ($36.50)", basis: "published" },
    { ref: "Arkansas DFA, Withholding Tax Employer's Instructions (revised 4/27/26) and Form AR4EC (R 12/04/2025)", covers: "monthly AR941M by the 15th of the next month for all new accounts; annual AR941A by January 31 once deposits are under $1,000; AR3MAR by February 28; no AR4EC means no exemptions; low-income tax rates by election on AR4EC line 5", basis: "published" },
    { ref: "Payroll publishers on Arkansas Division of Workforce Services 2026 rates (dws.arkansas.gov isn't reachable from here)", covers: "$7,000 wage base; 2.0% new-employer rate including the administrative assessment", basis: "working-knowledge" },
    { ref: "Ark. Code 11-4-210 (minimum wage $11.00); Ark. Code 11-10-904 (new hire reporting); no state paid sick leave law", covers: "$11.00 minimum wage; report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Arkansas cut its top rate to 3.7% back to January 1, 2026; the DFA reissued the formula in May 2026 under the same 01/01/2026 date. TrailBook uses the revised formula for the whole year.",
    "AR4EC: the total exemptions (line 3), each a $29 credit. Filing status doesn't change the formula. No AR4EC on file: no exemptions, as the form says.",
    "⚠️ check: AR4EC line 5 (low-income tax rates) isn't supported yet. TrailBook withholds at the regular rates for employees who tick it, which withholds more than the low-income tables would.",
    "Deposits: TrailBook shows Arkansas withholding monthly (AR941M), due the 15th of the next month. Accounts the DFA moves to annual filing (deposits under $1,000) can pay by January 31 instead, later than shown.",
    "UI rates are per employer: enter yours from the Division of Workforce Services rate notice. ⚠️ check: the $7,000 wage base and 2.0% new-employer rate are from payroll publishers; dws.arkansas.gov isn't reachable from here.",
    "Sales tax: TrailBook doesn't work out Arkansas sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "AR4EC",
      statuses: [{ id: "all", label: "AR4EC on file", standardDeduction: "2470", table: "all" }],
      noCertificateStatus: "all",
      allowances: [{ label: "AR4EC exemptions ($29 credit each)", amount: "29", credit: true }],
      tables: {
        all: [
          { over: "0", rate: "0", subtract: "0" }, { over: "5600", rate: "0.02", subtract: "111.98" }, { over: "11200", rate: "0.03", subtract: "223.97" },
          { over: "16000", rate: "0.034", subtract: "287.97" }, { over: "26400", rate: "0.037", subtract: "367.16" }, ...topRows,
        ],
      },
      taxableMidpoint: { step: "100", below: "100001" },
      round: "annual_dollar",
    },
    incomeTaxAgency: { agency: "Arkansas DFA", code: "AR_WH", label: "Arkansas income tax", account: "ar_wh_payable" },
    taxes: [
      {
        code: "AR_UI", label: "Arkansas UI", agency: "Arkansas DWS", paidBy: "employer", rate: "0.02", wageBase: "7000", account: "ar_ui_payable",
        assignedRate: { label: "Your Arkansas UI rate (%)", hint: "The total rate on your Division of Workforce Services rate notice, including the administrative assessment. New employers pay about 2.0%." },
      },
    ],
    deposits: [
      { kind: "ar_wh", codes: ["AR_WH"], agency: "Arkansas DFA", what: "Arkansas withholding", where: "Arkansas Taxpayer Access Point (ATAP)", schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 15, report: "AR941M" },
      { kind: "ar_ui", codes: ["AR_UI"], agency: "Arkansas DWS", what: "Arkansas UI", where: "Arkansas DWS employer portal", schedule: "quarterly", report: "DWS-ARK-209B" },
    ],
    employerAccount: { label: "Arkansas DWS employer account number", hint: "The number on your Division of Workforce Services notices. It goes on the quarterly wage report. Withholding uses your DFA withholding account.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Arkansas income tax payable", systemKey: "ar_wh_payable" },
      { code: "2350", name: "Arkansas UI payable", systemKey: "ar_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "DWS-ARK-209B", slug: "ar-ui", title: "Employer's Quarterly Contribution Report (DWS-ARK-209B)", kind: "ui_wage_report", codes: ["AR_UI"], fileAt: "File and pay through the Arkansas DWS employer portal" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "11.00",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Arkansas New Hire Reporting Center",
  },
  business: { salesTax: null },
};
