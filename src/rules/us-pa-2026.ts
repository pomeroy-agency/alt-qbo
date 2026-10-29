import type { StateRulePack } from "./types.js";

// Pennsylvania 2026. Personal income tax is a flat 3.07% of compensation with
// no exemptions, read from the Department of Revenue's employer withholding
// page on 2026-10-29, along with the deposit schedule. UC figures come from
// L&I's 2026 tax highlights. Local taxes: the Act 32 earned income tax and
// Local Services Tax are entered for each employee, since they depend on
// where the employee lives and works; Philadelphia's wage tax has its own
// rates. Released 2026-10-29 after Greg's review (docs/rule-pack-review.md).
export const usPennsylvania2026: StateRulePack = {
  kind: "state",
  id: "us-pa",
  version: "2026.1",
  name: "Pennsylvania",
  place: { country: "US", region: "PA" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "released",
  calendar: "weekends",
  sources: [
    { ref: "PA Department of Revenue, Employer Withholding (pa.gov/agencies/revenue)", covers: "flat 3.07% of compensation for resident and nonresident employees; quarterly under $300 a quarter, monthly by the 15th from $300 to $999, semi-monthly within 3 banking days from $1,000 to $4,999.99, semi-weekly on the federal-style Wednesday/Friday dates from $5,000 a quarter ($20,000 a year); W-3 quarterly reconciliation", basis: "published" },
    { ref: "PA L&I, UC Trust Fund Solvency Measures in Effect for Calendar Year 2026 (pa.gov/agencies/dli)", covers: "$10,000 wage base; employee withholding 0.07% of all wages with no cap; newly liable non-construction employers .038220 (9.2% surcharge included, 0.60% additional tax not applied)", basis: "published" },
    { ref: "PA DCED, Act 32 earned income tax guidance, as quoted by payroll publishers", covers: "withhold the higher of the employee's total resident EIT rate and the work location's nonresident rate; 6-digit PSD codes; remit to the work location's tax collection district", basis: "published" },
    { ref: "Local Tax Enabling Act (Act 7 of 2007), Local Services Tax", covers: "up to $52 a year, taken in equal amounts over the year's pay periods; employees earning under $12,000 a year in the municipality can be exempt", basis: "working-knowledge" },
    { ref: "City of Philadelphia wage tax rate table, as reported by payroll publishers (phila.gov could not be opened from TrailBook's build machines)", covers: "3.74% resident / 3.43% nonresident to June 30, 2026; 3.735% / 3.425% from July 1, 2026; monthly payments by the 15th, weekly at $16,000 or more a month", basis: "published" },
    { ref: "43 P.S. 333.104 (Minimum Wage Act); 23 Pa.C.S. 4392 (new hire reporting)", covers: "$7.25 minimum wage; report new hires within 20 days; no statewide paid sick leave law", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "State withholding needs no certificate: 3.07% of all compensation. Residents of New Jersey, Ohio, Indiana, Maryland, Virginia and West Virginia who file a REV-419 are exempt under reciprocity; TrailBook doesn't handle that yet and withholds Pennsylvania tax for them.",
    "Local earned income tax (Act 32): for each employee, enter the higher of their home municipality's total resident rate and the work location's nonresident rate (DCED's Municipal Statistics site lists both by PSD code), and their PSD code. Philadelphia residents pay Philadelphia's wage tax instead and have no EIT.",
    "Local Services Tax: enter the yearly amount the work location charges (up to $52; $10 or less in some places, which some take once). TrailBook spreads it evenly over the year's paychecks. Employees who file an exemption certificate (under $12,000 a year there) should have it unticked.",
    "Philadelphia wage tax: tick resident or nonresident. The rate drops on July 1, 2026; TrailBook uses the pay period's last day to pick it. Nonresidents owe it only for work done in Philadelphia, which TrailBook doesn't split.",
    "Local tax deposits: EIT and LST are paid to the work location's tax collector (Keystone, Berkheimer, Jordan and others) within 30 days after each quarter, which TrailBook shows as the 30th; some collectors want them monthly. Philadelphia's wage tax is paid monthly by the 15th, or weekly at $16,000 or more a month.",
    "State withholding deposits follow the Department of Revenue's four tiers by last year's withholding: monthly by the 15th, semi-monthly from $4,000 a year, the federal semi-weekly dates from $20,000. The under-$300-a-quarter tier is shown monthly (earlier than needed).",
    "UC: employees pay 0.07% of all wages; employers pay their notice rate on the first $10,000 (new employers 3.822%, construction 10.5924%).",
    "Philadelphia (40 hours) and Pittsburgh (24 or 40 hours) have their own paid sick leave ordinances; TrailBook tracks none for Pennsylvania.",
    "Sales tax: TrailBook doesn't work out Pennsylvania sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
  payroll: {
    incomeTax: {
      method: "annual_formula", certificate: null,
      statuses: [{ id: "single", label: "Any", standardDeduction: "0", table: "all" }],
      noCertificateStatus: "single",
      allowances: [],
      tables: { all: [{ over: "0", rate: "0.0307" }] },
      round: "cent",
    },
    incomeTaxAgency: { agency: "PA Revenue", code: "PA_WH", label: "Pennsylvania income tax", account: "pa_wh_payable" },
    localIncomeTaxes: [
      {
        id: "pa_eit", name: "PA local earned income tax", label: "Pennsylvania local earned income tax (Act 32)", code: "PA_EIT", agency: "Local tax collector",
        account: "pa_local_payable", w2Locality: "PA EIT",
        rules: {
          method: "employee_rate", base: "wages", maxRate: "0.05", rateLabel: "Earned income tax rate (%)", placeLabel: "Home PSD code",
          hint: "The higher of the home municipality's total resident rate and the work location's nonresident rate, from DCED's Municipal Statistics site. The PSD code goes on the W-2.",
        },
      },
      {
        id: "pa_lst", name: "PA Local Services Tax", label: "Pennsylvania Local Services Tax", code: "PA_LST", agency: "Local tax collector",
        account: "pa_local_payable", w2Locality: "PA LST",
        rules: {
          method: "annual_amount", maxAnnual: "52", amountLabel: "Local Services Tax for the year ($)", placeLabel: "Work location PSD code",
          hint: "What the work location charges, up to $52 a year, spread evenly over the year's paychecks. Untick it for an employee who filed an exemption certificate.",
        },
      },
      {
        id: "phl_res", name: "Philadelphia wage tax", label: "Lives in Philadelphia (wage tax, resident rate)", code: "PHL_WAGE_R", agency: "Philadelphia Revenue",
        account: "phl_wage_payable", w2Locality: "PHILA",
        rules: { method: "flat_rate", rate: "0.0374", rateChanges: [{ from: "2026-07-01", rate: "0.03735" }] },
      },
      {
        id: "phl_nr", name: "Philadelphia wage tax (nonresident)", label: "Works in Philadelphia but lives elsewhere (wage tax, nonresident rate)", code: "PHL_WAGE_NR", agency: "Philadelphia Revenue",
        account: "phl_wage_payable", w2Locality: "PHILA",
        rules: { method: "flat_rate", rate: "0.0343", rateChanges: [{ from: "2026-07-01", rate: "0.03425" }] },
      },
    ],
    taxes: [
      { code: "PA_UC_EE", label: "Pennsylvania UC (employee)", agency: "L&I", paidBy: "employee", rate: "0.0007", wageBase: null, account: "pa_uc_payable" },
      {
        code: "PA_UC", label: "Pennsylvania UC", agency: "L&I", paidBy: "employer", rate: "0.03822", wageBase: "10000", account: "pa_uc_payable",
        assignedRate: { label: "Your Pennsylvania UC rate (%)", hint: "The total rate on your L&I rate notice. New employers pay 3.822% (10.5924% in construction)." },
      },
    ],
    deposits: [
      {
        kind: "pa_wh", codes: ["PA_WH"], agency: "PA Revenue", what: "Pennsylvania withholding", where: "myPATH",
        schedule: "monthly_or_larger", lookbackOver: "19999.99", largeFiler: "federal", dueDay: 15, report: "W-3", semimonthlyOver: "3999.99",
      },
      { kind: "pa_uc", codes: ["PA_UC_EE", "PA_UC"], agency: "L&I", what: "Pennsylvania UC", where: "UCMS", schedule: "quarterly", report: "UC-2" },
      {
        kind: "pa_local", codes: ["PA_EIT", "PA_LST"], agency: "Local tax collector", what: "Local earned income and services taxes",
        where: "The work location's tax collector", schedule: "quarterly", report: "Quarterly local tax return", dueDay: 30,
      },
      {
        kind: "phl_wage", codes: ["PHL_WAGE_R", "PHL_WAGE_NR"], agency: "Philadelphia Revenue", what: "Philadelphia wage tax", where: "Philadelphia Tax Center",
        schedule: "monthly_or_larger", lookbackOver: "192000", largeFiler: "weekly", dueDay: 15, report: "Philadelphia wage tax return",
      },
    ],
    employerAccount: { label: "Pennsylvania UC employer account number", hint: "The number on your L&I notices. It goes on the UC-2. Withholding uses your Revenue account ID.", pattern: "^[0-9]{6,10}$" },
    accounts: [
      { code: "2340", name: "Pennsylvania income tax payable", systemKey: "pa_wh_payable" },
      { code: "2350", name: "Pennsylvania UC payable", systemKey: "pa_uc_payable" },
      { code: "2360", name: "Pennsylvania local taxes payable", systemKey: "pa_local_payable" },
      { code: "2370", name: "Philadelphia wage tax payable", systemKey: "phl_wage_payable" },
    ],
  },
  forms: {
    quarterly: [
      { form: "W-3", slug: "pa-w3", title: "Employer Quarterly Reconciliation Worksheet (PA W-3)", kind: "withholding_return", codes: ["PA_WH"], fileAt: "File through myPATH" },
      { form: "UC-2", slug: "uc2", title: "Employer's Report for Unemployment Compensation (UC-2/UC-2A)", kind: "ui_wage_report", codes: ["PA_UC", "PA_UC_EE"], fileAt: "File and pay through UCMS" },
      {
        form: "Local tax return", slug: "pa-local", title: "Quarterly local earned income and services tax return", kind: "withholding_return", codes: ["PA_EIT", "PA_LST"],
        fileAt: "File with the work location's tax collector", dueDay: 30,
      },
      { form: "Philadelphia wage tax", slug: "phl-wage", title: "Philadelphia Wage Tax quarterly return", kind: "withholding_return", codes: ["PHL_WAGE_R", "PHL_WAGE_NR"], fileAt: "File through the Philadelphia Tax Center" },
    ],
    w2Box14: [{ code: "PA_UC_EE", label: "PA SUI" }],
  },
  wageHour: {
    minimumWage: "7.25",
    exemptAnnualSalaryMinimum: "35568",
    overtime: { weeklyAfter: "40" },
    sickLeave: null,
    newHireReportDays: 20, newHireReportTo: "Pennsylvania New Hire Reporting Program",
  },
  business: { salesTax: null },
};
