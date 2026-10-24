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
