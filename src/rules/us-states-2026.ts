import type { Source, StatePayrollTax, StateRulePack } from "./types.js";

// 2026 packs for the states without a wage income tax: Texas, Florida,
// Nevada, Tennessee, South Dakota, Wyoming, New Hampshire, Alaska and
// Washington. Payroll there is federal taxes plus the state's unemployment
// (and in Alaska and Washington, employee) taxes, its minimum wage, overtime
// and leave rules. Every pack is a draft until Greg reviews it in
// docs/rule-pack-review.md: until then a business can be set up and preview
// payroll there, but saved pay runs are refused.
//
// Figures were gathered on 2026-10-28 from the agencies' own pages where a
// search could reach them, and otherwise from payroll publishers (Bloomberg
// Tax, Paylocity, Patriot, TimeTrex and others). TrailBook's build machines
// can't open most state sites, so each pack's review notes say which figures
// still need reading off the agency's own notice.

/** The federal salary floor for exempt employees ($684 a week) where the state sets nothing higher. */
const FEDERAL_EXEMPT = "35568";

interface StateSpec {
  code: string;
  name: string;
  /** The state's taxes on wages; UI is the first. */
  taxes: Omit<StatePayrollTax, "account">[];
  /** Quarterly report(s), and which taxes each covers; each is also a quarterly deposit. */
  reports: { form: string; slug: string; title: string; codes: string[]; agency: string; where: string; fileAt: string }[];
  employerAccount: StateRulePack["payroll"]["employerAccount"];
  wageHour: Omit<StateRulePack["wageHour"], "exemptAnnualSalaryMinimum" | "overtime" | "sickLeave"> &
    Partial<Pick<StateRulePack["wageHour"], "exemptAnnualSalaryMinimum" | "overtime" | "sickLeave">>;
  sources: Source[];
  reviewNotes: string[];
}

const ACCOUNT_CODES = ["2350", "2360", "2370", "2375"];

function noIncomeTaxState(s: StateSpec): StateRulePack {
  const key = s.code.toLowerCase();
  const accountOf = (code: string) => `${code.toLowerCase()}_payable`;
  return {
    kind: "state",
    id: `us-${key}`,
    version: "2026.1",
    name: s.name,
    place: { country: "US", region: s.code },
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    status: "draft",
    calendar: "weekends",
    sources: s.sources,
    reviewNotes: s.reviewNotes,
    payroll: {
      incomeTax: { method: "none" },
      taxes: s.taxes.map((t) => ({ ...t, account: accountOf(t.code) })),
      deposits: s.reports.map((r) => ({
        kind: `${key}_${r.slug.replace(/[^a-z0-9]/g, "_").replace(new RegExp(`^${key}_`), "")}`.slice(0, 23),
        codes: r.codes, agency: r.agency, what: r.title.replace(/ \(.*\)$/, ""), where: r.where, schedule: "quarterly" as const, report: r.form,
      })),
      employerAccount: s.employerAccount,
      accounts: s.taxes.map((t, i) => ({ code: ACCOUNT_CODES[i]!, name: `${t.label} payable`, systemKey: accountOf(t.code) })),
    },
    forms: {
      quarterly: s.reports.map((r) => ({ form: r.form, slug: r.slug, title: r.title, kind: "ui_wage_report" as const, codes: r.codes, fileAt: r.fileAt })),
      w2Box14: [],
    },
    wageHour: {
      exemptAnnualSalaryMinimum: FEDERAL_EXEMPT,
      overtime: { weeklyAfter: "40" },
      sickLeave: null,
      ...s.wageHour,
    },
    business: { salesTax: null },
  };
}

const uiHint = (agency: string, notice: string, rate: string) =>
  `It's on the rate notice ${agency} sends each year (${notice}). New employers pay ${rate}.`;

export const usTexas2026 = noIncomeTaxState({
  code: "TX", name: "Texas",
  taxes: [{
    code: "TX_UI", label: "Texas UI", agency: "TWC", paidBy: "employer", rate: "0.027", wageBase: "9000",
    assignedRate: { label: "Your Texas UI rate (%)", hint: uiHint("the Texas Workforce Commission", "Form C-22", "2.7%") },
  }],
  reports: [{
    form: "C-3", slug: "c3", title: "Employer's Quarterly Report (C-3)", codes: ["TX_UI"], agency: "TWC",
    where: "TWC Unemployment Tax Services", fileAt: "File and pay through TWC Unemployment Tax Services",
  }],
  employerAccount: { label: "TWC tax account number", hint: "The 9-digit number on your TWC notices. It goes on the C-3.", pattern: "^\\d{9}$", format: "##-######-#" },
  wageHour: { minimumWage: "7.25", newHireReportDays: 20, newHireReportTo: "Texas Office of the Attorney General (Employer New Hire Reporting)" },
  sources: [
    { ref: "TWC, 2026 tax rates; Bloomberg Tax, \"Texas Publishes 2026 Unemployment Insurance Tax Rates\"", covers: "$9,000 wage base; 2.7% new-employer rate (rates run 0.32% to 6.32%; the employment and training assessment is included in the rate)", basis: "published" },
    { ref: "Texas Labor Code ch. 62 (Texas Minimum Wage Act) adopting the FLSA rate", covers: "$7.25 minimum wage; weekly overtime only", basis: "working-knowledge" },
    { ref: "Texas Family Code 234.102", covers: "new hires reported within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Some sources say a new employer's rate is the greater of 2.7% or its industry average; TWC's 2026 page says 2.7% for every industry. Employers enter their own rate from the C-22 notice either way.",
    "No statewide paid sick leave (the Austin, Dallas and San Antonio ordinances were struck down or preempted).",
    "Texas franchise tax (an annual report, no tax due under the $2.47 million revenue threshold) isn't payroll and isn't calculated.",
    "Sales tax: TrailBook doesn't work out Texas sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
});

export const usFlorida2026 = noIncomeTaxState({
  code: "FL", name: "Florida",
  taxes: [{
    code: "FL_RT", label: "Florida reemployment tax", agency: "FDOR", paidBy: "employer", rate: "0.027", wageBase: "7000",
    assignedRate: { label: "Your Florida reemployment tax rate (%)", hint: uiHint("the Florida Department of Revenue", "the rate notice, Form UCS-1", "2.7% for their first 10 quarters") },
  }],
  reports: [{
    form: "RT-6", slug: "rt6", title: "Employer's Quarterly Report (RT-6)", codes: ["FL_RT"], agency: "FDOR",
    where: "Florida Department of Revenue online services", fileAt: "File and pay through the Florida Department of Revenue's reemployment tax online services",
  }],
  employerAccount: { label: "Florida reemployment tax account number", hint: "The 7-digit number from the Department of Revenue. It goes on the RT-6.", pattern: "^\\d{7}$" },
  wageHour: {
    minimumWage: "14.00", minimumWageChanges: [{ from: "2026-09-30", rate: "15.00" }],
    newHireReportDays: 20, newHireReportTo: "Florida New Hire Reporting Center",
  },
  sources: [
    { ref: "Florida Department of Revenue, Reemployment Tax Rate Information", covers: "$7,000 wage base; 2.7% initial rate for the first 10 quarters; 2026 rates 0.1% to 5.4%", basis: "published" },
    { ref: "Florida Constitution art. X, §24 (Amendment 2, 2020)", covers: "$14.00 minimum wage, $15.00 from September 30, 2026; CPI-indexed from 2027", basis: "published" },
    { ref: "Florida Statutes 409.2576", covers: "new hires reported within 20 days", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Tipped employees ($11.98 cash wage from September 30, 2026) aren't modelled; TrailBook checks the full minimum wage.",
    "No statewide paid sick leave.",
    "Sales tax: TrailBook doesn't work out Florida sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
});

export const usNevada2026 = noIncomeTaxState({
  code: "NV", name: "Nevada",
  taxes: [
    {
      code: "NV_UI", label: "Nevada UI", agency: "DETR", paidBy: "employer", rate: "0.0295", wageBase: "43700",
      assignedRate: { label: "Your Nevada UI rate (%)", hint: uiHint("DETR's Employment Security Division", "the Notice of Employer's Contribution Rates", "2.95%") },
    },
    { code: "NV_CEP", label: "Nevada Career Enhancement Program", agency: "DETR", paidBy: "employer", rate: "0.0005", wageBase: "43700" },
  ],
  reports: [{
    form: "NUCS-4072", slug: "nucs4072", title: "Employer's Quarterly Contribution and Wage Report (NUCS-4072)", codes: ["NV_UI", "NV_CEP"], agency: "DETR",
    where: "DETR Employer Self Service", fileAt: "File and pay through DETR's Employer Self Service",
  }],
  employerAccount: { label: "DETR employer account number", hint: "The number on your DETR notices. It goes on the NUCS-4072.", pattern: "^[0-9]{6,10}$" },
  wageHour: {
    minimumWage: "12.00",
    // NRS 608.018: over 8 hours in a 24-hour period, for employees paid under 1.5 times the minimum wage.
    overtime: { weeklyAfter: "40", dailyAfter: "8", dailyOnlyBelowHourlyRate: "18.00" },
    // NRS 608.0197: paid leave for any reason, 0.01923 hours per hour worked, for employers with 50 or more employees.
    sickLeave: {
      law: "NRS 608.0197 (employers with 50 or more employees)", hoursWorkedPerHourAccrued: "52", annualUseCapHours: "40", accrualCapHours: "40",
      smallEmployer: { under: 50, annualUseCapHours: "0", accrualCapHours: "0" },
    },
    newHireReportDays: 20, newHireReportTo: "Nevada New Hire Reporting (Division of Welfare and Supportive Services)",
  },
  sources: [
    { ref: "DETR, Contributions Newsletter June 2026; UI Information for Employers", covers: "$43,700 wage base; 2.95% new-employer rate; 0.05% Career Enhancement Program on the same base", basis: "published" },
    { ref: "NRS 608.250 as amended by AB 456 (2019); 2024 constitutional amendment", covers: "$12.00 minimum wage for all employers from July 1, 2024", basis: "working-knowledge" },
    { ref: "NRS 608.018; NRS 608.0197", covers: "daily overtime under 1.5 times the minimum wage; paid leave at 0.01923 hours per hour for 50+ employees", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Daily overtime applies only when the daily hours are entered (the \"Daily hours\" box on the pay run), and only to employees paid under $18.00 an hour; an employer and employee may agree to four 10-hour days, which TrailBook doesn't know about.",
    "Paid leave is counted at 1 hour per 52 worked (0.01923), up to 40 hours a year, for employers with 50 or more employees; smaller employers get no accrual. Check the 40-hour carryover cap reading.",
    "The Modified Business Tax (a quarterly Department of Taxation tax on wages over $50,000 a quarter, 1.17% for most businesses) isn't calculated.",
    "Sales tax: TrailBook doesn't work out Nevada sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
});

export const usTennessee2026 = noIncomeTaxState({
  code: "TN", name: "Tennessee",
  taxes: [{
    code: "TN_UI", label: "Tennessee UI", agency: "TDLWD", paidBy: "employer", rate: "0.027", wageBase: "7000",
    assignedRate: { label: "Your Tennessee UI rate (%)", hint: uiHint("the Department of Labor and Workforce Development", "the premium rate notice", "2.7%") },
  }],
  reports: [{
    form: "LB-0456", slug: "lb0456", title: "Employer's Quarterly Premium and Wage Report (LB-0456)", codes: ["TN_UI"], agency: "TDLWD",
    where: "Jobs4TN employer tax services", fileAt: "File and pay through the Department of Labor and Workforce Development's online premium and wage reporting",
  }],
  employerAccount: { label: "TDLWD employer account number", hint: "The number on your Department of Labor premium notices. It goes on the quarterly report.", pattern: "^[0-9]{6,10}$" },
  wageHour: { minimumWage: "7.25", newHireReportDays: 20, newHireReportTo: "Tennessee New Hire Reporting" },
  sources: [
    { ref: "TDLWD, UI Tax Rates page; Bloomberg Tax, \"Tennessee UI Tax Schedule Unchanged for Rest of 2026\"", covers: "$7,000 wage base; 2.7% for most new employers; Premium Rate Table 6 for 2026", basis: "published" },
    { ref: "FLSA, 29 U.S.C. 206 (Tennessee has no state minimum wage)", covers: "$7.25 minimum wage; weekly overtime only", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Some new employers (certain industries) get a different starting rate; employers enter their own from the notice.",
    "Check the quarterly report's form number (LB-0456) against the current Jobs4TN filing screens.",
    "No statewide paid sick leave for private employers.",
    "Sales tax: TrailBook doesn't work out Tennessee sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
});

export const usSouthDakota2026 = noIncomeTaxState({
  code: "SD", name: "South Dakota",
  taxes: [
    {
      code: "SD_UI", label: "South Dakota reemployment assistance", agency: "DLR", paidBy: "employer", rate: "0.012", wageBase: "15000",
      assignedRate: { label: "Your South Dakota reemployment rate (%)", hint: uiHint("the Department of Labor and Regulation", "the yearly rate notice", "1.2%") },
    },
    {
      code: "SD_FEE", label: "South Dakota investment fee", agency: "DLR", paidBy: "employer", rate: "0.0055", wageBase: "15000",
      assignedRate: { label: "Your South Dakota investment fee (%)", hint: "On the same notice. New employers pay 0.55%; experience-rated employers 0 to 0.53% plus a 0.08% administrative fee (enter the two together)." },
    },
  ],
  reports: [{
    form: "SD quarterly report", slug: "sd-ui", title: "Quarterly Contribution, Investment Fee and Wage Report", codes: ["SD_UI", "SD_FEE"], agency: "DLR",
    where: "DLR reemployment assistance online services", fileAt: "File and pay through the Department of Labor and Regulation's reemployment assistance online services",
  }],
  employerAccount: { label: "DLR reemployment assistance account number", hint: "The number on your DLR notices. It goes on the quarterly report.", pattern: "^[0-9]{5,10}$" },
  wageHour: { minimumWage: "11.85", newHireReportDays: 20, newHireReportTo: "South Dakota New Hire Reporting Center" },
  sources: [
    { ref: "SD DLR employer handbook, as summarised by TimeTrex and Paylocity", covers: "$15,000 wage base; 1.2% new-employer rate plus 0.55% investment fee; 0.08% administrative fee once rated", basis: "published" },
    { ref: "SDCL 60-11-3 (CPI-indexed)", covers: "$11.85 minimum wage from January 1, 2026", basis: "published" },
  ],
  reviewNotes: [
    "SB 26 (2026) lowers reemployment contribution rates; sources disagree on whether from July 1, 2026 or January 1, 2027. Employers enter their own rate from the DLR notice, so a rate change needs no pack change, but the new-employer default may.",
    "No statewide paid sick leave.",
    "Sales tax: TrailBook doesn't work out South Dakota sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
});

export const usWyoming2026 = noIncomeTaxState({
  code: "WY", name: "Wyoming",
  taxes: [{
    code: "WY_UI", label: "Wyoming UI", agency: "DWS", paidBy: "employer", rate: "0", wageBase: "33800",
    assignedRate: {
      label: "Your Wyoming UI rate (%)", required: true,
      hint: "Wyoming sets each new employer's rate by industry. Enter the total rate on your Department of Workforce Services notice (it includes the Employment Support Fund and adjustment factors).",
    },
  }],
  reports: [{
    form: "WY quarterly report", slug: "wy-ui", title: "Unemployment Insurance Quarterly Summary and Wage Report", codes: ["WY_UI"], agency: "DWS",
    where: "WYUI employer services", fileAt: "File and pay through the Department of Workforce Services' WYUI employer services",
  }],
  employerAccount: { label: "DWS employer account number", hint: "The number on your Department of Workforce Services notices. It goes on the quarterly report.", pattern: "^[0-9]{5,10}$" },
  wageHour: { minimumWage: "7.25", newHireReportDays: 20, newHireReportTo: "Wyoming New Hire Reporting Center" },
  sources: [
    { ref: "Wyoming DWS 2026 taxable wage base; Experian, 2026 Unemployment Tax Outlook", covers: "$33,800 wage base; new-employer rates by industry", basis: "published" },
    { ref: "FLSA, 29 U.S.C. 206 (Wyoming's own $5.15 is below it)", covers: "$7.25 minimum wage; weekly overtime only", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "No default rate: a pay run waits until the employer enters its rate, because new-employer rates range from about 2.3% to 9.8% by industry.",
    "Wyoming's state-run workers' compensation premiums are reported with the same quarterly filing but are not calculated by TrailBook yet.",
    "No statewide paid sick leave.",
    "Sales tax: TrailBook doesn't work out Wyoming sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
});

export const usNewHampshire2026 = noIncomeTaxState({
  code: "NH", name: "New Hampshire",
  taxes: [
    {
      code: "NH_UI", label: "New Hampshire UI", agency: "NHES", paidBy: "employer", rate: "0.013", wageBase: "14000",
      assignedRate: { label: "Your New Hampshire UI rate (%)", hint: uiHint("New Hampshire Employment Security", "the rate notice", "1.3% plus a 0.4% administrative contribution") },
    },
    {
      code: "NH_ADMIN", label: "New Hampshire administrative contribution", agency: "NHES", paidBy: "employer", rate: "0.004", wageBase: "14000",
      assignedRate: { label: "Your New Hampshire administrative contribution (%)", hint: "On the same notice; 0.4% in the first half of 2026. NHES can change rates each quarter." },
    },
  ],
  reports: [{
    form: "NHES quarterly report", slug: "nh-ui", title: "Employer Quarterly Tax and Wage Report", codes: ["NH_UI", "NH_ADMIN"], agency: "NHES",
    where: "NHES WebTax", fileAt: "File and pay through NHES WebTax",
  }],
  employerAccount: { label: "NHES employer account number", hint: "The number on your NHES notices. It goes on the quarterly report.", pattern: "^[0-9]{5,10}$" },
  wageHour: { minimumWage: "7.25", newHireReportDays: 20, newHireReportTo: "New Hampshire Employment Security (New Hire Reporting)" },
  sources: [
    { ref: "NHES 2026 Q1-Q2 rate chart, as reproduced by TimeTrex and Paylocity; RSA 282-A:69", covers: "$14,000 wage base; new employers 1.3% UI plus 0.4% administrative contribution", basis: "published" },
    { ref: "RSA 279:21 (adopts the federal minimum wage)", covers: "$7.25 minimum wage", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "NHES may change rates each quarter; Q3-Q4 2026 rates weren't published when this was written.",
    "New Hampshire taxes interest and dividends only until 2025 and has no wage tax; no sales tax either, so invoices there correctly carry none.",
    "No statewide paid sick leave.",
  ],
});

export const usAlaska2026 = noIncomeTaxState({
  code: "AK", name: "Alaska",
  taxes: [
    { code: "AK_UI_EE", label: "Alaska UI (employee)", agency: "AKDOL", paidBy: "employee", rate: "0.005", wageBase: "54200" },
    {
      code: "AK_UI", label: "Alaska UI", agency: "AKDOL", paidBy: "employer", rate: "0.01", wageBase: "54200",
      assignedRate: { label: "Your Alaska UI rate (%)", hint: uiHint("the Department of Labor and Workforce Development", "the yearly rate notice", "1.0%") },
    },
  ],
  reports: [{
    form: "TQ01C", slug: "tq01c", title: "Employer's Quarterly Contribution Report (TQ01C)", codes: ["AK_UI_EE", "AK_UI"], agency: "AKDOL",
    where: "Alaska Department of Labor employer tax online services", fileAt: "File and pay through the Alaska Department of Labor's employer tax online services",
  }],
  employerAccount: { label: "Alaska employer account number", hint: "The number on your Department of Labor notices. It goes on the TQ01C.", pattern: "^[0-9]{5,10}$" },
  wageHour: {
    minimumWage: "13.00", minimumWageChanges: [{ from: "2026-07-01", rate: "14.00" }],
    // Exempt employees must earn at least twice the minimum wage for 40 hours a week (AS 23.10.055).
    exemptAnnualSalaryMinimum: "54080", exemptAnnualSalaryChanges: [{ from: "2026-07-01", amount: "58240" }],
    // AS 23.10.060: over 8 hours a day or 40 a week (employers with 4 or more employees).
    overtime: { weeklyAfter: "40", dailyAfter: "8" },
    // Ballot Measure 1 (2024), from July 1, 2025: 1 hour per 30 worked; 56 hours a year for 15+ employees, 40 for fewer.
    sickLeave: {
      law: "AS 23.10.067 (Ballot Measure 1, 2024)", hoursWorkedPerHourAccrued: "30", annualUseCapHours: "56", accrualCapHours: "56",
      smallEmployer: { under: 15, annualUseCapHours: "40", accrualCapHours: "40" },
    },
    newHireReportDays: 20, newHireReportTo: "Alaska Child Support Services Division (New Hire Reporting)",
  },
  sources: [
    { ref: "Alaska DOLWD, 2026 Unemployment Insurance Tax Rates; Research and Analysis memo, November 2025", covers: "$54,200 wage base; employee rate 0.50%; employer rate 1.00% for new employers", basis: "published" },
    { ref: "Ballot Measure 1 (2024), AS 23.10.065", covers: "$13.00 minimum wage, $14.00 from July 1, 2026, $15.00 from July 1, 2027; paid sick leave from July 1, 2025", basis: "published" },
    { ref: "AS 23.10.055, 23.10.060", covers: "exempt salary twice the minimum wage for 40 hours; daily and weekly overtime", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Daily overtime applies only to employers with 4 or more employees; TrailBook applies it to everyone, which only matters when daily hours are entered.",
    "Paid sick leave caps are read as both a use and an accrual cap; check the statute's carryover rule.",
    "The employee UI contribution has no box on the W-2; it's shown on pay stubs and the quarterly report.",
    "Alaska has no state sales tax (many boroughs and cities do); TrailBook doesn't work out local Alaska sales tax yet.",
  ],
});

export const usWashington2026 = noIncomeTaxState({
  code: "WA", name: "Washington",
  taxes: [
    { code: "WA_PFML_EE", label: "Washington Paid Leave (employee)", agency: "ESD", paidBy: "employee", rate: "0.008072", wageBase: "184500" },
    { code: "WA_CARES", label: "WA Cares", agency: "ESD", paidBy: "employee", rate: "0.0058", wageBase: null },
    {
      code: "WA_UI", label: "Washington UI", agency: "ESD", paidBy: "employer", rate: "0", wageBase: "78200",
      assignedRate: {
        label: "Your Washington UI rate (%)", required: true,
        hint: "ESD sets each new employer's rate by industry. Enter the total rate on your ESD notice (it includes the employment administration fund).",
      },
    },
    {
      code: "WA_PFML_ER", label: "Washington Paid Leave (employer)", agency: "ESD", paidBy: "employer", rate: "0", wageBase: "184500",
      assignedRate: { label: "Your Washington Paid Leave employer share (%)", hint: "Employers with 50 or more employees in Washington pay 0.3228% in 2026; smaller employers pay nothing (leave this blank)." },
    },
  ],
  reports: [
    {
      form: "ESD quarterly report", slug: "wa-ui", title: "Unemployment Insurance Quarterly Tax and Wage Report", codes: ["WA_UI"], agency: "ESD",
      where: "ESD eServices", fileAt: "File and pay through ESD eServices",
    },
    {
      form: "Paid Leave and WA Cares report", slug: "wa-paid-leave", title: "Paid Family and Medical Leave and WA Cares Quarterly Report", codes: ["WA_PFML_EE", "WA_PFML_ER", "WA_CARES"], agency: "ESD",
      where: "Paid Leave and WA Cares online reporting (SecureAccess Washington)", fileAt: "File and pay through Paid Leave's online reporting",
    },
  ],
  employerAccount: { label: "ESD employer reference number", hint: "The number on your ESD notices. It goes on the quarterly reports.", pattern: "^[0-9]{6,10}$" },
  wageHour: {
    minimumWage: "17.13",
    // WAC 296-128-545: 2.25 times the minimum wage for 40 hours a week in 2026.
    exemptAnnualSalaryMinimum: "80168.40",
    // RCW 49.46.210: 1 hour per 40 worked, up to 40 hours carried over; no yearly use cap.
    sickLeave: { law: "RCW 49.46.210", hoursWorkedPerHourAccrued: "40", annualUseCapHours: "40", accrualCapHours: null },
    newHireReportDays: 20, newHireReportTo: "Washington Division of Child Support (New Hire Reporting)",
  },
  sources: [
    { ref: "ESD, \"Paid Family & Medical Leave premium rate increases to 1.13% in 2026\"; paidleave.wa.gov updates", covers: "1.13% total, employees 71.43% (0.8072%), employers 28.57% (0.3228%) for 50+ employees; up to the Social Security wage base ($184,500)", basis: "published" },
    { ref: "RCW 50B.04.080 (WA Cares)", covers: "0.58% employee premium on all wages", basis: "working-knowledge" },
    { ref: "ESD 2026 taxable wage base (Bloomberg Tax)", covers: "$78,200 UI wage base; new employers by industry", basis: "published" },
    { ref: "L&I, 2026 minimum wage and exempt salary", covers: "$17.13 minimum wage; $80,168.40 exempt salary", basis: "published" },
  ],
  reviewNotes: [
    "Workers' compensation through L&I is charged per hour worked by risk class, partly withheld from employees, and reported quarterly. TrailBook doesn't calculate it yet; this is the main gap before releasing Washington.",
    "WA Cares exemptions (employees approved by ESD) aren't modelled: everyone pays the 0.58%.",
    "The year-end 40-hour sick leave carryover cap isn't applied; balances keep growing. Front-loading grants 40 hours.",
    "Seattle, SeaTac, Tukwila, Renton, Bellingham, Burien, Everett and King County have higher local minimum wages that TrailBook doesn't check yet.",
    "Sales tax: TrailBook doesn't work out Washington sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.",
  ],
});

export const NO_INCOME_TAX_STATES_2026: readonly StateRulePack[] = [
  usTexas2026, usFlorida2026, usNevada2026, usTennessee2026, usSouthDakota2026, usWyoming2026, usNewHampshire2026, usAlaska2026, usWashington2026,
];
