import { D, type Dec } from "../core/money.js";
import type { Bracket, FederalFilingStatus, FederalPayrollRules } from "../rules/types.js";

/**
 * Builds a Pub 15-T annual percentage-method schedule from the year's
 * brackets and standard deduction:
 *   - standard schedule: zero bracket = standard deduction minus line 1g,
 *     then each bracket threshold shifted up by that amount;
 *   - Step 2 checkbox schedule: zero bracket = half the standard deduction,
 *     thresholds halved (each of two jobs gets half of every bracket).
 * This reproduces the published 2026 MFJ schedules exactly (see tests).
 */
export function federalSchedule(
  rules: FederalPayrollRules["incomeTax"],
  status: FederalFilingStatus,
  step2Checked: boolean,
): Bracket[] {
  const std = new D(rules.standardDeduction[status]);
  const line1g = new D(status === "mfj" ? rules.line1g.mfj : rules.line1g.other);
  const offset = step2Checked ? std.div(2) : std.sub(line1g);
  const scale = step2Checked ? new D(0.5) : new D(1);

  const rows: Bracket[] = [{ over: "0", rate: "0", base: "0" }];
  let base: Dec = new D(0);
  const brackets = rules.brackets[status];
  brackets.forEach((b, i) => {
    const over = offset.add(new D(b.over).mul(scale));
    if (i > 0) {
      const prev = brackets[i - 1]!;
      const width = new D(b.over).sub(prev.over).mul(scale);
      base = base.add(width.mul(prev.rate));
    }
    rows.push({ over: over.toString(), rate: b.rate, base: base.toString() });
  });
  return rows;
}

export function applyBrackets(brackets: readonly Bracket[], amount: Dec): Dec {
  let row = brackets[0]!;
  for (const b of brackets) if (amount.gte(b.over)) row = b;
  return new D(row.base).add(amount.sub(row.over).mul(row.rate));
}

export interface W4 {
  filingStatus: FederalFilingStatus;
  step2Checked: boolean;
  /** Step 3 total credits, annual. */
  step3Credits?: string;
  /** Step 4(a) other income, annual. */
  step4aOtherIncome?: string;
  /** Step 4(b) deductions, annual. */
  step4bDeductions?: string;
  /** Step 4(c) extra withholding, per pay period. */
  step4cExtraWithholding?: string;
  exempt?: boolean;
}

/** Federal income tax withholding for one pay period, Pub 15-T Worksheet 1A. */
export function federalWithholding(
  rules: FederalPayrollRules["incomeTax"],
  w4: W4,
  wagesThisPeriod: Dec,
  periodsPerYear: number,
): Dec {
  if (w4.exempt) return new D(0);
  const periods = new D(periodsPerYear);
  const line1c = wagesThisPeriod.mul(periods);
  const line1e = line1c.add(w4.step4aOtherIncome ?? 0);
  const line1g = w4.step2Checked ? new D(0) : new D(w4.filingStatus === "mfj" ? rules.line1g.mfj : rules.line1g.other);
  const line1h = new D(w4.step4bDeductions ?? 0).add(line1g);
  const adjustedAnnual = D.max(line1e.sub(line1h), 0);

  const schedule = federalSchedule(rules, w4.filingStatus, w4.step2Checked);
  const tentativeAnnual = applyBrackets(schedule, adjustedAnnual);
  const perPeriod = tentativeAnnual.div(periods);
  const credits = new D(w4.step3Credits ?? 0).div(periods);
  const afterCredits = D.max(perPeriod.sub(credits), 0);
  return afterCredits.add(w4.step4cExtraWithholding ?? 0).toDecimalPlaces(2);
}
