import type { StateRulePack } from "./types.js";

// Utah 2026. Utah has no state certificate: withholding uses the federal W-4
// filing status. It's 4.45% of wages less a base allowance credit that shrinks
// by 1.3% of wages above a threshold (Publication 14, revised for S.B. 60, for
// payroll periods from June 1, 2026). Publication 14 itself couldn't be
// opened from TrailBook's build machines; the figures come from payroll
// publishers and are marked for checking. Draft until Greg reviews it
// (docs/rule-pack-review.md).
export const usUtah2026: StateRulePack = {
  kind: "state",
  id: "us-ut",
  version: "2026.1",
  name: "Utah",
  place: { country: "US", region: "UT" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Utah Publication 14 (revised for S.B. 60, payroll periods from June 1, 2026), as reported by EY Tax News (May 11, 2026), Bloomberg Tax and the USDA National Finance Center", covers: "4.45% rate; base allowance $485 single / $970 married a year; reduced by 1.3% of wages above $9,348 single / $18,696 married; status from the federal W-4 (married only for married filing jointly); no subtraction for W-4 allowances", basis: "published" },
    { ref: "Utah Tax Commission, withholding filing frequency", covers: "monthly payments for $1,000 or more a month, due the last day of the next month; quarterly otherwise; TC-941", basis: "working-knowledge" },
    { ref: "Utah DWS 2026 UI rates, as summarised by payroll publishers", covers: "$50,700 wage base; new-employer rate by industry (about 1.2%)", basis: "published" },
    { ref: "Utah Code 34-40-103 (minimum wage follows the federal $7.25)", covers: "$7.25 minimum wage; no state paid sick leave law", basis: "working-knowledge" },
    { ref: "Utah Code 35A-7-103 (new hire reporting)", covers: "report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Check against Publication 14 itself: TrailBook's build machines couldn't open it (files.tax.utah.gov is blocked to them), so these figures are from payroll publishers.",
    "Payroll periods before June 1, 2026 used 4.5% and a $450 / $900 base allowance; TrailBook uses the current figures for the whole year.",
    "Status comes from the federal W-4: married filing jointly uses the married figures; single, married filing separately and head of household use the single ones. W-4 allowances and extra withholding don't change Utah withholding.",
    "The base allowance is worked out on the year's wages and divided by the pay periods; Publication 14's per-period figures are rounded, so amounts can differ by a few cents.",
    "Deposits: monthly by the end of the next month. Quarterly filers (under $1,000 a month) may pay monthly. The Tax Commission's assigned frequency controls.",
    "UI rates are per employer and new-employer rates depend on the industry: enter yours from the DWS rate notice.",
    "Sales tax: TrailBook doesn't work out Utah sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: null,
      statuses: [
        { id: "single", label: "Single", standardDeduction: "0", table: "all", credit: { base: "485", phaseOutFrom: "9348", phaseOutRate: "0.013" } },
        { id: "married", label: "Married filing jointly", standardDeduction: "0", table: "all", credit: { base: "970", phaseOutFrom: "18696", phaseOutRate: "0.013" } },
      ],
      noCertificateStatus: "single",
      statusFromW4: { single_or_mfs: "single", mfj: "married", hoh: "single" },
      allowances: [],
      tables: { all: [{ over: "0", rate: "0.0445" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "USTC", code: "UT_WH", label: "Utah income tax", account: "ut_wh_payable" },
    taxes: [
      {
        code: "UT_UI", label: "Utah UI", agency: "DWS", paidBy: "employer", rate: "0.012", wageBase: "50700", account: "ut_ui_payable",
        assignedRate: { label: "Your Utah UI rate (%)", hint: "It's on the rate notice DWS sends each year. New employers' rates depend on the industry." },
      },
    ],
    deposits: [
      {
        kind: "ut_wh", codes: ["UT_WH"], agency: "USTC", what: "Utah withholding", where: "Taxpayer Access Point (TAP)",
        schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: "last", report: "TC-941",
      },
      { kind: "ut_ui", codes: ["UT_UI"], agency: "DWS", what: "Utah UI", where: "DWS employer account", schedule: "quarterly", report: "Form 3" },
    ],
    employerAccount: { label: "Utah DWS UI registration number", hint: "The number on your Department of Workforce Services notices. It goes on Form 3. Withholding uses your Utah withholding account ID.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Utah income tax payable", systemKey: "ut_wh_payable" },
      { code: "2350", name: "Utah UI payable", systemKey: "ut_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "TC-941", slug: "tc941", title: "Utah Withholding Return (TC-941)", kind: "withholding_return", codes: ["UT_WH"], fileAt: "File and pay through Taxpayer Access Point (TAP)" },
      { form: "Form 3", slug: "ut-form3", title: "Employer Quarterly Contribution Report (Form 3)", kind: "ui_wage_report", codes: ["UT_UI"], fileAt: "File and pay through your DWS employer account" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Utah Department of Workforce Services (New Hire Registry)",
  },
  business: { salesTax: null },
};
