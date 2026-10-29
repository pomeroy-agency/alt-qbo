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
    }
  /**
   * Oregon's annual computer formula (150-206-436): wages less federal tax
   * withheld (capped, phasing out at high wages) less the standard deduction,
   * through the brackets, less the exemption credit per allowance.
   */
  | {
      method: "or_formula";
      certificate: string;
      /** Withheld when no certificate is on file (ORS 316.182, HB 2119). */
      noCertificateRate: string;
      standardDeduction: { single: string; married: string };
      /** Most federal tax that may be subtracted, by annual wages: the row with the highest `wagesFrom` at or below the wages. */
      federalSubtraction: { single: { wagesFrom: string; cap: string }[]; married: { wagesFrom: string; cap: string }[] };
      exemptionCredit: string;
      /** No allowances above these annual wages. */
      allowancesZeroAbove: { single: string; married: string };
      /** Annual wages from which the `high` brackets apply. */
      highWageFrom: string;
      /** Each row: tax = base + (BASE - over) x rate, for BASE from `over` up to the next row. */
      brackets: Record<"low" | "high", Record<"single" | "married", { over: string; base: string; rate: string }[]>>;
    }
  /**
   * New York's exact calculation method (NYS-50-T-NYS, Method II): wages less
   * the deduction and exemption allowances for the pay period, through the
   * period's table; Method III's flat top rates above the tables.
   */
  | {
      method: "ny_exact";
      certificate: string;
      /** Table B: deduction allowance per pay period. */
      deduction: Record<"weekly" | "biweekly" | "semimonthly" | "monthly", { single: string; married: string }>;
      /** Table C: one exemption per pay period. */
      exemption: Record<"weekly" | "biweekly" | "semimonthly" | "monthly", string>;
      /** Tables II-A to II-D. Each row: tax = add + (net - subtract) x rate, for net from `from` up to the next row. */
      tables: Record<"single" | "married", Record<"weekly" | "biweekly" | "semimonthly" | "monthly", { from: string; subtract: string; rate: string; add: string }[]>>;
      /** Method III: from `from` annualized net wages, that rate of all of it. */
      topRates: Record<"single" | "married", { from: string; rate: string }[]>;
    }
  /**
   * The common annualized formula: wages for the year, less the filing
   * status's standard deduction (or the dollar allowance the employee
   * entered) and the allowances claimed, through the status's rates, less
   * any credit, divided by the pay periods (Illinois, Colorado, North
   * Carolina, Georgia, Utah, Idaho).
   */
  | {
      method: "annual_formula";
      /** The state's own certificate; null where the state uses the federal W-4 alone (Utah). */
      certificate: string | null;
      statuses: AnnualFormulaStatus[];
      /** Status used when the employee hasn't filed the state certificate. */
      noCertificateStatus: string;
      /** The status follows the federal W-4 when there's no state certificate on file (Colorado, Utah). */
      statusFromW4?: Record<FederalFilingStatus, string>;
      /** Kinds of allowances on the certificate (Illinois lines 1 and 2), each a deduction from the year's wages. */
      allowances: { label: string; amount: string }[];
      /** The employee may enter a dollar allowance that replaces the standard deduction (Colorado DR 0004 line 2). */
      dollarAllowance?: { label: string };
      /** Marginal rates on taxable wages for the year, by `AnnualFormulaStatus.table`. */
      tables: Record<string, { over: string; rate: string }[]>;
      /** Round each paycheck's amount to the cent or, as North Carolina asks, the whole dollar. */
      round: "cent" | "dollar";
    };

/** One filing status on a state certificate. */
export interface AnnualFormulaStatus {
  id: string;
  label: string;
  standardDeduction: string;
  table: string;
  /** Utah's base allowance: a credit that shrinks by `phaseOutRate` of wages above `phaseOutFrom`. */
  credit?: { base: string; phaseOutFrom: string; phaseOutRate: string };
}

type PayPeriodKey = "weekly" | "biweekly" | "semimonthly" | "monthly";

/** How a city's income tax is withheld. */
export type LocalIncomeTaxRules =
  /** New York City: the NYS-50-T-NYC exact calculation method; the same table for single and married. */
  | {
      method: "ny_exact";
      deduction: Record<PayPeriodKey, { single: string; married: string }>;
      exemption: Record<PayPeriodKey, string>;
      tables: Record<PayPeriodKey, { from: string; subtract: string; rate: string; add: string }[]>;
    }
  /** Yonkers residents: a share of the state withholding worked out before any extra withholding. */
  | { method: "share_of_state"; share: string }
  /** Yonkers nonresidents: a rate on wages less an exclusion by wage level; no tax where the exclusion is null. */
  | { method: "exclusion_percent"; rate: string; exclusions: Record<PayPeriodKey, { from: string; exclusion: string | null }[]> };

/** A city income tax withheld for employees who live (or work) there; each employee says which apply. */
export interface LocalIncomeTax {
  /** Stable id stored on the employee, like "nyc". */
  id: string;
  /** On forms and pay stubs, like "NYC income tax". */
  name: string;
  /** For the employee form, like "Lives in New York City". */
  label: string;
  /** Tax code on pay stubs, like "NYC_WH". */
  code: string;
  agency: string;
  account: string;
  /** Locality name for W-2 box 20, like "NYC" or "YONKERS". */
  w2Locality: string;
  rules: LocalIncomeTaxRules;
}

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
  /** Charged per hour worked instead of on wages (Oregon's Workers' Benefit Fund: cents an hour); `rate` is then unused. */
  perHour?: string;
  /** Most withheld for each week in the pay period (New York SDI: $0.60 a week). */
  perWeekCap?: string;
  /** Paid to the employer's insurance carrier rather than a state agency (New York SDI and Paid Family Leave). */
  paidToCarrier?: boolean;
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
   * otherwise quarterly with the return (Arizona). Null: always on the
   * federal dates (Oregon).
   */
  | (DepositRuleBase & { schedule: "federal_timing_by_average"; federalTimingAverageOver: string | null; report: string })
  /**
   * Withholding paid within `businessDays` business days of the payday on
   * which the amount not yet paid reaches `atOrAbove`; what's left at the
   * quarter's end is paid with the return (New York's $700 rule).
   */
  | (DepositRuleBase & { schedule: "accumulated_threshold"; atOrAbove: string; businessDays: number; report: string })
  /**
   * Monthly, due on `dueDay` of the next month (or its last day), unless
   * last year's withholding was over `lookbackOver`: then on the federal
   * semiweekly dates, or for "weekly" by the third business day after the
   * Friday of the payday's week (Colorado). Null: always monthly.
   */
  | (DepositRuleBase & { schedule: "monthly_or_larger"; lookbackOver: string | null; largeFiler: "federal" | "weekly"; dueDay: number | "last"; report: string });

/** A quarterly return or wage report the state wants. */
export interface StateQuarterlyForm {
  /** As the agency names it, like "DE 9" or "C-3". */
  form: string;
  /** URL-safe name for the form page. */
  slug: string;
  title: string;
  /**
   * "ca_de9" is California's combined return; "ui_wage_report" and
   * "withholding_return" are generic; "combined_return" reports UI wages
   * (`codes`) and withholding (`withholdingCodes`) together (Oregon OQ, New York NY-45).
   */
  kind: "ca_de9" | "ui_wage_report" | "withholding_return" | "combined_return";
  /** Tax codes the form reports: wage-based taxes, or for a withholding return the amounts withheld. */
  codes: string[];
  /** A combined return's withheld taxes (state income tax, Oregon's statewide transit tax). */
  withholdingCodes?: string[];
  fileAt: string;
}

/** A part of a state with its own minimum wage (and exempt salary): Portland metro, New York City. */
export interface WageArea {
  name: string;
  minimumWage: string;
  minimumWageChanges?: { from: string; rate: string }[];
  exemptAnnualSalaryMinimum?: string;
  exemptAnnualSalaryChanges?: { from: string; amount: string }[];
}

export interface StateWageHourRules {
  minimumWage: string;
  /** Areas whose rates replace the statewide ones for employees who work there; the statewide rates apply elsewhere. */
  areas?: WageArea[];
  /** What to call the statewide rates when the state has areas, like "Standard (most of Oregon)". */
  defaultAreaName?: string;
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
    /** City income taxes withheld with the state's (New York City, Yonkers). */
    localIncomeTaxes?: LocalIncomeTax[];
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
