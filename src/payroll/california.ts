import { D, type Dec } from "../core/money.js";
import type { CaliforniaPayrollRules } from "../rules/types.js";
import { applyBrackets } from "./federal.js";

export interface DE4 {
  filingStatus: "single" | "married" | "hoh";
  /** DE 4 regular withholding allowances (exemption credits). */
  regularAllowances: number;
  /** DE 4 additional allowances for estimated deductions. */
  estimatedDeductionAllowances?: number;
  /** Extra withholding per pay period. */
  additionalWithholding?: string;
  exempt?: boolean;
}

/** California PIT withholding for one pay period, EDD Method B (exact calculation). */
export function californiaWithholding(
  rules: CaliforniaPayrollRules["pit"],
  de4: DE4,
  wagesThisPeriod: Dec,
  periodsPerYear: number,
): Dec {
  if (de4.exempt) return new D(0);
  const periods = new D(periodsPerYear);
  const annual = wagesThisPeriod.mul(periods);
  const tier = de4.filingStatus === "single" ? "single"
    : de4.filingStatus === "hoh" ? "hoh"
    : de4.regularAllowances >= 2 ? "marriedHigh" : "marriedLow";

  // Step 1: no tax below the low-income exemption.
  if (annual.lte(rules.lowIncomeExemption[tier])) {
    return new D(de4.additionalWithholding ?? 0).toDecimalPlaces(2);
  }
  // Steps 2 and 3: estimated deduction and standard deduction.
  const estimated = new D(rules.estimatedDeductionPerAllowance).mul(de4.estimatedDeductionAllowances ?? 0);
  const taxable = D.max(annual.sub(estimated).sub(rules.standardDeduction[tier]), 0);
  // Step 4: tax from the rate table for the filing status.
  const computed = applyBrackets(rules.brackets[de4.filingStatus], taxable);
  // Step 5: subtract the exemption allowance credit.
  const credit = new D(rules.exemptionCreditPerAllowance).mul(de4.regularAllowances);
  const annualTax = D.max(computed.sub(credit), 0);
  return annualTax.div(periods).add(de4.additionalWithholding ?? 0).toDecimalPlaces(2);
}
