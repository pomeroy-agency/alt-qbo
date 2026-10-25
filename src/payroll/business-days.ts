// Business days for tax deposit due dates. Federal deposits move past
// Saturdays, Sundays and District of Columbia legal holidays (Pub 15,
// "Deposits Due on Business Days Only"); state holidays don't delay them.
// California's own deadlines move past weekends and state holidays. For
// California, only holidays the state shares with the federal calendar are
// counted, so a due date shown is never later than the real one.

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  const d = day(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function weekday(date: string): number {
  return day(date).getUTCDay();
}

/** The nth given weekday (0 = Sunday) of a month; n = -1 is the last one. */
function nthWeekday(year: number, month: number, dow: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1, 12));
    const offset = (dow - first.getUTCDay() + 7) % 7;
    return iso(new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7, 12)));
  }
  const last = new Date(Date.UTC(year, month, 0, 12));
  const offset = (last.getUTCDay() - dow + 7) % 7;
  return iso(new Date(Date.UTC(year, month - 1, last.getUTCDate() - offset, 12)));
}

/** A fixed-date holiday moved to Friday when it falls on Saturday and to Monday when on Sunday. */
function observed(year: number, month: number, date: number): string {
  const d = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
  const w = weekday(d);
  return w === 6 ? addDays(d, -1) : w === 0 ? addDays(d, 1) : d;
}

const cache = new Map<string, Set<string>>();

/** Legal holidays in the District of Columbia, which govern federal deposit dates. */
export function federalHolidays(year: number): Set<string> {
  const key = `us:${year}`;
  if (!cache.has(key)) {
    const days = [
      observed(year, 1, 1),
      nthWeekday(year, 1, 1, 3), // Birthday of Martin Luther King, Jr.
      nthWeekday(year, 2, 1, 3), // Washington's Birthday
      observed(year, 4, 16), // District of Columbia Emancipation Day
      nthWeekday(year, 5, 1, -1), // Memorial Day
      observed(year, 6, 19), // Juneteenth
      observed(year, 7, 4),
      nthWeekday(year, 9, 1, 1), // Labor Day
      nthWeekday(year, 10, 1, 2), // Columbus Day / Indigenous Peoples' Day
      observed(year, 11, 11), // Veterans Day
      nthWeekday(year, 11, 4, 4), // Thanksgiving
      observed(year, 12, 25),
      // New Year's Day of next year observed on Friday, December 31.
      ...(weekday(`${year + 1}-01-01`) === 6 ? [`${year}-12-31`] : []),
    ];
    // Inauguration Day is a legal holiday in DC every fourth year (moved to the 21st when the 20th is a Sunday).
    if ((year - 1965) % 4 === 0) days.push(weekday(`${year}-01-20`) === 0 ? `${year}-01-21` : `${year}-01-20`);
    cache.set(key, new Set(days));
  }
  return cache.get(key)!;
}

/** California state holidays that are also federal ones; see the note at the top. */
export function californiaHolidays(year: number): Set<string> {
  const key = `ca:${year}`;
  if (!cache.has(key)) {
    const all = federalHolidays(year);
    const notInCalifornia = new Set([observed(year, 4, 16), observed(year, 6, 19), nthWeekday(year, 10, 1, 2)]);
    if ((year - 1965) % 4 === 0) for (const d of [`${year}-01-20`, `${year}-01-21`]) notInCalifornia.add(d);
    cache.set(key, new Set([...all].filter((d) => !notInCalifornia.has(d))));
  }
  return cache.get(key)!;
}

export type Calendar = "federal" | "california";

export function isBusinessDay(date: string, calendar: Calendar): boolean {
  const w = weekday(date);
  if (w === 0 || w === 6) return false;
  const year = Number(date.slice(0, 4));
  return !(calendar === "federal" ? federalHolidays(year) : californiaHolidays(year)).has(date);
}

/** The date itself if it's a business day, otherwise the next one. */
export function onOrNextBusinessDay(date: string, calendar: Calendar): string {
  let d = date;
  while (!isBusinessDay(d, calendar)) d = addDays(d, 1);
  return d;
}

/** The nth business day after a date. */
export function businessDaysAfter(date: string, n: number, calendar: Calendar): string {
  let d = date;
  for (let i = 0; i < n; ) {
    d = addDays(d, 1);
    if (isBusinessDay(d, calendar)) i++;
  }
  return d;
}

/** The last day of the month after the one containing `date`. */
export function endOfNextMonth(date: string): string {
  const d = day(date);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0, 12)));
}

/** The 15th of the month after the one containing `date`. */
export function fifteenthOfNextMonth(date: string): string {
  const d = day(date);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15, 12)));
}

export function quarterOf(date: string): number {
  return Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
}

export function quarterEnd(year: number, q: number): string {
  return iso(new Date(Date.UTC(year, q * 3, 0, 12)));
}

/** Today's date in California, where Alt-QBO's businesses are. */
export function pacificToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}
