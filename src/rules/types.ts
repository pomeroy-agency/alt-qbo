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
  futa: { rate: string; wageBase: string; note: string };
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

export interface CaliforniaPayrollRules {
  /** EDD Method B (exact calculation), annual tables. */
  pit: {
    lowIncomeExemption: { single: string; marriedLow: string; marriedHigh: string; hoh: string };
    standardDeduction: { single: string; marriedLow: string; marriedHigh: string; hoh: string };
    estimatedDeductionPerAllowance: string;
    exemptionCreditPerAllowance: string;
    brackets: Record<CaFilingStatus, Bracket[]>;
    supplementalRate: string;
    bonusSupplementalRate: string;
  };
  sdi: { rate: string; wageBase: string | null };
  ui: { wageBase: string; newEmployerRate: string };
  ett: { rate: string; wageBase: string };
  /** When PIT and SDI withholding must be deposited, by accumulated PIT; UI and ETT are quarterly. */
  deposits: {
    /** Accumulated PIT at or above this by a month's end is due the 15th of the next month. */
    monthlyAtOrAbove: string;
    /** For semiweekly and next-day federal depositors, PIT accumulated above this follows the federal timing. */
    federalTimingOver: string;
  };
}

export interface CaliforniaWageHourRules {
  minimumWage: string;
  exemptAnnualSalaryMinimum: string;
  dailyOvertimeAfter: string;
  dailyDoubleTimeAfter: string;
  weeklyOvertimeAfter: string;
  seventhDayDoubleTimeAfter: string;
  sickLeave: { hoursWorkedPerHourAccrued: string; annualUseCapHours: string; accrualCapHours: string };
  newHireReportDays: number;
}

export interface EntityDefaults {
  framework: "US_GAAP" | "IFRS" | "IFRS_SME" | "FRS102" | "ASPE";
  functionalCurrency: string;
  fiscalYearStartMonth: number;
  coaTemplate: string;
  ledgerRetentionYears: number;
  payrollRetentionYears: number;
}

export interface CaliforniaBusinessRules {
  salesTax: { servicesTaxableByDefault: boolean; remoteSellerNexusThreshold: string };
  franchiseTax: { annualMinimum: string; appliesTo: string[] };
  payDataReportEmployeeThreshold: number;
}

export interface FederalRulePack extends RulePackMeta {
  kind: "us-federal";
  payroll: FederalPayrollRules;
  entityDefaults: EntityDefaults;
}

export interface CaliforniaRulePack extends RulePackMeta {
  kind: "us-ca";
  payroll: CaliforniaPayrollRules;
  wageHour: CaliforniaWageHourRules;
  business: CaliforniaBusinessRules;
}

export type RulePack = FederalRulePack | CaliforniaRulePack;
