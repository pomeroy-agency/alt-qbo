import type { Source, StatePayrollTax, StateRulePack, StateWageHourRules } from "../types.js";

// The payroll side of each province and territory, July to December 2026,
// in the same shape as a US state pack so the pay run, chart of accounts and
// payroll settings work the same way: employer costs (workers' compensation,
// health taxes, Quebec's health services fund and labour standards
// contribution, the territories' payroll tax), minimum wage and overtime.
// Income tax, CPP or QPP, EI and QPIP come from the Canada packs
// (src/rules/canada/federal-2026.ts, provinces-2026.ts) through
// src/payroll/canada.ts. Drafts until Greg's review.

const SECONDARY_WAGES: Source = {
  ref: "Minimum wage rates as of October 2026 reported by CFIB, Canada News Media, CalculatorHub and Canooq (provincial labour sites refuse automated downloads)",
  covers: "general minimum wage and its 2026 change dates",
  basis: "working-knowledge",
};
const SECONDARY_WCB: Source = {
  ref: "2026 workers' compensation maximum assessable earnings as reported by CFIB's 2026 payroll tables and Windley Ely",
  covers: "each board's 2026 maximum assessable (insurable) earnings",
  basis: "working-knowledge",
};
const EMPLOYMENT_STANDARDS: Source = {
  ref: "Provincial and territorial employment standards acts (general overtime rules), working knowledge",
  covers: "daily and weekly overtime thresholds; Canada has no salary test for overtime exemption",
  basis: "working-knowledge",
};

const NOTES = [
  "⚠️ check: minimum wages, overtime thresholds and workers' compensation maximums are from secondary sources; provincial sites refuse automated downloads.",
  "Workers' compensation: each employer's rate depends on its industry, so pay runs wait until the rate from the board's notice is entered in payroll settings.",
  "Vacation pay, statutory holidays and paid sick days aren't worked out yet (employment standards pull request); overtime is paid at 1.5 times the regular rate.",
  "Remittance schedules and year-end slips (T4, RL-1, ROE) come in the next pull request; until then the payroll pages show no Canadian due dates.",
  "Sales tax: TrailBook doesn't work out GST/HST, PST or QST yet; invoices carry none unless an owner or accountant sets the rate by hand.",
];

function wcb(code: string, board: string, maxEarnings: string): StatePayrollTax {
  return {
    code, label: `${board} premium`, agency: board, paidBy: "employer", rate: "0", wageBase: maxEarnings, account: "workers_comp_payable",
    assignedRate: { label: `${board} premium rate`, hint: `Your rate per $100 of assessable earnings from your ${board} notice, as a percentage.`, required: true },
  };
}

function healthTax(code: string, label: string, agency: string, hint: string): StatePayrollTax {
  return { code, label, agency, paidBy: "employer", rate: "0", wageBase: null, account: "health_tax_payable", assignedRate: { label: `${label} rate`, hint } };
}

function wageHour(minimumWage: string, overtime: StateWageHourRules["overtime"], changes?: { from: string; rate: string }[]): StateWageHourRules {
  return {
    minimumWage, ...(changes ? { minimumWageChanges: changes } : {}),
    // Canada has no salary test: managers are exempt from overtime by their duties, not their pay.
    exemptAnnualSalaryMinimum: "0",
    overtime,
    sickLeave: null,
    // Canada has no new-hire reporting to a government registry.
    newHireReportDays: 0,
    newHireReportTo: "",
  };
}

const CRA_BN = { label: "CRA payroll account number", hint: "Your business number with the RP program account, like 123456789RP0001. It goes on T4 slips and PD7A remittances.", pattern: "^[0-9]{9}RP[0-9]{4}$", format: "#########RP####" };
const CRA_ACCOUNT = { code: "2340", name: "CRA source deductions payable", systemKey: "cra_payroll_payable" };
const WCB_ACCOUNT = { code: "2350", name: "Workers' compensation payable", systemKey: "workers_comp_payable" };
const HEALTH_ACCOUNT = { code: "2355", name: "Employer health tax payable", systemKey: "health_tax_payable" };

function province(region: string, name: string, td1: string, opts: {
  taxes: StatePayrollTax[];
  wageHour: StateWageHourRules;
  sources?: Source[];
  notes?: string[];
  accounts?: { code: string; name: string; systemKey: string }[];
  employerAccount?: StateRulePack["payroll"]["employerAccount"];
}): StateRulePack {
  return {
    kind: "state",
    id: `ca-${region.toLowerCase()}-payroll`,
    version: "2026.1",
    name,
    place: { country: "CA", region },
    effectiveFrom: "2026-07-01",
    effectiveTo: "2026-12-31",
    status: "released",
    calendar: "weekends",
    sources: [SECONDARY_WAGES, SECONDARY_WCB, EMPLOYMENT_STANDARDS, ...(opts.sources ?? [])],
    reviewNotes: [...NOTES, ...(opts.notes ?? [])],
    payroll: {
      incomeTax: { method: "canada", certificate: td1 },
      taxes: opts.taxes,
      deposits: [],
      employerAccount: opts.employerAccount ?? CRA_BN,
      accounts: opts.accounts ?? [CRA_ACCOUNT, WCB_ACCOUNT, ...(opts.taxes.some((t) => t.account === "health_tax_payable") ? [HEALTH_ACCOUNT] : [])],
    },
    forms: { quarterly: [], w2Box14: [] },
    wageHour: opts.wageHour,
    business: { salesTax: null },
  };
}

const weekly = (after: string) => ({ weeklyAfter: after });
const dailyWeekly = (daily: string, weeklyAfter: string) => ({ dailyAfter: daily, weeklyAfter });

export const caAlbertaPayroll2026 = province("AB", "Alberta", "TD1AB", {
  taxes: [wcb("AB_WCB", "WCB-Alberta", "110900")],
  wageHour: wageHour("15.00", dailyWeekly("8", "44")),
});

export const caBritishColumbiaPayroll2026 = province("BC", "British Columbia", "TD1BC", {
  taxes: [
    wcb("BC_WCB", "WorkSafeBC", "127500"),
    healthTax("BC_EHT", "BC employer health tax", "BC Ministry of Finance", "Only when your BC payroll is over $1,000,000 a year (charities $1,500,000): your effective rate, up to 1.95%. Leave blank otherwise."),
  ],
  wageHour: wageHour("18.25", { dailyAfter: "8", dailyDoubleTimeAfter: "12", weeklyAfter: "40" }),
  notes: ["BC pays double time after 12 hours in a day (Employment Standards Act s. 40)."],
});

export const caManitobaPayroll2026 = province("MB", "Manitoba", "TD1MB", {
  taxes: [
    wcb("MB_WCB", "WCB Manitoba", "171500"),
    healthTax("MB_HE_LEVY", "Manitoba health and education levy", "Manitoba Finance", "Only when your Manitoba payroll is over $2,250,000 a year: your effective rate (2.15% to 4.3%). Leave blank otherwise."),
  ],
  wageHour: wageHour("16.00", dailyWeekly("8", "40"), [{ from: "2026-10-01", rate: "16.40" }]),
  notes: ["⚠️ check: health and education levy thresholds."],
});

export const caNewBrunswickPayroll2026 = province("NB", "New Brunswick", "TD1NB", {
  taxes: [wcb("NB_WCB", "WorkSafeNB", "85800")],
  wageHour: wageHour("15.90", weekly("44")),
  notes: ["New Brunswick's overtime is at least 1.5 times the minimum wage after 44 hours; TrailBook pays 1.5 times the regular rate, which is never less."],
});

export const caNewfoundlandPayroll2026 = province("NL", "Newfoundland and Labrador", "TD1NL", {
  taxes: [
    wcb("NL_WCB", "WorkplaceNL", "80935"),
    healthTax("NL_HAPSET", "NL health and post-secondary education tax", "NL Department of Finance", "Only when your NL payroll is over $2,000,000 a year: 2% of the amount over it, as an effective rate. Leave blank otherwise."),
  ],
  wageHour: wageHour("16.35", weekly("40")),
  notes: ["Newfoundland and Labrador's overtime is at least 1.5 times the minimum wage after 40 hours; TrailBook pays 1.5 times the regular rate.", "⚠️ check: HAPSET exemption threshold."],
});

export const caNovaScotiaPayroll2026 = province("NS", "Nova Scotia", "TD1NS", {
  taxes: [wcb("NS_WCB", "WCB Nova Scotia", "79900")],
  wageHour: wageHour("16.50", weekly("48"), [{ from: "2026-10-01", rate: "17.00" }]),
  notes: ["Nova Scotia's overtime is 1.5 times the minimum wage after 48 hours; TrailBook pays 1.5 times the regular rate.", "⚠️ check: the rate before October 1, 2026."],
});

export const caOntarioPayroll2026 = province("ON", "Ontario", "TD1ON", {
  taxes: [
    wcb("ON_WSIB", "WSIB", "121700"),
    healthTax("ON_EHT", "Ontario employer health tax", "Ontario Ministry of Finance", "Only when your Ontario payroll is over the $1,000,000 exemption (or you aren't eligible for it): your effective rate, up to 1.95%. Leave blank otherwise."),
  ],
  wageHour: wageHour("17.60", weekly("44"), [{ from: "2026-10-01", rate: "17.95" }]),
});

export const caPrinceEdwardIslandPayroll2026 = province("PE", "Prince Edward Island", "TD1PE", {
  taxes: [wcb("PE_WCB", "WCB PEI", "89300")],
  wageHour: wageHour("16.50", weekly("48"), [{ from: "2026-10-01", rate: "17.30" }]),
  notes: ["⚠️ check: the rate before October 1, 2026."],
});

export const caQuebecPayroll2026 = province("QC", "Quebec", "TP-1015.3", {
  taxes: [
    { ...wcb("QC_CNESST", "CNESST", "103000"), account: "rq_payroll_payable", agency: "Revenu Québec", label: "CNESST premium" },
    {
      code: "QC_HSF", label: "Health services fund", agency: "Revenu Québec", paidBy: "employer", rate: "0.0165", wageBase: null, account: "rq_payroll_payable",
      assignedRate: { label: "Health services fund rate", hint: "1.65% when your total payroll (with associated employers) is $1,000,000 or less; otherwise 1.2662% + 0.3838% × payroll in millions, up to 4.26% (TP-1015.F-V section 5). Primary and manufacturing employers use their own rates." },
    },
    { code: "QC_CNT", label: "Labour standards contribution (CNT)", agency: "Revenu Québec", paidBy: "employer", rate: "0.0006", wageBase: "103000", account: "rq_payroll_payable" },
    {
      code: "QC_WSDRF", label: "Workforce skills development (WSDRF)", agency: "Revenu Québec", paidBy: "employer", rate: "0", wageBase: null, account: "rq_payroll_payable",
      assignedRate: { label: "WSDRF rate", hint: "Only when your total payroll is over $2,000,000 and you didn't spend 1% of it on eligible training: 1%. Leave blank otherwise." },
    },
  ],
  wageHour: wageHour("16.60", weekly("40")),
  employerAccount: { label: "Revenu Québec identification number", hint: "Your 10-digit identification number with the RS file, like 1234567890RS0001. It goes on RL-1 slips and source deduction remittances. Federal tax and EI go to CRA under your business number's RP payroll account.", pattern: "^[0-9]{10}RS[0-9]{4}$", format: "##########RS####" },
  accounts: [CRA_ACCOUNT, { code: "2345", name: "Revenu Québec source deductions payable", systemKey: "rq_payroll_payable" }, WCB_ACCOUNT],
  sources: [
    { ref: "Revenu Québec TP-1015.F-V (2026-01), section 5 and principal changes", covers: "health services fund rates 1.65% to 4.26% by total payroll", basis: "published" },
    { ref: "CNT labour standards contribution and CNESST premiums, working knowledge", covers: "0.06% on remuneration up to $103,000; CNESST premiums are paid to Revenu Québec with source deductions", basis: "working-knowledge" },
  ],
  notes: [
    "Quebec employees: federal tax and EI go to CRA; Quebec tax, QPP, QPIP, the health services fund, the CNT contribution and CNESST premiums go to Revenu Québec.",
    "⚠️ check: CNT rate 0.06% and its $103,000 maximum; WSDRF applies only to payrolls over $2,000,000.",
  ],
});

export const caSaskatchewanPayroll2026 = province("SK", "Saskatchewan", "TD1SK", {
  taxes: [wcb("SK_WCB", "WCB Saskatchewan", "108223")],
  wageHour: wageHour("15.35", dailyWeekly("8", "40"), [{ from: "2026-10-01", rate: "15.70" }]),
});

function territorialPayrollTax(code: string, territory: string): StatePayrollTax {
  return { code, label: `${territory} payroll tax`, agency: `${territory} Finance`, paidBy: "employee", rate: "0.02", wageBase: null, account: "territorial_payroll_tax_payable" };
}
const TERRITORIAL_ACCOUNT = { code: "2360", name: "Territorial payroll tax payable", systemKey: "territorial_payroll_tax_payable" };

export const caNorthwestTerritoriesPayroll2026 = province("NT", "Northwest Territories", "TD1NT", {
  taxes: [territorialPayrollTax("NT_PAYROLL_TAX", "NWT"), wcb("NT_WSCC", "WSCC", "116000")],
  wageHour: wageHour("16.95", dailyWeekly("8", "40"), [{ from: "2026-09-01", rate: "17.20" }]),
  accounts: [CRA_ACCOUNT, WCB_ACCOUNT, TERRITORIAL_ACCOUNT],
  notes: ["The NWT payroll tax is 2% of employees' remuneration, withheld from their pay.", "⚠️ check: the rate before September 1, 2026."],
});

export const caNunavutPayroll2026 = province("NU", "Nunavut", "TD1NU", {
  taxes: [territorialPayrollTax("NU_PAYROLL_TAX", "Nunavut"), wcb("NU_WSCC", "WSCC", "117300")],
  wageHour: wageHour("19.75", dailyWeekly("8", "40"), [{ from: "2026-09-01", rate: "20.17" }]),
  accounts: [CRA_ACCOUNT, WCB_ACCOUNT, TERRITORIAL_ACCOUNT],
  notes: ["The Nunavut payroll tax is 2% of employees' remuneration, withheld from their pay.", "⚠️ check: the rate before September 1, 2026."],
});

export const caYukonPayroll2026 = province("YT", "Yukon", "TD1YT", {
  taxes: [wcb("YT_WCB", "WSCY", "107599")],
  wageHour: wageHour("18.51", dailyWeekly("8", "40")),
});

export const CANADA_PAYROLL_PACKS_2026: readonly StateRulePack[] = [
  caAlbertaPayroll2026, caBritishColumbiaPayroll2026, caManitobaPayroll2026, caNewBrunswickPayroll2026, caNewfoundlandPayroll2026,
  caNovaScotiaPayroll2026, caOntarioPayroll2026, caPrinceEdwardIslandPayroll2026, caQuebecPayroll2026, caSaskatchewanPayroll2026,
  caNorthwestTerritoriesPayroll2026, caNunavutPayroll2026, caYukonPayroll2026,
];
