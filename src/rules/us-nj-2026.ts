import type { StateRulePack } from "./types.js";

// New Jersey 2026. Withholding follows the percentage tables in NJ-WT
// (September 2025) and the rate tables effective January 1, 2026, read from
// the Division of Taxation's own files on 2026-10-29: the year's wages less
// $1,000 for each NJ-W4 allowance, through Rate table A (single or
// married/CU filing separately), B (joint, head of household, surviving
// spouse) or the table the employee picks on line 3. Employee UI, disability
// and family leave contributions come from the NJDOL rate page. Released
// 2026-10-29 after Greg's review (docs/rule-pack-review.md).
const top = [{ over: "500000", rate: "0.099" }, { over: "1000000", rate: "0.118" }];
export const usNewJersey2026: StateRulePack = {
  kind: "state",
  id: "us-nj",
  version: "2026.1",
  name: "New Jersey",
  place: { country: "US", region: "NJ" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "NJ Division of Taxation, NJ-WT (September 2025), Which Rate Table to Use and the allowance value table", covers: "Rate A for NJ-W4 boxes 1 and 3, Rate B for boxes 2, 4 and 5, or the table chosen on line 3; $1,000 a year per allowance", basis: "published" },
    { ref: "NJ Division of Taxation, New Jersey Gross Income Tax Withholding Rate Tables, annual payroll period, Rates A to E", covers: "the bracket rates from 1.5% to 11.8%", basis: "published" },
    { ref: "NJ Division of Taxation, NJ-WT, payment schedules", covers: "monthly NJ-500 payments by the 15th; NJ-927 each quarter; weekly payments for $10,000 or more withheld in the prior year", basis: "published" },
    { ref: "NJDOL, Employer Services rate information (nj.gov/labor), 2026", covers: "worker UI 0.3825%, WF/SWF 0.0425%, DI 0.19%, FLI 0.23%; new employer UI 2.6825%, DI 0.5%, WF/SWF 0.1175%; $44,800 wage base (UI, WF/SWF and employer DI), $171,100 for worker DI and FLI; NJ-927 and WR-30 due the 30th after the quarter with no weekend extension", basis: "published" },
    { ref: "NJDOL press release, October 1, 2025", covers: "$15.92 minimum wage from January 1, 2026; $15.23 for seasonal employers and those with fewer than 6 employees", basis: "published" },
    { ref: "N.J.S.A. 34:11D (Earned Sick Leave Law)", covers: "1 hour per 30 worked, up to 40 hours a year", basis: "working-knowledge" },
    { ref: "N.J.S.A. 2A:17-56.61 (new hire reporting)", covers: "report new hires within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "No NJ-W4 on file: Rate A with no allowances. NJ-WT says only that tax must be withheld; Rate A with none is the usual reading.",
    "TrailBook works the rate tables over the year, so amounts can differ from the weekly or biweekly tables by a few cents.",
    "Employee contributions: UI and WF/SWF together (0.425%) on the first $44,800, and disability (0.19%) and family leave (0.23%) on the first $171,100. They show on the W-2 in box 14.",
    "Employer UI and disability rates are per employer: enter yours from the NJDOL rate notice (new employers pay 2.6825% and 0.5%). The 0.1175% WF/SWF share is the same for everyone. Rates run July to June; update them each July.",
    "Withholding is paid monthly by the 15th (NJ-500), or weekly for $10,000 or more withheld last year. The NJ-927 and WR-30 are due the 30th after the quarter, and New Jersey doesn't extend that for weekends, so TrailBook moves the date back to the business day before.",
    "Minimum wage: pick \"Seasonal or fewer than 6 employees\" as the work area for those employers ($15.23). Farm and tipped rates aren't modelled.",
    "Pennsylvania residents who file an NJ-165 are withheld for Pennsylvania instead; TrailBook doesn't handle the reciprocal agreement yet.",
    "Sales tax: TrailBook doesn't work out New Jersey sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "NJ-W4",
      statuses: [
        { id: "rate_a", label: "Single, or married/civil union partner filing separately (Rate A)", standardDeduction: "0", table: "a" },
        { id: "rate_b", label: "Married/civil union joint, head of household or surviving spouse (Rate B)", standardDeduction: "0", table: "b" },
        { id: "rate_c", label: "Rate C, chosen on line 3", standardDeduction: "0", table: "c" },
        { id: "rate_d", label: "Rate D, chosen on line 3", standardDeduction: "0", table: "d" },
        { id: "rate_e", label: "Rate E, chosen on line 3", standardDeduction: "0", table: "e" },
      ],
      noCertificateStatus: "rate_a",
      allowances: [{ label: "NJ-W4 allowances", amount: "1000" }],
      tables: {
        a: [{ over: "0", rate: "0.015" }, { over: "20000", rate: "0.02" }, { over: "35000", rate: "0.039" }, { over: "40000", rate: "0.061" }, { over: "75000", rate: "0.07" }, ...top],
        b: [{ over: "0", rate: "0.015" }, { over: "20000", rate: "0.02" }, { over: "50000", rate: "0.027" }, { over: "70000", rate: "0.039" }, { over: "80000", rate: "0.061" }, { over: "150000", rate: "0.07" }, ...top],
        c: [{ over: "0", rate: "0.015" }, { over: "20000", rate: "0.023" }, { over: "40000", rate: "0.028" }, { over: "50000", rate: "0.035" }, { over: "60000", rate: "0.056" }, { over: "150000", rate: "0.066" }, ...top],
        d: [{ over: "0", rate: "0.015" }, { over: "20000", rate: "0.027" }, { over: "40000", rate: "0.034" }, { over: "50000", rate: "0.043" }, { over: "60000", rate: "0.056" }, { over: "150000", rate: "0.065" }, ...top],
        e: [{ over: "0", rate: "0.015" }, { over: "20000", rate: "0.02" }, { over: "35000", rate: "0.058" }, { over: "100000", rate: "0.065" }, ...top],
      },
      round: "cent",
    },
    incomeTaxAgency: { agency: "NJ Taxation", code: "NJ_WH", label: "New Jersey income tax", account: "nj_wh_payable" },
    taxes: [
      { code: "NJ_UIWF_EE", label: "New Jersey UI/WF (employee)", agency: "NJDOL", paidBy: "employee", rate: "0.00425", wageBase: "44800", account: "nj_ui_payable" },
      { code: "NJ_DI_EE", label: "New Jersey disability (employee)", agency: "NJDOL", paidBy: "employee", rate: "0.0019", wageBase: "171100", account: "nj_ui_payable" },
      { code: "NJ_FLI_EE", label: "New Jersey family leave (employee)", agency: "NJDOL", paidBy: "employee", rate: "0.0023", wageBase: "171100", account: "nj_ui_payable" },
      {
        code: "NJ_UI_ER", label: "New Jersey UI", agency: "NJDOL", paidBy: "employer", rate: "0.026825", wageBase: "44800", account: "nj_ui_payable",
        assignedRate: { label: "Your New Jersey UI rate (%)", hint: "It's on the NJDOL contribution rate notice (July to June). New employers pay 2.6825%." },
      },
      { code: "NJ_WF_ER", label: "New Jersey WF/SWF (employer)", agency: "NJDOL", paidBy: "employer", rate: "0.001175", wageBase: "44800", account: "nj_ui_payable" },
      {
        code: "NJ_DI_ER", label: "New Jersey disability (employer)", agency: "NJDOL", paidBy: "employer", rate: "0.005", wageBase: "44800", account: "nj_ui_payable",
        assignedRate: { label: "Your New Jersey disability rate (%)", hint: "It's on the NJDOL contribution rate notice. New employers pay 0.5%. Leave blank if you have an approved private plan." },
      },
    ],
    deposits: [
      {
        kind: "nj_wh", codes: ["NJ_WH"], agency: "NJ Taxation", what: "New Jersey withholding", where: "NJ Division of Revenue online services",
        schedule: "monthly_or_larger", lookbackOver: "9999.99", largeFiler: "weekly", dueDay: 15, report: "NJ-500",
      },
      {
        kind: "nj_ui", codes: ["NJ_UIWF_EE", "NJ_DI_EE", "NJ_FLI_EE", "NJ_UI_ER", "NJ_WF_ER", "NJ_DI_ER"], agency: "NJDOL", what: "New Jersey UI, disability and family leave",
        where: "NJ Division of Revenue online services", schedule: "quarterly", report: "NJ-927", dueDay: 30, noWeekendExtension: true,
      },
    ],
    employerAccount: { label: "New Jersey employer ID", hint: "Your federal EIN followed by 000, as on your NJ-927.", pattern: "^[0-9]{9}([0-9]{3})?$" },
    accounts: [
      { code: "2340", name: "New Jersey income tax payable", systemKey: "nj_wh_payable" },
      { code: "2350", name: "New Jersey UI, disability and family leave payable", systemKey: "nj_ui_payable" },
    ],
  },
  forms: {
    quarterly: [
      {
        form: "NJ-927", slug: "nj927", title: "Employer's Quarterly Report (NJ-927) and WR-30", kind: "combined_return",
        codes: ["NJ_UIWF_EE", "NJ_DI_EE", "NJ_FLI_EE", "NJ_UI_ER", "NJ_WF_ER", "NJ_DI_ER"], withholdingCodes: ["NJ_WH"],
        fileAt: "File the NJ-927 and WR-30 through NJ Division of Revenue online services", dueDay: 30, noWeekendExtension: true,
      },
    ],
    w2Box14: [{ code: "NJ_UIWF_EE", label: "NJ UI/WF/SWF" }, { code: "NJ_DI_EE", label: "NJ DI" }, { code: "NJ_FLI_EE", label: "NJ FLI" }],
  },
  wageHour: {
    minimumWage: "15.92",
    defaultAreaName: "Most employers",
    areas: [{ name: "Seasonal or fewer than 6 employees", minimumWage: "15.23" }],
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: { law: "Earned Sick Leave Law (N.J.S.A. 34:11D)", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "40", accrualCapHours: null },
    newHireReportDays: 20, newHireReportTo: "New Jersey New Hire Reporting Center",
  },
  business: { salesTax: null },
};
