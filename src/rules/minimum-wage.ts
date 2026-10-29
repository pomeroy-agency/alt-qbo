import type { StateWageHourRules } from "./types.js";

/** The exempt salary floor in force on a date. */
export function exemptSalaryOn(wh: StateWageHourRules, date: string): string {
  let amount = wh.exemptAnnualSalaryMinimum;
  for (const c of [...(wh.exemptAnnualSalaryChanges ?? [])].sort((a, b) => a.from.localeCompare(b.from))) if (c.from <= date) amount = c.amount;
  return amount;
}

/** The state minimum wage in force on a date, taking any change part-way through the pack's span. */
export function minimumWageOn(wh: StateWageHourRules, date: string): string {
  let rate = wh.minimumWage;
  for (const c of [...(wh.minimumWageChanges ?? [])].sort((a, b) => a.from.localeCompare(b.from))) if (c.from <= date) rate = c.rate;
  return rate;
}
