import { D, type Dec } from "../core/money.js";
import type { StateIncomeTaxRules } from "../rules/types.js";
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
}

/** State income tax withheld from one paycheck, by the state's method. */
export function stateWithholding(
  rules: StateIncomeTaxRules,
  cert: { de4?: DE4; state?: StateWithholding | null },
  wagesThisPeriod: Dec,
  periodsPerYear: number,
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
  }
}
