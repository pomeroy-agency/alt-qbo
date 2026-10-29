import type { StateRulePack } from "./types.js";

// Ohio 2026. Withholding follows the Department of Taxation's Optional
// Computer Formula (Rev. 07/26, effective August 1, 2026), read from the
// formula itself on 2026-10-29: the year's wages less $650 an IT 4
// exemption, at 1.6% to $26,050, 2.99% to $100,000 and 3.4% above. Pay
// runs before August used the older tables; this pack has only the current
// formula. City and school district taxes are entered for each employee,
// since they depend on where the employee works and lives. Draft until Greg
// reviews it (docs/rule-pack-review.md).
export const usOhio2026: StateRulePack = {
  kind: "state",
  id: "us-oh",
  version: "2026.1",
  name: "Ohio",
  place: { country: "US", region: "OH" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  calendar: "weekends",
  sources: [
    { ref: "Ohio Department of Taxation, Employer Withholding Taxes: Optional Computer Formula (Rev. 07/26, effective August 1, 2026)", covers: "$650 an exemption; 1.6% up to $26,050; $416.80 plus 2.99% to $100,000; $2,627.91 plus 3.4% above", basis: "published" },
    { ref: "Ohio Department of Taxation, 2026 Employer and School District Withholding Tax Filing Guidelines", covers: "quarterly for $2,000 or less of Ohio and school district tax in the look-back year (to June 30), monthly by the 15th up to $84,000, partial-weekly (3 banking days after each Saturday-to-Tuesday and Wednesday-to-Friday period) from $84,000; traditional-base school districts use the Ohio wage base and exemptions, earned-income districts a flat rate with no exemptions", basis: "published" },
    { ref: "ODJFS 2026 contribution rates, as reported by payroll publishers and the HB 376 fiscal note", covers: "$9,000 wage base; 2.85% new-employer rate including the 0.15% technology and customer service fee (5.85% in construction)", basis: "published" },
    { ref: "Ohio Constitution art. II, s. 34a; Ohio Department of Commerce minimum wage notice for 2026, as reported", covers: "$11.00 for employers with gross receipts over $405,000; $7.25 at or below", basis: "published" },
    { ref: "ORC 718 (municipal income tax withholding); ORC 4141.29 (new hire reporting)", covers: "employers withhold the city tax where work is done, and may withhold for the home city; report new hires within 20 days; no statewide paid sick leave law", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Ohio cut its withholding rates from August 1, 2026. Pay runs before then used the older tables; TrailBook uses the current formula for the whole year, so it slightly under-withholds against the old tables for January to July pay dates.",
    "IT 4 exemptions are $650 each. No IT 4 on file: no exemptions.",
    "City tax: enter the rate of the city or village where the employee works (most are 1% to 2.5%) and its name. If you also withhold for the city they live in as a courtesy, tick the home city box and enter its rate, less any credit it gives for the work city's tax.",
    "School district tax: TrailBook withholds it when you tick it and enter the rate from the employee's IT 4 school district number. Traditional-base districts take the rate on wages less the $650 exemptions; earned-income districts take it on all wages.",
    "Deposits: Ohio withholding (with the SD 101 for school districts) is paid monthly by the 15th, or on the federal semi-weekly dates (Ohio's partial-weekly periods match them) at $84,000 or more in the look-back year. TrailBook uses last calendar year rather than the year to June 30. Quarterly filers ($2,000 or less) are shown monthly, earlier than needed.",
    "City taxes are paid to the city or its collector (RITA, CCA or the city's own office), usually monthly by the 15th; small employers may be quarterly.",
    "UI rates are per employer: enter yours from the ODJFS rate notice, including the 0.15% fee. New employers pay 2.85% (5.85% in construction).",
    "Minimum wage: employers with gross receipts of $405,000 or less pick that area ($7.25).",
    "Sales tax: TrailBook doesn't work out Ohio sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: "IT 4",
      statuses: [{ id: "single", label: "Any", standardDeduction: "0", table: "all" }],
      noCertificateStatus: "single",
      allowances: [{ label: "IT 4 exemptions", amount: "650" }],
      tables: { all: [{ over: "0", rate: "0.016" }, { over: "26050", rate: "0.0299" }, { over: "100000", rate: "0.034" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "Ohio Taxation", code: "OH_WH", label: "Ohio income tax", account: "oh_wh_payable" },
    localIncomeTaxes: [
      {
        id: "oh_city", name: "Ohio city income tax", label: "Ohio city tax where they work", code: "OH_CITY", agency: "City tax administrator",
        account: "oh_local_payable", w2Locality: "CITY",
        rules: {
          method: "employee_rate", base: "wages", maxRate: "0.03", rateLabel: "Work city tax rate (%)", placeLabel: "Work city or village",
          hint: "The city or village where the employee works and its rate; it goes in W-2 box 20.",
        },
      },
      {
        id: "oh_city_res", name: "Ohio home city income tax", label: "Also withhold for the city they live in", code: "OH_CITY_RES", agency: "City tax administrator",
        account: "oh_local_payable", w2Locality: "CITY",
        rules: {
          method: "employee_rate", base: "wages", maxRate: "0.03", rateLabel: "Home city rate to withhold (%)", placeLabel: "Home city or village",
          hint: "Only if you withhold for the home city too: its rate less any credit it gives for the work city's tax.",
        },
      },
      {
        id: "oh_sd", name: "Ohio school district income tax", label: "School district income tax (traditional base)", code: "OH_SD", agency: "Ohio Taxation",
        account: "oh_sd_payable", w2Locality: "SD",
        rules: {
          method: "employee_rate", base: "less_state_exemptions", maxRate: "0.03", rateLabel: "School district rate (%)", placeLabel: "School district number",
          hint: "From the school district number on the employee's IT 4; the rate is on the wages less the $650 exemptions.",
        },
      },
      {
        id: "oh_sd_ei", name: "Ohio school district income tax", label: "School district income tax (earned income base)", code: "OH_SD_EI", agency: "Ohio Taxation",
        account: "oh_sd_payable", w2Locality: "SD",
        rules: {
          method: "employee_rate", base: "wages", maxRate: "0.03", rateLabel: "School district rate (%)", placeLabel: "School district number",
          hint: "From the school district number on the employee's IT 4; earned-income districts take the rate on all wages.",
        },
      },
    ],
    taxes: [
      {
        code: "OH_UI", label: "Ohio UI", agency: "ODJFS", paidBy: "employer", rate: "0.0285", wageBase: "9000", account: "oh_ui_payable",
        assignedRate: { label: "Your Ohio UI rate (%)", hint: "The total rate on your ODJFS rate notice, including the 0.15% fee. New employers pay 2.85% (5.85% in construction)." },
      },
    ],
    deposits: [
      {
        kind: "oh_wh", codes: ["OH_WH"], agency: "Ohio Taxation", what: "Ohio withholding", where: "OH|TAX eServices",
        schedule: "monthly_or_larger", lookbackOver: "83999.99", largeFiler: "federal", dueDay: 15, report: "IT 501",
      },
      {
        kind: "oh_sd", codes: ["OH_SD", "OH_SD_EI"], agency: "Ohio Taxation", what: "Ohio school district withholding", where: "OH|TAX eServices",
        schedule: "monthly_or_larger", lookbackOver: "83999.99", largeFiler: "federal", dueDay: 15, report: "SD 101",
      },
      {
        kind: "oh_city", codes: ["OH_CITY", "OH_CITY_RES"], agency: "City tax administrator", what: "Ohio city income tax", where: "The city's tax office, RITA or CCA",
        schedule: "monthly_or_larger", lookbackOver: null, largeFiler: "federal", dueDay: 15, report: "City withholding return",
      },
      { kind: "oh_ui", codes: ["OH_UI"], agency: "ODJFS", what: "Ohio UI", where: "Ohio Employer Resource Information Center (ERIC)", schedule: "quarterly", report: "JFS-20125" },
    ],
    employerAccount: { label: "Ohio UI employer account number", hint: "The number on your ODJFS notices. It goes on the JFS-20125. Withholding uses your Ohio withholding account number.", pattern: "^[0-9]{7,10}$" },
    accounts: [
      { code: "2340", name: "Ohio income tax payable", systemKey: "oh_wh_payable" },
      { code: "2350", name: "Ohio UI payable", systemKey: "oh_ui_payable" },
      { code: "2360", name: "Ohio city income tax payable", systemKey: "oh_local_payable" },
      { code: "2370", name: "Ohio school district tax payable", systemKey: "oh_sd_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "JFS-20125", slug: "jfs20125", title: "Employer's Contribution Report (JFS-20125)", kind: "ui_wage_report", codes: ["OH_UI"], fileAt: "File and pay through ERIC" },
      { form: "City withholding return", slug: "oh-city", title: "Ohio municipal withholding return", kind: "withholding_return", codes: ["OH_CITY", "OH_CITY_RES"], fileAt: "File with each city's tax office, RITA or CCA" },
    ],
    w2Box14: [],
  },
  wageHour: {
    minimumWage: "11.00",
    defaultAreaName: "Gross receipts over $405,000",
    areas: [{ name: "Gross receipts $405,000 or less", minimumWage: "7.25" }],
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Ohio New Hire Reporting Center",
  },
  business: { salesTax: null },
};
