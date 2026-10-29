import { D, type Dec } from "../core/money.js";
import type { AnnualFormulaStatus, FederalFilingStatus, LocalIncomeTax, StateIncomeTaxRules, WageRow } from "../rules/types.js";
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
  /**
   * Allowance states: the status claimed. Oregon and New York use "single",
   * "married" and "married_single_rate" (married withholding at the single
   * rate); annual-formula states use their pack's status ids.
   */
  filingStatus?: string;
  /** Allowance states: allowances (exemptions) claimed. */
  allowances?: number;
  /** A second kind of allowance (Illinois IL-W-4 line 2). */
  allowances2?: number;
  /** A third kind of allowance (Indiana WH-4 line 8, adopted children). */
  allowances3?: number;
  /** A dollar allowance for the year that replaces the standard deduction (Colorado DR 0004 line 2). */
  allowanceAmount?: string;
  /** City income taxes that apply to the employee, by id (New York: "nyc", "yonkers", "yonkers_nr"). */
  localities?: string[];
  /** Entered local rates (a fraction, like "0.01") or yearly amounts (dollars), by local tax id. */
  localRates?: Record<string, string>;
  /** The place each entered local tax is for (a Pennsylvania PSD code, an Ohio city), by local tax id; W-2 box 20. */
  localPlaces?: Record<string, string>;
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
  /** The date rate changes are judged by (the pay period's last day). */
  onDate?: string,
): Dec {
  const cert = c ?? {};
  // Claimed local taxes are owed even by employees exempt from state withholding, except New York's, which follow the IT-2104.
  const r = local.rules;
  const ny = r.method === "ny_exact" || r.method === "share_of_state" || r.method === "exclusion_percent";
  if (!cert.localities?.includes(local.id) || (ny && cert.exempt)) return new D(0);
  switch (r.method) {
    case "flat_rate": {
      const change = [...(r.rateChanges ?? [])].reverse().find((x) => onDate && onDate >= x.from);
      return wagesThisPeriod.mul(change?.rate ?? r.rate).toDecimalPlaces(2);
    }
    case "employee_rate": {
      const rate = cert.localRates?.[local.id];
      if (!rate) return new D(0);
      let base = wagesThisPeriod;
      if (r.base === "less_state_exemptions" && stateRules.method === "annual_formula") {
        // The state's allowance deductions for the year (Ohio's $650, Indiana's three kinds), spread over the paychecks.
        const counts = allowanceCounts(cert);
        const yearly = stateRules.allowances.reduce((sum, a, i) => (a.credit ? sum : sum.add(new D(a.amount).mul(counts[i] ?? 0))), new D(0));
        base = D.max(wagesThisPeriod.sub(yearly.div(periodsPerYear)), 0);
      } else if (r.base === "state_taxable" && stateRules.method === "annual_formula") {
        // Maryland: the same taxable wages as the state tax, after the standard deduction and exemptions.
        const status = stateRules.statuses.find((s) => s.id === cert.filingStatus) ?? stateRules.statuses.find((s) => s.id === stateRules.noCertificateStatus) ?? stateRules.statuses[0]!;
        const annual = wagesThisPeriod.mul(periodsPerYear);
        base = D.max(annual.sub(annualDeduction(stateRules, status, cert, annual).deduction), 0).div(periodsPerYear);
      }
      return base.mul(D.min(rate, r.maxRate)).toDecimalPlaces(2);
    }
    case "annual_amount": {
      const yearly = cert.localRates?.[local.id];
      if (!yearly) return new D(0);
      return D.min(yearly, r.maxAnnual).div(periodsPerYear).toDecimalPlaces(2);
    }
  }
  const freq = FREQUENCY[periodsPerYear];
  if (!freq) throw new Error(`no ${local.label} table for ${periodsPerYear} pay periods a year`);
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

/** The amount from a by-wages schedule for the year's wages. */
function byWages(rows: WageRow[], annual: Dec): Dec {
  return new D([...rows].reverse().find((r) => annual.gt(r.over))?.amount ?? rows[0]!.amount);
}

function allowanceCounts(c: StateWithholding | null | undefined): number[] {
  return [c?.allowances ?? 0, c?.allowances2 ?? 0, c?.allowances3 ?? 0];
}

/** The year's deductions (standard deduction and allowances) and allowance credits under an annual formula. */
function annualDeduction(
  rules: Extract<StateIncomeTaxRules, { method: "annual_formula" }>, status: AnnualFormulaStatus, c: StateWithholding | null | undefined, annual: Dec,
): { deduction: Dec; credits: Dec } {
  const counts = allowanceCounts(c);
  let deduction = rules.dollarAllowance && c?.allowanceAmount !== undefined ? new D(c.allowanceAmount)
    : status.deductionByWages ? byWages(status.deductionByWages, annual) : new D(status.standardDeduction);
  if (status.exemption) deduction = deduction.add(status.exemption);
  // Wisconsin: the standard deduction shrinks by a share of the year's wages above a level, to nothing.
  if (status.phaseOut) deduction = D.max(deduction.sub(D.max(annual.sub(status.phaseOut.from), 0).mul(status.phaseOut.rate)), 0);
  // South Carolina: a share of the year's wages, up to a cap, once at least one allowance is claimed.
  if (rules.percentDeduction && counts[0]! > 0) deduction = deduction.add(D.min(annual.mul(rules.percentDeduction.rate), rules.percentDeduction.max));
  if (rules.exemptionBase && counts[0]! > 0) deduction = deduction.add(rules.exemptionBase);
  let credits = new D(0);
  rules.allowances.forEach((a, i) => {
    const amount = (a.byWages ? byWages(a.byWages, annual) : new D(a.amount)).mul(counts[i] ?? 0);
    if (a.credit) credits = credits.add(amount);
    else deduction = deduction.add(amount);
  });
  return { deduction, credits };
}

function annualFormulaWithholding(
  rules: Extract<StateIncomeTaxRules, { method: "annual_formula" }>, c: StateWithholding | null | undefined, w4Status: FederalFilingStatus | undefined,
  wages: Dec, periods: number, fica: EmployeeFica | undefined, federalWithheld: Dec,
): Dec {
  const fromW4 = rules.statusFromW4 && w4Status ? rules.statusFromW4[w4Status] : undefined;
  const status = rules.statuses.find((s) => s.id === c?.filingStatus) ?? rules.statuses.find((s) => s.id === (fromW4 ?? rules.noCertificateStatus)) ?? rules.statuses[0]!;
  if (status.flatRate) return wages.mul(status.flatRate);
  const counts = allowanceCounts(c);
  if (rules.noTaxBelowAnnualWages && counts[0]! > 0 && wages.mul(periods).lt(rules.noTaxBelowAnnualWages)) return new D(0);
  // Massachusetts: this paycheck's Social Security and Medicare, until the year's total reaches the cap.
  let ficaOff = new D(0);
  if (rules.ficaDeductionCap && fica) ficaOff = D.min(fica.thisPeriod, D.max(new D(rules.ficaDeductionCap).sub(fica.yearToDate), 0));
  const annual = wages.sub(ficaOff).mul(periods);
  const { deduction, credits: allowanceCredits } = annualDeduction(rules, status, c, annual);
  let credits = allowanceCredits;
  // Alabama: the year's federal withholding comes off as well.
  const federalOff = rules.subtractFederalWithholding ? federalWithheld.mul(periods) : new D(0);
  const taxable = D.max(annual.sub(deduction).sub(federalOff), 0);
  let tax = new D(0);
  const rows = rules.tables[status.table]!;
  rows.forEach((r, i) => {
    const top = rows[i + 1]?.over;
    const slice = D.min(taxable, top ?? taxable).sub(r.over);
    if (slice.gt(0)) tax = tax.add(slice.mul(r.rate));
  });
  // Connecticut: the 2% phase-out add-back and tax recapture, then the personal tax credit as a share of the tax.
  if (taxable.gt(0)) for (const rows of status.taxAdditions ?? []) tax = tax.add(byWages(rows, annual));
  if (status.creditShare) tax = tax.mul(new D(1).sub(byWages(status.creditShare, annual)));
  if (status.credit) {
    credits = credits.add(D.max(new D(status.credit.base).sub(D.max(annual.sub(status.credit.phaseOutFrom), 0).mul(status.credit.phaseOutRate)), 0));
  }
  tax = D.max(tax.sub(credits), 0);
  if (rules.round === "annual_dollar") tax = tax.toDecimalPlaces(0, D.ROUND_HALF_UP);
  const perPeriod = tax.div(periods);
  return rules.round === "dollar" ? perPeriod.toDecimalPlaces(0, D.ROUND_HALF_UP) : perPeriod;
}

/** The employee's Social Security and Medicare, for states that let them come off wages first (Massachusetts). */
export interface EmployeeFica {
  thisPeriod: Dec;
  yearToDate: Dec;
}

/** State income tax withheld from one paycheck, by the state's method. */
export function stateWithholding(
  rules: StateIncomeTaxRules,
  cert: { de4?: DE4; state?: StateWithholding | null; w4Status?: FederalFilingStatus },
  wagesThisPeriod: Dec,
  periodsPerYear: number,
  /** Federal income tax withheld from the same paycheck (Oregon and Alabama subtract it). */
  federalWithheld: Dec = new D(0),
  fica?: EmployeeFica,
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
    case "annual_formula": {
      if (cert.state?.exempt) return new D(0);
      return annualFormulaWithholding(rules, cert.state, cert.w4Status, wagesThisPeriod, periodsPerYear, fica, federalWithheld)
        .add(cert.state?.additionalWithholding ?? 0).toDecimalPlaces(2);
    }
  }
}
