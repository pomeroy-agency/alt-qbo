import type { StateRulePack, WageRow } from "./types.js";

/** Rows `from + every * k` for k = 0 .. n-1, with amounts `first + step * k`. */
function steps(from: number, every: number, n: number, first: number, step: number): WageRow[] {
  return Array.from({ length: n }, (_, k) => ({ over: String(from + every * k), amount: String(first + step * k) }));
}

const zero: WageRow = { over: "0", amount: "0" };

/** TPG-211 Table E, personal tax credit shares: [more than, decimal]. */
const credit = (rows: [number, string][]): WageRow[] => rows.map(([over, amount]) => ({ over: String(over), amount }));

// Table B, initial tax, as marginal rates; codes A, D and F share one.
const tableB = (a: number) => [
  { over: "0", rate: "0.02" }, { over: String(10000 * a), rate: "0.045" }, { over: String(50000 * a), rate: "0.055" },
  { over: String(100000 * a), rate: "0.06" }, { over: String(200000 * a), rate: "0.065" }, { over: String(250000 * a), rate: "0.069" },
  { over: String(500000 * a), rate: "0.0699" },
];

// Table D, tax recapture: codes A, D and F share one; B is 1.6 times and C twice A's wages.
const recapture = (a: number, unit: number, mid: number, midStep: number, top: number, topStep: number) => [
  zero, ...steps(105000 * a, 5000 * a, 9, unit, unit), { over: String(150000 * a), amount: String(unit * 10) },
  ...steps(200000 * a, 5000 * a, 30, mid, midStep), ...steps(500000 * a, 5000 * a, 9, top, topStep),
];

const recaptureA = recapture(1, 25, 340, 90, 3000, 50);
const recaptureB = recapture(1.6, 40, 540, 140, 4680, 80);
const recaptureC = recapture(2, 50, 680, 180, 6000, 100);

// Connecticut 2026. Withholding follows DRS TPG-211, 2026 Withholding
// Calculation Rules (Rev. 12/25), unchanged from 2025, read from it on
// 2026-10-29: by CT-W4 withholding code, the year's wages less the personal
// exemption from Table A, tax from Table B, plus the 2% phase-out add-back
// (Table C) and tax recapture (Table D), less the personal tax credit share
// (Table E). No CT-W4: 6.99% of wages. Connecticut Paid Leave takes 0.5% of
// wages from employees. Drafted 2026-10-29 for Greg's review
// (docs/rule-pack-review.md).
export const usConnecticut2026: StateRulePack = {
  kind: "state",
  id: "us-ct",
  version: "2026.1",
  name: "Connecticut",
  place: { country: "US", region: "CT" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Connecticut DRS, TPG-211, 2026 Withholding Calculation Rules (Rev. 12/25)", covers: "Tables A to E by withholding code A, B, C, D and F; steps 1 to 16", basis: "published" },
    { ref: "Connecticut DRS, 2026 Withholding Tables (weekly)", covers: "checks of the calculation: $807 to $817 a week is $28.56 for code A and $31.73 for code D", basis: "published" },
    { ref: "Connecticut DRS, IP 2026(1), Connecticut Employer's Tax Guide (Circular CT)", covers: "no CT-W4: 6.99% with no exemption; weekly remitters (over $10,000 last year) by the Wednesday after the Saturday-to-Friday week; monthly ($2,000 to $10,000) by the 15th; quarterly ($2,000 or less); CT-941 by the last day of the month after the quarter", basis: "published" },
    { ref: "Connecticut Department of Labor, Information on Unemployment Tax Rate for Calendar Year 2026", covers: "$27,000 wage base; 1.9% new-employer rate; 1.0% fund solvency tax rate", basis: "published" },
    { ref: "Connecticut Paid Leave Authority, as reported by payroll publishers", covers: "0.5% employee contribution up to the Social Security wage base ($184,500)", basis: "working-knowledge" },
    { ref: "Core-CT notice, minimum wage increase (January 2, 2026); Connecticut DOL Paid Sick Leave guidance (C.G.S. 31-57r)", covers: "$16.94 minimum wage from January 1, 2026; 1 hour of paid sick leave per 30 worked, up to 40 a year, for employers with 11 or more employees from 2026", basis: "published" },
  ],
  reviewNotes: [
    "CT-W4 withholding code: A (married filing separately, or single with no dependents), B (head of household), C (married filing jointly, spouse doesn't work), D (no exemption or credit), F (single, married separately or with a working spouse, who wants more withheld: the head of household style rates at the single exemption). Code E (no withholding needed) is the exempt box.",
    "No CT-W4 on file: \"Not filed\", 6.99% of wages with no exemption, as IP 2026(1) says.",
    "CT-W4 line 3 (reduced withholding per paycheck) isn't supported; only extra withholding (line 2) is.",
    "Connecticut Paid Leave: 0.5% of each employee's wages up to the Social Security wage base, paid quarterly to the CT Paid Leave Authority. TrailBook shows it in W-2 box 14 as CTPL.",
    "Deposits: monthly by the 15th of the next month, or weekly (by the Wednesday after the Saturday-to-Friday week; TrailBook uses the third business day after the Friday) once last year's withholding was over $10,000. Quarterly remitters ($2,000 or less) can pay later than shown.",
    "UI rates are per employer: enter yours from the Connecticut DOL rate notice. New employers pay 1.9%. ⚠️ check: whether the 1.0% fund solvency tax is added to the new-employer rate for 2026; if it is, enter 2.9%.",
    "Paid sick leave: from 2026 employers with 11 or more employees must give 1 hour per 30 worked, up to 40 hours a year. TrailBook doesn't accrue it for employers with fewer than 11 employees. From 2027 it covers employers with 1 or more.",
    "Sales tax: TrailBook doesn't work out Connecticut sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "CT-W4",
      statuses: [
        {
          id: "A", label: "A", standardDeduction: "12000", deductionByWages: [{ over: "0", amount: "12000" }, ...steps(24000, 1000, 12, 11000, -1000)], table: "a",
          taxAdditions: [[zero, ...steps(50250, 2500, 10, 25, 25)], recaptureA],
          creditShare: credit([[12000, ".75"], [15000, ".70"], [15500, ".65"], [16000, ".60"], [16500, ".55"], [17000, ".50"], [17500, ".45"], [18000, ".40"], [18500, ".35"], [20000, ".30"], [20500, ".25"], [21000, ".20"], [21500, ".15"], [25000, ".14"], [25500, ".13"], [26000, ".12"], [26500, ".11"], [27000, ".10"], [48000, ".09"], [48500, ".08"], [49000, ".07"], [49500, ".06"], [50000, ".05"], [50500, ".04"], [51000, ".03"], [51500, ".02"], [52000, ".01"], [52500, "0"]]),
        },
        {
          id: "B", label: "B", standardDeduction: "19000", deductionByWages: [{ over: "0", amount: "19000" }, ...steps(38000, 1000, 19, 18000, -1000)], table: "b",
          taxAdditions: [[zero, ...steps(78500, 4000, 10, 40, 40)], recaptureB],
          creditShare: credit([[19000, ".75"], [24000, ".70"], [24500, ".65"], [25000, ".60"], [25500, ".55"], [26000, ".50"], [26500, ".45"], [27000, ".40"], [27500, ".35"], [34000, ".30"], [34500, ".25"], [35000, ".20"], [35500, ".15"], [44000, ".14"], [44500, ".13"], [45000, ".12"], [45500, ".11"], [46000, ".10"], [74000, ".09"], [74500, ".08"], [75000, ".07"], [75500, ".06"], [76000, ".05"], [76500, ".04"], [77000, ".03"], [77500, ".02"], [78000, ".01"], [78500, "0"]]),
        },
        {
          id: "C", label: "C", standardDeduction: "24000", deductionByWages: [{ over: "0", amount: "24000" }, ...steps(48000, 1000, 24, 23000, -1000)], table: "c",
          taxAdditions: [[zero, ...steps(100500, 5000, 10, 50, 50)], recaptureC],
          creditShare: credit([[24000, ".75"], [30000, ".70"], [30500, ".65"], [31000, ".60"], [31500, ".55"], [32000, ".50"], [32500, ".45"], [33000, ".40"], [33500, ".35"], [40000, ".30"], [40500, ".25"], [41000, ".20"], [41500, ".15"], [50000, ".14"], [50500, ".13"], [51000, ".12"], [51500, ".11"], [52000, ".10"], [96000, ".09"], [96500, ".08"], [97000, ".07"], [97500, ".06"], [98000, ".05"], [98500, ".04"], [99000, ".03"], [99500, ".02"], [100000, ".01"], [100500, "0"]]),
        },
        {
          id: "D", label: "D", standardDeduction: "0", table: "a",
          taxAdditions: [[zero, ...steps(50250, 2500, 10, 25, 25)], recaptureA],
        },
        {
          id: "F", label: "F", standardDeduction: "15000", deductionByWages: [{ over: "0", amount: "15000" }, ...steps(30000, 1000, 15, 14000, -1000)], table: "a",
          taxAdditions: [[zero, ...steps(56500, 5000, 10, 25, 25)], recaptureA],
          creditShare: credit([[15000, ".75"], [18800, ".70"], [19300, ".65"], [19800, ".60"], [20300, ".55"], [20800, ".50"], [21300, ".45"], [21800, ".40"], [22300, ".35"], [25000, ".30"], [25500, ".25"], [26000, ".20"], [26500, ".15"], [31300, ".14"], [31800, ".13"], [32300, ".12"], [32800, ".11"], [33300, ".10"], [60000, ".09"], [60500, ".08"], [61000, ".07"], [61500, ".06"], [62000, ".05"], [62500, ".04"], [63000, ".03"], [63500, ".02"], [64000, ".01"], [64500, "0"]]),
        },
        { id: "not_filed", label: "Not filed (flat 6.99%)", standardDeduction: "0", table: "a", flatRate: "0.0699" },
      ],
      noCertificateStatus: "not_filed",
      allowances: [],
      tables: { a: tableB(1), b: tableB(1.6), c: tableB(2) },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Connecticut DRS", code: "CT_WH", label: "Connecticut income tax", account: "ct_wh_payable" },
    taxes: [
      { code: "CT_PL", label: "Connecticut Paid Leave", agency: "CT Paid Leave Authority", paidBy: "employee", rate: "0.005", wageBase: "184500", account: "ct_pl_payable" },
      {
        code: "CT_UI", label: "Connecticut UI", agency: "CT DOL", paidBy: "employer", rate: "0.019", wageBase: "27000", account: "ct_ui_payable",
        assignedRate: { label: "Your Connecticut UI rate (%)", hint: "The total rate on your Connecticut DOL rate notice, including any fund solvency tax. New employers pay 1.9%." },
      },
    ],
    deposits: [
      { kind: "ct_wh", codes: ["CT_WH"], agency: "Connecticut DRS", what: "Connecticut withholding", where: "myconneCT", schedule: "monthly_or_larger", lookbackOver: "10000", largeFiler: "weekly", dueDay: 15, report: "CT-941" },
      { kind: "ct_ui", codes: ["CT_UI"], agency: "CT DOL", what: "Connecticut UI", where: "ReEmployCT", schedule: "quarterly", report: "UC-2" },
      { kind: "ct_pl", codes: ["CT_PL"], agency: "CT Paid Leave Authority", what: "Connecticut Paid Leave contributions", where: "CT Paid Leave employer portal", schedule: "quarterly", report: "Paid Leave wage report" },
    ],
    employerAccount: { label: "Connecticut DOL employer registration number", hint: "The number on your Connecticut DOL notices. It goes on the UC-2. Withholding uses your DRS tax registration number.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Connecticut income tax payable", systemKey: "ct_wh_payable" },
      { code: "2350", name: "Connecticut UI payable", systemKey: "ct_ui_payable" },
      { code: "2360", name: "Connecticut Paid Leave payable", systemKey: "ct_pl_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "CT-941", slug: "ct941", title: "Connecticut Quarterly Reconciliation of Withholding (CT-941)", kind: "withholding_return", codes: ["CT_WH"], fileAt: "File through myconneCT" },
      { form: "UC-2", slug: "uc2", title: "Employer Contribution Return (UC-2)", kind: "ui_wage_report", codes: ["CT_UI"], fileAt: "File and pay through ReEmployCT" },
      { form: "CT Paid Leave", slug: "ct-pl", title: "Connecticut Paid Leave quarterly wage report", kind: "ui_wage_report", codes: ["CT_PL"], fileAt: "File and pay through the CT Paid Leave employer portal" },
    ],
    w2Box14: [{ code: "CT_PL", label: "CTPL" }],
  },
  wageHour: {
    minimumWage: "16.94",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: {
      law: "Paid Sick Leave (C.G.S. 31-57r)", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "40", accrualCapHours: "40",
      smallEmployer: { under: 11, annualUseCapHours: "0", accrualCapHours: "0" },
    },
    newHireReportDays: 20, newHireReportTo: "Connecticut New Hire Reporting Program",
  },
  business: { salesTax: null },
};
