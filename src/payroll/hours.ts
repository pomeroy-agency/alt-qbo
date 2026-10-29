import { D, type Dec } from "../core/money.js";
import type { StateWageHourRules } from "../rules/types.js";

export interface HoursBreakdown {
  regular: string;
  overtime: string;
  doubleTime: string;
}

/**
 * Splits one workweek of daily hours into regular, overtime and double time.
 * Where the state has only the weekly rule (FLSA), hours past 40 in the week
 * are overtime. California (Labor Code 510) adds daily rules:
 *   - over 8 hours in a day is overtime, over 12 is double time;
 *   - on the seventh consecutive workday of the week, the first 8 hours are
 *     overtime and anything beyond is double time;
 *   - regular hours beyond 40 in the week become overtime.
 * `days` is the workweek in order, seven entries (0 for a day not worked).
 */
export function splitWorkweek(days: readonly (string | number)[], rules: StateWageHourRules): HoursBreakdown {
  if (days.length !== 7) throw new Error("a workweek has exactly seven days");
  const hours = days.map((h) => new D(h));
  if (hours.some((h) => h.isNegative() || h.gt(24))) throw new Error("daily hours must be between 0 and 24");

  const ot = rules.overtime;
  // No daily rule: a day's hours are all regular until the weekly limit.
  const otAfter = new D(ot.dailyAfter ?? 24);
  const dtAfter = new D(ot.dailyDoubleTimeAfter ?? 24);
  const weekly = new D(ot.weeklyAfter);
  const seventhDt = ot.seventhDayDoubleTimeAfter ? new D(ot.seventhDayDoubleTimeAfter) : null;
  const workedAllSeven = seventhDt !== null && hours.every((h) => h.gt(0));

  let regular: Dec = new D(0);
  let overtime: Dec = new D(0);
  let doubleTime: Dec = new D(0);

  hours.forEach((h, i) => {
    if (i === 6 && workedAllSeven && seventhDt) {
      overtime = overtime.add(D.min(h, seventhDt));
      doubleTime = doubleTime.add(D.max(h.sub(seventhDt), 0));
      return;
    }
    let dayRegular = D.min(h, otAfter);
    const dayOt = D.max(D.min(h, dtAfter).sub(otAfter), 0);
    const dayDt = D.max(h.sub(dtAfter), 0);
    // Weekly rule: regular hours past 40 become overtime.
    const room = D.max(weekly.sub(regular), 0);
    if (dayRegular.gt(room)) {
      overtime = overtime.add(dayRegular.sub(room));
      dayRegular = room;
    }
    regular = regular.add(dayRegular);
    overtime = overtime.add(dayOt);
    doubleTime = doubleTime.add(dayDt);
  });

  return { regular: regular.toString(), overtime: overtime.toString(), doubleTime: doubleTime.toString() };
}
