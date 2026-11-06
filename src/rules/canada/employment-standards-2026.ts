import { D } from "../../core/money.js";
import type { Source } from "../types.js";
import { addDays, easter, nthWeekday, victoriaDay } from "../../payroll/business-days.js";

// Vacation pay and statutory (general, public) holiday pay under each
// province's and territory's employment standards law, for the pay run.
// Federally regulated businesses (banks, airlines, telecoms...) follow the
// Canada Labour Code instead; TrailBook's businesses are provincially
// regulated. Drafts until Greg's review: most of this is working knowledge
// checked against secondary sources, because provincial labour sites refuse
// automated downloads. Each region lists what is still to be checked.

export type Region = "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

export interface VacationStep {
  /** Completed years of employment from which this rate applies. */
  afterYears: number;
  /** Vacation pay as a share of vacationable wages, as a fraction ("0.04", or "3/52" in Saskatchewan). */
  rate: string;
}

export type HolidayPayMethod =
  /** Wages in the window divided by the days worked in it (Alberta, BC, Nova Scotia, PEI). */
  | "average_day"
  /** A share of the wages in the window (Manitoba and Saskatchewan 5%, Ontario and Quebec 1/20). */
  | "share_of_wages"
  /** A regular day's pay: the hourly rate times the employee's usual daily hours. */
  | "regular_day";

export interface HolidayRules {
  method: HolidayPayMethod;
  /** share_of_wages: the share, as a fraction. */
  share?: string;
  /** Calendar days before the holiday whose wages count (28 for "four weeks", 30 for "30 calendar days"). */
  windowDays?: number;
  /** Overtime pay stays out of the wages counted. */
  excludesOvertime: boolean;
  /** Vacation pay paid in the window counts (Ontario, Alberta). */
  includesVacationPay: boolean;
  /** Days employed before the holiday to qualify; 0 for none. */
  qualifyingDays: number;
  /** Hours worked on the holiday are paid at this multiple of the rate, on top of the holiday pay. */
  workedMultiplier: string;
  note?: string;
}

export interface EmploymentStandards {
  region: Region;
  name: string;
  vacation: VacationStep[];
  /** Overtime pay stays out of the wages vacation pay is worked on. */
  vacationExcludesOvertime: boolean;
  /** Holiday pay stays out of the wages vacation pay is worked on. */
  vacationExcludesHolidayPay: boolean;
  holidayPay: HolidayRules;
  holidays: (year: number) => { date: string; name: string }[];
  sources: Source[];
  /** What still needs checking against the official source. */
  toCheck: string[];
}

const fixed = (year: number, md: string) => `${year}-${md}`;
const goodFriday = (y: number) => addDays(easter(y), -2);
const H = {
  newYear: (y: number) => ({ date: fixed(y, "01-01"), name: "New Year's Day" }),
  familyDay: (y: number, name = "Family Day") => ({ date: nthWeekday(y, 2, 1, 3), name }),
  goodFriday: (y: number) => ({ date: goodFriday(y), name: "Good Friday" }),
  victoria: (y: number, name = "Victoria Day") => ({ date: victoriaDay(y), name }),
  june21: (y: number) => ({ date: fixed(y, "06-21"), name: "National Indigenous Peoples Day" }),
  stJean: (y: number) => ({ date: fixed(y, "06-24"), name: "National Holiday (Fête nationale)" }),
  canada: (y: number) => ({ date: fixed(y, "07-01"), name: "Canada Day" }),
  augustFirstMonday: (y: number, name: string) => ({ date: nthWeekday(y, 8, 1, 1), name }),
  labour: (y: number) => ({ date: nthWeekday(y, 9, 1, 1), name: "Labour Day" }),
  truth: (y: number) => ({ date: fixed(y, "09-30"), name: "National Day for Truth and Reconciliation" }),
  thanksgiving: (y: number) => ({ date: nthWeekday(y, 10, 1, 2), name: "Thanksgiving" }),
  remembrance: (y: number) => ({ date: fixed(y, "11-11"), name: "Remembrance Day" }),
  christmas: (y: number) => ({ date: fixed(y, "12-25"), name: "Christmas Day" }),
  boxing: (y: number) => ({ date: fixed(y, "12-26"), name: "Boxing Day" }),
};

const std = (r: number, years: number, r2?: number, years2?: number): VacationStep[] => [
  { afterYears: 0, rate: "0.04" }, { afterYears: years, rate: String(r) }, ...(r2 ? [{ afterYears: years2!, rate: String(r2) }] : []),
];

const WORKING_KNOWLEDGE = (region: string): Source => ({
  ref: `${region} employment standards act and regulations (vacation and general holiday sections), working knowledge`,
  covers: "vacation pay rates and service steps, the general holidays, holiday pay formula, qualifying period and premium for working the holiday",
  basis: "working-knowledge",
});

const AVERAGE_DAY_30 = (qualifyingDays: number): HolidayRules => ({
  method: "average_day", windowDays: 30, excludesOvertime: true, includesVacationPay: false, qualifyingDays, workedMultiplier: "1.5",
});
const REGULAR_DAY = (qualifyingDays: number): HolidayRules => ({
  method: "regular_day", excludesOvertime: true, includesVacationPay: false, qualifyingDays, workedMultiplier: "1.5",
});

export const EMPLOYMENT_STANDARDS_2026: Record<Region, EmploymentStandards> = {
  AB: {
    region: "AB", name: "Alberta", vacation: std(0.06, 5), vacationExcludesOvertime: true, vacationExcludesHolidayPay: true,
    holidayPay: {
      method: "average_day", windowDays: 28, excludesOvertime: true, includesVacationPay: true, qualifyingDays: 30, workedMultiplier: "1.5",
      note: "Alberta pays holiday pay only when the holiday would have been a normal work day; tick \"not a work day\" on the line when it wasn't.",
    },
    holidays: (y) => [H.newYear(y), H.familyDay(y), H.goodFriday(y), H.victoria(y), H.canada(y), H.labour(y), H.thanksgiving(y), H.remembrance(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("Alberta Employment Standards Code")],
    toCheck: ["average daily wage counts general holiday pay and vacation pay in the four weeks", "vacation pay leaves out overtime and general holiday pay"],
  },
  BC: {
    region: "BC", name: "British Columbia", vacation: std(0.06, 5), vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: { ...AVERAGE_DAY_30(30), note: "British Columbia also requires wages earned on 15 of the 30 days before the holiday." },
    holidays: (y) => [H.newYear(y), H.familyDay(y), H.goodFriday(y), H.victoria(y), H.canada(y), H.augustFirstMonday(y, "British Columbia Day"), H.labour(y), H.truth(y), H.thanksgiving(y), H.remembrance(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("British Columbia Employment Standards Act")],
    toCheck: ["15 of 30 days test isn't checked automatically"],
  },
  MB: {
    region: "MB", name: "Manitoba", vacation: std(0.06, 5, 0.08, 10), vacationExcludesOvertime: true, vacationExcludesHolidayPay: false,
    holidayPay: { method: "share_of_wages", share: "0.05", windowDays: 28, excludesOvertime: true, includesVacationPay: true, qualifyingDays: 0, workedMultiplier: "1.5" },
    // Orange Shirt Day (September 30) became a general holiday on December 7, 2023 (Employment Standards Code s. 21(1), Bill 4).
    holidays: (y) => [H.newYear(y), H.familyDay(y, "Louis Riel Day"), H.goodFriday(y), H.victoria(y), H.canada(y), H.labour(y), H.truth(y), H.thanksgiving(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("Manitoba Employment Standards Code"), { ref: "The Employment Standards Code Amendment and Interpretation Amendment Act (Orange Shirt Day), S.M. 2023 c. 50, in force 2023-12-07", covers: "September 30 is a general holiday", basis: "published" }],
    toCheck: ["Remembrance Day falls under Manitoba's Remembrance Day Act, not the Code, so it isn't paid automatically", "vacation pay on regular wages (no overtime)"],
  },
  NB: {
    region: "NB", name: "New Brunswick", vacation: std(0.06, 8), vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: REGULAR_DAY(90),
    holidays: (y) => [H.newYear(y), H.familyDay(y), H.goodFriday(y), H.canada(y), H.augustFirstMonday(y, "New Brunswick Day"), H.labour(y), H.remembrance(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("New Brunswick Employment Standards Act")],
    toCheck: ["90 days in the 12 months before the holiday", "holiday list (Victoria Day isn't a paid holiday in New Brunswick)"],
  },
  NL: {
    region: "NL", name: "Newfoundland and Labrador", vacation: std(0.06, 15), vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: {
      ...REGULAR_DAY(30), workedMultiplier: "1",
      note: "Working the holiday is paid at double the rate (or straight time and another paid day off); TrailBook pays the holiday's day plus straight time for the hours worked, which is double for a full day.",
    },
    holidays: (y) => [H.newYear(y), H.goodFriday(y), { ...H.canada(y), name: "Memorial Day (Canada Day)" }, H.labour(y), H.remembrance(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("Newfoundland and Labrador Labour Standards Act"), { ref: "Government of Newfoundland and Labrador news release, 1998-12-21 (holiday work at double the rate); employer guides from Peninsula Canada and Samfiru Tumarkin, 2026", covers: "six paid public holidays and double rate for working one", basis: "working-knowledge" }],
    toCheck: ["15 years for three weeks' vacation"],
  },
  NS: {
    region: "NS", name: "Nova Scotia", vacation: std(0.06, 8), vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: { ...AVERAGE_DAY_30(0), note: "Nova Scotia requires wages for at least 15 of the 30 days before the holiday." },
    holidays: (y) => [H.newYear(y), H.familyDay(y, "Heritage Day"), H.goodFriday(y), H.canada(y), H.labour(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("Nova Scotia Labour Standards Code")],
    toCheck: ["Remembrance Day falls under the Remembrance Day Act, not the Code", "15 of 30 days test isn't checked automatically"],
  },
  NT: {
    region: "NT", name: "Northwest Territories", vacation: std(0.06, 6), vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: REGULAR_DAY(30),
    holidays: (y) => [H.newYear(y), H.goodFriday(y), H.victoria(y), H.june21(y), H.canada(y), H.augustFirstMonday(y, "Civic Holiday"), H.labour(y), H.truth(y), H.thanksgiving(y), H.remembrance(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("Northwest Territories Employment Standards Act")],
    toCheck: ["six years for three weeks' vacation", "holiday list"],
  },
  NU: {
    region: "NU", name: "Nunavut", vacation: std(0.06, 6), vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: REGULAR_DAY(30),
    holidays: (y) => [H.newYear(y), H.goodFriday(y), H.victoria(y), H.canada(y), { date: fixed(y, "07-09"), name: "Nunavut Day" }, H.augustFirstMonday(y, "Civic Holiday"), H.labour(y), H.truth(y), H.thanksgiving(y), H.remembrance(y), H.christmas(y), H.boxing(y)],
    sources: [WORKING_KNOWLEDGE("Nunavut Labour Standards Act"), { ref: "Government of Nunavut, \"Nunavut Day designated as a General Holiday\" (2020-06-16)", covers: "Nunavut Day, July 9", basis: "published" }],
    toCheck: ["Boxing Day: guides disagree; kept in so no one is underpaid", "six years for three weeks' vacation"],
  },
  ON: {
    region: "ON", name: "Ontario", vacation: std(0.06, 5), vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: {
      method: "share_of_wages", share: "0.05", windowDays: 28, excludesOvertime: true, includesVacationPay: true, qualifyingDays: 0, workedMultiplier: "1.5",
      note: "Ontario: regular wages plus vacation pay payable in the four work weeks before, divided by 20. Working the holiday is 1.5 times plus holiday pay, or regular pay and a substitute day off with the employee's written agreement.",
    },
    holidays: (y) => [H.newYear(y), H.familyDay(y), H.goodFriday(y), H.victoria(y), H.canada(y), H.labour(y), H.thanksgiving(y), H.christmas(y), H.boxing(y)],
    sources: [WORKING_KNOWLEDGE("Ontario Employment Standards Act, 2000, ss. 24-30, 33-35.2")],
    toCheck: ["Civic Holiday (August) and Easter Monday aren't public holidays under the Act"],
  },
  PE: {
    region: "PE", name: "Prince Edward Island", vacation: std(0.06, 8), vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: { ...AVERAGE_DAY_30(30), note: "Prince Edward Island also requires wages on at least 15 of the 30 days before the holiday." },
    holidays: (y) => [H.newYear(y), H.familyDay(y, "Islander Day"), H.goodFriday(y), H.canada(y), H.labour(y), H.truth(y), H.remembrance(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("Prince Edward Island Employment Standards Act")],
    toCheck: ["eight years for three weeks' vacation", "15 of 30 days test isn't checked automatically"],
  },
  QC: {
    region: "QC", name: "Quebec", vacation: std(0.06, 3), vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: {
      method: "share_of_wages", share: "0.05", windowDays: 28, excludesOvertime: true, includesVacationPay: false, qualifyingDays: 0, workedMultiplier: "1",
      note: "Quebec: 1/20 of the wages (no overtime) in the four full weeks before the week of the holiday. Working it is paid at the normal rate plus the indemnity, or a day off instead.",
    },
    holidays: (y) => [H.newYear(y), H.goodFriday(y), H.victoria(y, "National Patriots' Day"), H.stJean(y), H.canada(y), H.labour(y), H.thanksgiving(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("Quebec Act respecting labour standards, ss. 59.1-65, 66-74"), { ref: "Act respecting labour standards s. 68 as amended in 2018 (three weeks after three years)", covers: "6% after three years", basis: "working-knowledge" }],
    toCheck: ["the window is counted as 28 days before the holiday, not the four complete weeks before its week", "Good Friday stands for the employer's Good Friday or Easter Monday choice"],
  },
  SK: {
    region: "SK", name: "Saskatchewan", vacation: [{ afterYears: 0, rate: "3/52" }, { afterYears: 10, rate: "4/52" }], vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: { method: "share_of_wages", share: "0.05", windowDays: 28, excludesOvertime: true, includesVacationPay: true, qualifyingDays: 0, workedMultiplier: "1.5" },
    holidays: (y) => [H.newYear(y), H.familyDay(y), H.goodFriday(y), H.victoria(y), H.canada(y), H.augustFirstMonday(y, "Saskatchewan Day"), H.labour(y), H.thanksgiving(y), H.remembrance(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("The Saskatchewan Employment Act, Part II")],
    toCheck: ["vacation pay counts overtime"],
  },
  YT: {
    region: "YT", name: "Yukon", vacation: [{ afterYears: 0, rate: "0.04" }], vacationExcludesOvertime: false, vacationExcludesHolidayPay: false,
    holidayPay: REGULAR_DAY(30),
    // Heritage Day (February) isn't a Yukon statutory holiday (yukon.ca, "Find a Yukon statutory holiday").
    holidays: (y) => [H.newYear(y), H.goodFriday(y), H.victoria(y), H.june21(y), H.canada(y), { date: nthWeekday(y, 8, 1, 3), name: "Discovery Day" }, H.labour(y), H.truth(y), H.thanksgiving(y), H.remembrance(y), H.christmas(y)],
    sources: [WORKING_KNOWLEDGE("Yukon Employment Standards Act"), { ref: "yukon.ca, \"Find a Yukon statutory holiday\"", covers: "the statutory holidays; Heritage Day isn't one", basis: "published" }],
    toCheck: ["no longer-service step for vacation"],
  },
};

export function employmentStandardsFor(region: string | null | undefined): EmploymentStandards | null {
  return region && region in EMPLOYMENT_STANDARDS_2026 ? EMPLOYMENT_STANDARDS_2026[region as Region] : null;
}

/** "0.04" or "3/52" as a number string precise enough for money. */
export function rateValue(rate: string): string {
  const [n, d] = rate.split("/") as [string, string?];
  return d ? new D(n).div(d).toString() : n;
}
