// Rule packs hold every rate, threshold and default for one place and one
// span of time. A released pack is never edited; a change is a new pack with
// a new version and its own effective dates, so a 2026 return is always
// computed under 2026 rules.

export type PackStatus =
  /** Figures entered but not yet reviewed; usable in tests and previews only. */
  | "draft"
  /** Reviewed and signed off; the only status allowed for live pay runs. */
  | "released";

export interface Place {
  country: string;
  region?: string;
  locality?: string;
}

/** A provenance note: where a figure came from and whether it was checked. */
export interface Source {
  ref: string;
  covers: string;
  /** "published" = copied from the agency's own document; "derived" = computed from published inputs. */
  basis: "published" | "derived" | "working-knowledge";
}

export interface RulePackMeta {
  id: string;
  version: string;
  place: Place;
  effectiveFrom: string;
  effectiveTo: string;
  status: PackStatus;
  sources: Source[];
  /** Items for Greg's review (or a licensed adviser's) before release. */
  reviewNotes: string[];
}

/** Bracket row: tax = base + rate * (amount - over), for the highest row with over <= amount. */
export interface Bracket {
  over: string;
  rate: string;
  base: string;
}

export type FederalFilingStatus = "single_or_mfs" | "mfj" | "hoh";

export interface FederalPayrollRules {
  socialSecurity: { employeeRate: string; employerRate: string; wageBase: string };
  medicare: { employeeRate: string; employerRate: string; additionalRate: string; additionalThreshold: string };
  futa: {
    rate: string;
    wageBase: string;
    note: string;
    /** Form 940 Schedule A credit reduction rate by state; null until the Department of Labor publishes it in November. */
    creditReduction: Record<string, string | null>;
  };
  supplementalRate: string;
  /** When the taxes reported on Form 941 and 940 must be deposited (Pub 15 sections 11 and 14). */
  deposits: {
    /** Lookback-period taxes above this make a semiweekly depositor. */
    semiweeklyLookbackOver: string;
    /** Taxes accumulated to this in a deposit period are due the next business day. */
    nextDayAtOrAbove: string;
    /** A quarter's Form 941 taxes under this may be paid with the return. */
    payWithReturnUnder: string;
    /** FUTA owed above this at a quarter's end is deposited; less carries forward. */
    futaDepositOver: string;
  };
  /** Inputs to Pub 15-T Worksheet 1A, annual percentage method. */
  incomeTax: {
    /** Rate thresholds on taxable income for the year, per filing status. */
    brackets: Record<FederalFilingStatus, { over: string; rate: string }[]>;
    standardDeduction: Record<FederalFilingStatus, string>;
    /** Worksheet 1A line 1g, used when the W-4 Step 2 box is not checked. */
    line1g: { mfj: string; other: string };
  };
}

export type CaFilingStatus = "single" | "married" | "hoh";

/** California EDD Method B (exact calculation), annual tables. */
export interface CaliforniaPitTables {
  lowIncomeExemption: { single: string; marriedLow: string; marriedHigh: string; hoh: string };
  standardDeduction: { single: string; marriedLow: string; marriedHigh: string; hoh: string };
  estimatedDeductionPerAllowance: string;
  exemptionCreditPerAllowance: string;
  brackets: Record<CaFilingStatus, Bracket[]>;
  supplementalRate: string;
  bonusSupplementalRate: string;
}

/**
 * How a state (or province) works out income tax withholding. Each method is
 * one calculation in src/payroll/state-withholding.ts; a state that uses a
 * method already written needs only its figures.
 */
export type StateIncomeTaxRules =
  /** No wage income tax (Texas, Florida, Washington, Nevada...). */
  | { method: "none" }
  /** California's EDD Method B, from the employee's DE 4. */
  | { method: "ca_method_b"; certificate: "DE 4"; tables: CaliforniaPitTables }
  /**
   * The employee elects a flat percentage of each paycheck on the state's
   * certificate (Arizona Form A-4); `defaultRate` applies when they haven't
   * filed one.
   */
  | {
      method: "elected_percent";
      certificate: string;
      choices: string[];
      defaultRate: string;
      /** The certificate allows electing zero when no tax is expected for the year. */
      zeroAllowed: boolean;
    };

/** A state payroll tax on wages other than income tax: SDI, UI, ETT, job training tax and the like. */
export interface StatePayrollTax {
  /** Tax code on pay stubs and in pay run totals, like "CA_SDI" or "TX_UI". */
  code: string;
  label: string;
  /** Short agency name, like "EDD" or "TWC". */
  agency: string;
  paidBy: "employee" | "employer";
  /** The rate, or for an assigned rate the new-employer rate used until the employer enters theirs. */
  rate: string;
  /** Annual wage base per employee; null for no limit. */
  wageBase: string | null;
  /** The agency assigns each employer its own rate (UI); the employer enters it in payroll settings. */
  assignedRate?: {
    label: string;
    hint: string;
    /** No usable default (Washington's and Wyoming's new-employer rates depend on the industry): pay runs wait for the employer's rate. */
    required?: boolean;
  };
  /** System key of the liability account the tax is credited to. */
  account: string;
}

/** A payroll liability account the state's taxes need, added to the chart of accounts at setup. */
export interface StateAccount {
  code: string;
  name: string;
  systemKey: string;
}

interface DepositRuleBase {
  /** Deposit kind, stable across years: payments recorded against it point here. */
  kind: string;
  codes: string[];
  agency: string;
  what: string;
  where: string;
}

/** When the state's taxes are paid. */
export type StateDepositRule =
  /** California PIT and SDI: quarterly, monthly or on the federal semiweekly timing by amount withheld. */
  | (DepositRuleBase & { schedule: "ca_edd"; monthlyAtOrAbove: string; federalTimingOver: string })
  /** Paid with the quarterly report, by the last day of the month after the quarter (UI everywhere). */
  | (DepositRuleBase & { schedule: "quarterly"; report: string })
  /**
   * Withholding paid on the federal 941 deposit dates when the average of the
   * last four quarters' state withholding is over `federalTimingAverageOver`,
   * otherwise quarterly with the return (Arizona).
   */
  | (DepositRuleBase & { schedule: "federal_timing_by_average"; federalTimingAverageOver: string; report: string });

/** A quarterly return or wage report the state wants. */
export interface StateQuarterlyForm {
  /** As the agency names it, like "DE 9" or "C-3". */
  form: string;
  /** URL-safe name for the form page. */
  slug: string;
  title: string;
  /** "ca_de9" is California's combined return; "ui_wage_report" and "withholding_return" are generic. */
  kind: "ca_de9" | "ui_wage_report" | "withholding_return";
  /** Tax codes the form reports. */
  codes: string[];
  fileAt: string;
}

export interface StateWageHourRules {
  minimumWage: string;
  /** Rate changes part-way through the pack's span; each applies from its date on. */
  minimumWageChanges?: { from: string; rate: string }[];
  /** Exempt (salaried) employees must earn at least this a year; the federal $684 a week where the state sets nothing higher. */
  exemptAnnualSalaryMinimum: string;
  /** Changes to the exempt salary part-way through the pack's span (it follows the minimum wage in some states). */
  exemptAnnualSalaryChanges?: { from: string; amount: string }[];
  overtime: {
    weeklyAfter: string;
    /** California-style daily overtime; absent where only the weekly rule applies. */
    dailyAfter?: string;
    dailyDoubleTimeAfter?: string;
    seventhDayDoubleTimeAfter?: string;
    /** The daily rule applies only to employees paid less than this an hour (Nevada: 1.5 times the minimum wage). */
    dailyOnlyBelowHourlyRate?: string;
  };
  /** Statewide paid sick leave law; null where there is none. */
  sickLeave: {
    law: string;
    hoursWorkedPerHourAccrued: string;
    annualUseCapHours: string;
    /** Most hours a balance can reach; null where the law sets no cap. */
    accrualCapHours: string | null;
    /** Smaller employers may cap use and accrual lower (Arizona: under 15 employees, 24 hours). */
    smallEmployer?: { under: number; annualUseCapHours: string; accrualCapHours: string | null };
  } | null;
  newHireReportDays: number;
  newHireReportTo: string;
}

/** What the state's payroll settings ask the employer for. */
export interface StateEmployerAccount {
  label: string;
  hint: string;
  /** Digits only, after spaces and dashes are removed. */
  pattern: string;
  /** How it's printed, # for each digit, like "###-####-#". */
  format?: string;
}

export interface StateBusinessRules {
  /** Null until TrailBook has a sales tax pack for the state; invoices then carry no tax. */
  salesTax: { servicesTaxableByDefault: boolean; remoteSellerNexusThreshold: string } | null;
  franchiseTax?: { annualMinimum: string; appliesTo: string[] };
  payDataReportEmployeeThreshold?: number;
}

/**
 * One state or province's payroll and business rules for one span of time.
 * Adding a state is a new pack: a withholding method, its taxes, deposit
 * rules, forms and wage-and-hour figures.
 */
export interface StateRulePack extends RulePackMeta {
  kind: "state";
  /** Display name, like "California". */
  name: string;
  /** Business-day calendar for the state's own due dates; see src/payroll/business-days.ts. */
  calendar: "california" | "weekends";
  payroll: {
    incomeTax: StateIncomeTaxRules;
    /** Agency that takes state income tax withheld, when there is one. */
    incomeTaxAgency?: { agency: string; code: string; label: string; account: string };
    taxes: StatePayrollTax[];
    deposits: StateDepositRule[];
    employerAccount: StateEmployerAccount;
    accounts: StateAccount[];
  };
  forms: {
    quarterly: StateQuarterlyForm[];
    /** W-2 box 14 lines for employee taxes, like CASDI. */
    w2Box14: { code: string; label: string }[];
  };
  wageHour: StateWageHourRules;
  business: StateBusinessRules;
}

export interface EntityDefaults {
  framework: "US_GAAP" | "IFRS" | "IFRS_SME" | "FRS102" | "ASPE";
  functionalCurrency: string;
  fiscalYearStartMonth: number;
  coaTemplate: string;
  ledgerRetentionYears: number;
  payrollRetentionYears: number;
}

export interface FederalRulePack extends RulePackMeta {
  kind: "us-federal";
  payroll: FederalPayrollRules;
  entityDefaults: EntityDefaults;
}

export type RulePack = FederalRulePack | StateRulePack;
