import { D, type Dec } from "../core/money.js";
import type { LocalIncomeTax, StateIncomeTaxRules } from "../rules/types.js";
import { californiaWithholding, type DE4 } from "./california.js";

/**
 * An employee's state withholding certificate for a state other than
 * California (whose DE 4 is kept on its own). Which fields count depends on
 * the state's method.
 */
export interface StateWithholding {
  /** Elected-percentage states (Arizona A-4): the rate chosen, like "0.025"; absent means the default. */
  rate?: string;
  /** Extra withholding each paycheck. */
  additionalWithholding?: string;
  /** Claimed exempt (or elected zero) for the year. */
  exempt?: boolean;
  /** Allowance states (Oregon OR-W-4, New York IT-2104): the status claimed; "married_single_rate" is married withholding at the single rate. */
  filingStatus?: "single" | "married" | "married_single_rate";
  /** Allowance states: allowances (exemptions) claimed. */
  allowances?: number;
  /** City income taxes that apply to the employee, by id (New York: "nyc", "yonkers", "yonkers_nr"). */
  localities?: string[];
}

type Frequency = "weekly" | "biweekly" | "semimonthly" | "monthly";
const FREQUENCY: Record<number, Frequency> = { 52: "weekly", 26: "biweekly", 24: "semimonthly", 12: "monthly" };

/** The bracket row in force: the last one whose start is at or below the amount. */
function row<T>(rows: T[], amount: Dec, start: (r: T) => string): T {
  return [...rows].reverse().find((r) => amount.gte(start(r))) ?? rows[0]!;
}

function oregonWithholding(rules: Extract<StateIncomeTaxRules, { method: "or_formula" }>, c: StateWithholding, wages: Dec, fit: Dec, periods: number): Dec {
  const annual = wages.mul(periods);
  // OR-W-4: single with 3 or more allowances uses the married table and deduction, but the single phase-out and allowance limit.
  const married = c.filingStatus === "married";
  const asSingle = !married;
  const allowanceCount = c.allowances ?? 0;
  const table = married || allowanceCount >= 3 ? "married" : "single";
  const phaseOut = asSingle ? "single" : "married";
  const capRow = row(rules.federalSubtraction[phaseOut], annual, (r) => r.wagesFrom);
  const fedSub = D.min(fit.mul(periods), capRow.cap);
  const base = D.max(annual.sub(fedSub).sub(rules.standardDeduction[table]), 0);
  const band = annual.gte(rules.highWageFrom) ? "high" : "low";
  const b = row(rules.brackets[band][table], base, (r) => r.over);
  const allowances = annual.gt(rules.allowancesZeroAbove[phaseOut]) ? 0 : allowanceCount;
  const tax = new D(b.base).add(base.sub(b.over).mul(b.rate)).sub(new D(rules.exemptionCredit).mul(allowances));
  return D.max(tax, 0).div(periods);
}

function newYorkWithholding(rules: Extract<StateIncomeTaxRules, { method: "ny_exact" }>, c: StateWithholding, wages: Dec, periods: number): Dec {
  const freq = FREQUENCY[periods];
  if (!freq) throw new Error(`no New York table for ${periods} pay periods a year`);
  // IT-2104: married withholding at the higher single rate, and head of household, use the single tables.
  const status = c.filingStatus === "married" ? "married" : "single";
  const net = D.max(wages.sub(rules.deduction[freq][status]).sub(new D(rules.exemption[freq]).mul(c.allowances ?? 0)), 0);
  const annualNet = net.mul(periods);
  const top = [...rules.topRates[status]].reverse().find((r) => annualNet.gte(r.from));
  if (top) return annualNet.mul(top.rate).div(periods);
  const r = row(rules.tables[status][freq], net, (x) => x.from);
  return new D(r.add).add(net.sub(r.subtract).mul(r.rate));
}

/** One city income tax for one paycheck; zero when the employee didn't claim the city. */
export function localWithholding(
  local: LocalIncomeTax, stateRules: StateIncomeTaxRules, c: StateWithholding | null | undefined, wagesThisPeriod: Dec, periodsPerYear: number,
): Dec {
  const cert = c ?? {};
  if (!cert.localities?.includes(local.id) || cert.exempt) return new D(0);
  const freq = FREQUENCY[periodsPerYear];
  if (!freq) throw new Error(`no ${local.label} table for ${periodsPerYear} pay periods a year`);
  const r = local.rules;
  switch (r.method) {
    case "ny_exact": {
      const status = cert.filingStatus === "married" ? "married" : "single";
      const net = D.max(wagesThisPeriod.sub(r.deduction[freq][status]).sub(new D(r.exemption[freq]).mul(cert.allowances ?? 0)), 0);
      const x = row(r.tables[freq], net, (t) => t.from);
      return new D(x.add).add(net.sub(x.subtract).mul(x.rate)).toDecimalPlaces(2);
    }
    case "share_of_state": {
      if (stateRules.method !== "ny_exact") throw new Error(`${local.label} needs New York's state method`);
      return newYorkWithholding(stateRules, cert, wagesThisPeriod, periodsPerYear).mul(r.share).toDecimalPlaces(2);
    }
    case "exclusion_percent": {
      const x = row(r.exclusions[freq], wagesThisPeriod, (t) => t.from);
      if (x.exclusion === null) return new D(0);
      return D.max(wagesThisPeriod.sub(x.exclusion), 0).mul(r.rate).toDecimalPlaces(2);
    }
  }
}

/** State income tax withheld from one paycheck, by the state's method. */
export function stateWithholding(
  rules: StateIncomeTaxRules,
  cert: { de4?: DE4; state?: StateWithholding | null },
  wagesThisPeriod: Dec,
  periodsPerYear: number,
  /** Federal income tax withheld from the same paycheck (Oregon subtracts it). */
  federalWithheld: Dec = new D(0),
): Dec {
  switch (rules.method) {
    case "none":
      return new D(0);
    case "ca_method_b":
      if (!cert.de4) throw new Error("a California employee needs a DE 4");
      return californiaWithholding(rules.tables, cert.de4, wagesThisPeriod, periodsPerYear);
    case "elected_percent": {
      const c = cert.state ?? {};
      if (c.exempt) return new D(0);
      const rate = c.rate && rules.choices.includes(c.rate) ? c.rate : rules.defaultRate;
      return wagesThisPeriod.mul(rate).add(c.additionalWithholding ?? 0).toDecimalPlaces(2);
    }
    case "or_formula": {
      const c = cert.state;
      if (!c) return wagesThisPeriod.mul(rules.noCertificateRate).toDecimalPlaces(2);
      if (c.exempt) return new D(0);
      return oregonWithholding(rules, c, wagesThisPeriod, federalWithheld, periodsPerYear).add(c.additionalWithholding ?? 0).toDecimalPlaces(2);
    }
    case "ny_exact": {
      // No IT-2104 on file: single with no allowances.
      const c = cert.state ?? {};
      if (c.exempt) return new D(0);
      return newYorkWithholding(rules, c, wagesThisPeriod, periodsPerYear).add(c.additionalWithholding ?? 0).toDecimalPlaces(2);
    }
  }
}
