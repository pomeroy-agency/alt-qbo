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

/** The area's name as listed, matching case and spacing loosely; null if the state has no such area. */
export function wageAreaName(wh: StateWageHourRules, area: string | null | undefined): string | null {
  if (!area || !wh.areas) return null;
  const key = area.trim().replace(/\s+/g, " ").toLowerCase();
  return wh.areas.find((a) => a.name.toLowerCase() === key)?.name ?? null;
}

/** The wage-and-hour rules for work in an area: its minimum wage and exempt salary replace the statewide ones. */
export function wageHourFor(wh: StateWageHourRules, area: string | null | undefined): StateWageHourRules {
  const name = wageAreaName(wh, area);
  const a = name ? wh.areas!.find((x) => x.name === name)! : null;
  if (!a) return wh;
  return {
    ...wh,
    minimumWage: a.minimumWage,
    minimumWageChanges: a.minimumWageChanges ?? [],
    ...(a.exemptAnnualSalaryMinimum ? { exemptAnnualSalaryMinimum: a.exemptAnnualSalaryMinimum, exemptAnnualSalaryChanges: a.exemptAnnualSalaryChanges ?? [] } : {}),
  };
}
