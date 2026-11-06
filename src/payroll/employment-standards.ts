import { D, toMajor } from "../core/money.js";
import { rateValue, type EmploymentStandards } from "../rules/canada/employment-standards-2026.js";
import { addDays } from "./business-days.js";
import type { PayFrequency } from "./gross-to-net.js";

// Vacation pay rates and statutory holiday pay for Canadian employees, worked
// out from each region's employment standards (src/rules/canada/
// employment-standards-2026.ts) and the pay the employee had before the holiday.

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** Completed years of employment on `onDate`. */
export function yearsOfService(hireDate: string, onDate: string): number {
  const [hy, hm, hd] = hireDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = onDate.split("-").map(Number) as [number, number, number];
  return Math.max(y - hy - (m < hm || (m === hm && d < hd) ? 1 : 0), 0);
}

export interface VacationRate {
  /** The rate used, as a fraction. */
  rate: string;
  /** The law's minimum on that date. */
  lawRate: string;
  /** The rate's label for the stub: "4%" or "3/52". */
  label: string;
}

/** The vacation pay rate on `onDate`: the law's for the years worked, or the employer's own if it is higher. */
export function vacationRateFor(std: EmploymentStandards, hireDate: string, onDate: string, employerRate?: string | null): VacationRate {
  const years = yearsOfService(hireDate, onDate);
  const step = [...std.vacation].reverse().find((s) => years >= s.afterYears) ?? std.vacation[0]!;
  const lawRate = rateValue(step.rate);
  const label = step.rate.includes("/") ? step.rate : `${new D(step.rate).mul(100).toString()}%`;
  if (employerRate && new D(employerRate).gt(lawRate)) {
    return { rate: new D(employerRate).toString(), lawRate, label: `${new D(employerRate).mul(100).toString()}%` };
  }
  return { rate: lawRate, lawRate, label };
}

export function holidaysInPeriod(std: EmploymentStandards, start: string, end: string): { date: string; name: string }[] {
  const years = new Set([Number(start.slice(0, 4)), Number(end.slice(0, 4))]);
  return [...years].flatMap((y) => std.holidays(y)).filter((h) => h.date >= start && h.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}

const WORKDAYS_PER_PERIOD: Record<PayFrequency, string> = { weekly: "5", biweekly: "10", semimonthly: "10.8333", monthly: "21.6667" };

/** Usual hours in a day: the usual hours each pay period spread over its workdays, or 8. */
export function usualDailyHours(usualHoursPerPeriod: string | null | undefined, frequency: PayFrequency): string {
  if (!usualHoursPerPeriod || new D(usualHoursPerPeriod).lte(0)) return "8";
  return new D(usualHoursPerPeriod).div(WORKDAYS_PER_PERIOD[frequency]).toDecimalPlaces(2).toString();
}

/** Earnings for one pay period, from a posted paycheck or this run's own hours. */
export interface WageSlice {
  periodStart: string;
  periodEnd: string;
  earnings: { code: string; hours?: string; amountMinor: bigint | string }[];
}

const OVERTIME_CODES = new Set(["OVERTIME", "DOUBLE_TIME", "OVERTIME_ON_BONUS", "HOLIDAY_WORKED"]);
const WORKED_CODES = new Set(["REGULAR", "OVERTIME", "DOUBLE_TIME", "HOLIDAY_WORKED"]);

export interface HolidayPay {
  date: string;
  name: string;
  /** Dollars. */
  amount: string;
  /** How it was worked out, for the stub and the reviewer. */
  basis: string;
  warning?: string;
}

/**
 * Holiday pay for one statutory holiday, or null when the employee doesn't
 * qualify yet. Wages from each pay period count by the share of its days that
 * fall in the window before the holiday.
 */
export function holidayPayFor(
  std: EmploymentStandards,
  holiday: { date: string; name: string },
  employee: { hireDate: string; hourlyRate: string; dailyHours: string },
  history: WageSlice[],
): HolidayPay | null {
  const rules = std.holidayPay;
  if (rules.qualifyingDays && days(employee.hireDate, holiday.date) < rules.qualifyingDays) return null;
  const regularDay = new D(employee.hourlyRate).mul(employee.dailyHours);
  const regular = (basis: string, warning?: string): HolidayPay => ({
    date: holiday.date, name: holiday.name, amount: regularDay.toFixed(2), basis, ...(warning ? { warning } : {}),
  });
  if (rules.method === "regular_day") return regular(`a regular day: ${employee.dailyHours} hours at ${employee.hourlyRate}`);

  const windowDays = rules.windowDays ?? 28;
  const windowStart = addDays(holiday.date, -windowDays);
  const windowEnd = addDays(holiday.date, -1);
  let wages = new D(0);
  let hours = new D(0);
  let covered = 0;
  for (const s of history) {
    const from = s.periodStart > windowStart ? s.periodStart : windowStart;
    const to = s.periodEnd < windowEnd ? s.periodEnd : windowEnd;
    if (to < from) continue;
    const share = new D(days(from, to) + 1).div(days(s.periodStart, s.periodEnd) + 1);
    covered += days(from, to) + 1;
    for (const e of s.earnings) {
      const amount = toMajor(BigInt(e.amountMinor));
      if (WORKED_CODES.has(e.code) && e.hours) hours = hours.add(new D(e.hours).mul(share));
      if (e.code === "SALARY" || e.code === "REIMBURSEMENT") continue;
      if (rules.excludesOvertime && OVERTIME_CODES.has(e.code)) continue;
      if (!rules.includesVacationPay && e.code === "VACATION") continue;
      if (e.code === "BONUS") continue;
      wages = wages.add(amount.mul(share));
    }
  }
  const startedInWindow = employee.hireDate > windowStart;
  const short = !startedInWindow && covered < windowDays
    ? `holiday pay for ${holiday.name} is based on ${covered} of the ${windowDays} days before it, because earlier pay isn't in TrailBook; add any missing pay to check it`
    : undefined;
  if (wages.lte(0)) {
    return regular(`a regular day: ${employee.dailyHours} hours at ${employee.hourlyRate}`, `no pay in the ${windowDays} days before ${holiday.name} to work holiday pay from, so a regular day's pay is used; check it`);
  }
  if (rules.method === "share_of_wages") {
    const share = rules.share ?? "0.05";
    return {
      date: holiday.date, name: holiday.name, amount: wages.mul(share).toFixed(2),
      basis: `${new D(share).mul(100).toString()}% of ${wages.toFixed(2)} earned in the ${windowDays} days before`, ...(short ? { warning: short } : {}),
    };
  }
  // average_day: the days worked aren't recorded, so they're counted as hours worked over usual daily hours.
  const daysWorked = D.max(hours.div(employee.dailyHours).toDecimalPlaces(2), 1);
  return {
    date: holiday.date, name: holiday.name, amount: wages.div(daysWorked).toFixed(2),
    basis: `${wages.toFixed(2)} earned in the ${windowDays} days before over about ${daysWorked.toString()} days worked`, ...(short ? { warning: short } : {}),
  };
}
