import type { StateWageHourRules } from "./types.js";

/** The state minimum wage in force on a date, taking any change part-way through the pack's span. */
export function minimumWageOn(wh: StateWageHourRules, date: string): string {
  let rate = wh.minimumWage;
  for (const c of [...(wh.minimumWageChanges ?? [])].sort((a, b) => a.from.localeCompare(b.from))) if (c.from <= date) rate = c.rate;
  return rate;
}
