// Canadian rule packs. Canada withholds federal and provincial income tax
// together on one paycheque, with CPP (QPP in Quebec), EI and, in Quebec,
// QPIP, so it gets its own pack kinds next to the US ones: one federal pack
// per span of time and one pack per province or territory. Figures follow
// CRA's T4127 Payroll Deductions Formulas (every province but Quebec) and
// Revenu Québec's TP-1015.F-V (Quebec income tax).

import type { EntityDefaults, RulePackMeta } from "../types.js";

export type { Source } from "../types.js";

/** A rate threshold: `rate` applies to annual taxable income above `over`. */
export interface RateRow {
  over: string;
  rate: string;
  /** The published constant (K, KP): tax = rate × income − constant. */
  constant?: string;
}

/** CPP or QPP for the year: first and second (CPP2/QPP2) contributions. */
export interface PensionPlanRules {
  /** Employee rate on earnings above the basic exemption up to the YMPE (CPP 5.95%: base 4.95% + first additional 1%). */
  rate: string;
  /** The base part of `rate`, which earns the non-refundable credit; the rest is deducted from income. */
  baseRate: string;
  basicExemption: string;
  /** Year's maximum pensionable earnings. */
  ympe: string;
  /** Second additional contribution rate on earnings from the YMPE to the YAMPE. */
  secondRate: string;
  /** Year's additional maximum pensionable earnings. */
  yampe: string;
}

export interface CanadaFederalRulePack extends RulePackMeta {
  kind: "ca-federal";
  cpp: PensionPlanRules;
  /** Quebec Pension Plan, for employees reported to Quebec. */
  qpp: PensionPlanRules;
  ei: {
    rate: string;
    /** Lower rate for Quebec employees, who are covered by QPIP for parental benefits. */
    quebecRate: string;
    /** The employer pays this multiple of the employee premium unless ESDC has granted a reduced rate. */
    employerMultiple: string;
    maxInsurableEarnings: string;
  };
  qpip: { employeeRate: string; employerRate: string; maxInsurableEarnings: string };
  incomeTax: {
    brackets: RateRow[];
    /** Lowest rate: the rate for non-refundable credits (K1 to K4). */
    creditRate: string;
    /** Basic personal amount: `max` up to net income `phaseFrom`, falling evenly to `min` at `phaseTo`. */
    basicPersonalAmount: { max: string; min: string; phaseFrom: string; phaseTo: string };
    canadaEmploymentAmount: string;
    /** Quebec abatement: share of basic federal tax refunded to Quebec residents (16.5%). */
    quebecAbatement: string;
  };
  entityDefaults: EntityDefaults;
}

/** Ontario Health Premium style schedule: premium = min(cap, base + rate × (income − over)) for the last row at or below income. */
export interface PremiumRow {
  over: string;
  base: string;
  rate: string;
  cap: string;
}

/**
 * Provincial income tax by T4127 chapter 4: the brackets less credits at the
 * lowest rate, with the province's extras.
 */
export interface T4127ProvincialTax {
  method: "t4127";
  /** The province's own TD1 (TD1BC, TD1ON...). */
  td1: string;
  brackets: RateRow[];
  /** Rate for non-refundable credits (K1P, K2P). Usually the lowest bracket rate. */
  creditRate: string;
  /** Basic personal amount, the claim when no TD1 is on file; "federal" follows the federal amount (Yukon). */
  basicPersonalAmount: string | "federal";
  /** A TD1 claim of exactly `old` is read as `now` (Newfoundland and Labrador's mid-year basic personal amount; no new TD1NL needed). */
  claimReplaced?: { old: string; now: string };
  /** The basic personal amount shrinks to `min` between these annual incomes (Manitoba: to nothing from $200,000 to $400,000). */
  bpaPhaseOut?: { from: string; to: string; min: string };
  /** Surtax on basic provincial tax (V1), each row a rate on the tax above `over` (Ontario 20% and 36%). */
  surtax?: RateRow[];
  /** Ontario Health Premium (V2), by annual taxable income. */
  healthPremium?: PremiumRow[];
  /** Low-income reduction (S). */
  taxReduction?:
    /** BC: `amount` less `rate` of income above `over`, up to the tax. */
    | { kind: "bc"; amount: string; over: string; rate: string; zeroAbove: string }
    /** Ontario: twice the basic amount (plus per-dependant amounts) less the tax, up to the tax. */
    | { kind: "on"; basic: string; perDependant: string };
  /** Yukon: the Canada employment amount is a provincial credit too (K4P). */
  canadaEmploymentAmount?: boolean;
  /** Alberta (K5P): `rate` of the credits K1P + K2P above `over` ($4,896, 25%). */
  supplementalCredit?: { over: string; rate: string };
}

/** Quebec income tax by TP-1015.F-V. */
export interface QuebecIncomeTax {
  method: "quebec";
  td1: "TP-1015.3";
  brackets: RateRow[];
  /** Rate for personal tax credits (E). */
  creditRate: string;
  /** Basic personal amount, the claim when no TP-1015.3 is on file. */
  basicPersonalAmount: string;
  /** Deduction for employment income (J): this rate of earnings, up to `max` a year. */
  employmentDeduction: { rate: string; max: string };
  /** Credit on Fonds de solidarité FTQ and Fondaction shares bought through payroll (15%). */
  labourFundCreditRate: string;
}

/** One province or territory's payroll rules for one span of time. */
export interface ProvinceRulePack extends RulePackMeta {
  kind: "ca-province";
  name: string;
  incomeTax: T4127ProvincialTax | QuebecIncomeTax;
}

export type CanadaRulePack = CanadaFederalRulePack | ProvinceRulePack;
