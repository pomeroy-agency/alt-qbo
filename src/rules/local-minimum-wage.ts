import { D } from "../core/money.js";

// California cities and counties that set a minimum wage above the state's.
// Each row is a rate and the day it starts; a city's latest row on or before
// a date is the one in force. Rows with `minEmployees` apply only to
// employers with at least that many employees (Hayward, Novato); smaller
// employers there pay the state rate.
//
// Sources: each city's posted ordinance notice, cross-checked against
// CalChamber, Davis Wright Tremaine and CDF Labor Law summaries
// (2025-12 to 2026-10). Cities that change on July 1 are listed from
// 2026-07-01, so pay periods before that aren't checked against them.
// Hotel-worker and health-care-worker rates are not covered.
// The daily rule watch checks these; see docs/rule-pack-review.md.

export interface LocalMinimumWageRow {
  place: string;
  from: string;
  rate: string;
  minEmployees?: number;
}

const ROWS: readonly LocalMinimumWageRow[] = Object.freeze([
  // January 1, 2026
  { place: "Belmont", from: "2026-01-01", rate: "18.95" },
  { place: "Burlingame", from: "2026-01-01", rate: "17.86" },
  { place: "Cupertino", from: "2026-01-01", rate: "18.70" },
  { place: "Daly City", from: "2026-01-01", rate: "17.50" },
  { place: "East Palo Alto", from: "2026-01-01", rate: "17.90" },
  { place: "El Cerrito", from: "2026-01-01", rate: "18.82" },
  { place: "Foster City", from: "2026-01-01", rate: "17.85" },
  { place: "Half Moon Bay", from: "2026-01-01", rate: "17.91" },
  { place: "Hayward", from: "2026-01-01", rate: "17.79", minEmployees: 26 },
  { place: "Los Altos", from: "2026-01-01", rate: "18.70" },
  { place: "Menlo Park", from: "2026-01-01", rate: "17.55" },
  { place: "Mountain View", from: "2026-01-01", rate: "19.70" },
  { place: "Novato", from: "2026-01-01", rate: "17.46", minEmployees: 26 },
  { place: "Novato", from: "2026-01-01", rate: "17.73", minEmployees: 100 },
  { place: "Oakland", from: "2026-01-01", rate: "17.34" },
  { place: "Palo Alto", from: "2026-01-01", rate: "18.70" },
  { place: "Petaluma", from: "2026-01-01", rate: "18.31" },
  { place: "Redwood City", from: "2026-01-01", rate: "18.65" },
  { place: "Richmond", from: "2026-01-01", rate: "19.18" },
  { place: "San Diego", from: "2026-01-01", rate: "17.75" },
  { place: "San Jose", from: "2026-01-01", rate: "18.45" },
  { place: "San Mateo", from: "2026-01-01", rate: "18.60" },
  { place: "San Mateo County (unincorporated)", from: "2026-01-01", rate: "17.95" },
  { place: "Santa Clara", from: "2026-01-01", rate: "18.70" },
  { place: "Santa Rosa", from: "2026-01-01", rate: "18.21" },
  { place: "South San Francisco", from: "2026-01-01", rate: "18.15" },
  { place: "Sunnyvale", from: "2026-01-01", rate: "19.50" },
  { place: "West Hollywood", from: "2026-01-01", rate: "20.25" },
  // July 1, 2026
  { place: "Alameda", from: "2026-07-01", rate: "17.76" },
  { place: "Berkeley", from: "2026-07-01", rate: "19.61" },
  { place: "Emeryville", from: "2026-07-01", rate: "20.34" },
  { place: "Fremont", from: "2026-07-01", rate: "18.05" },
  { place: "Los Angeles", from: "2026-07-01", rate: "18.42" },
  { place: "Los Angeles County (unincorporated)", from: "2026-07-01", rate: "18.47" },
  { place: "Malibu", from: "2026-07-01", rate: "17.91" },
  { place: "Milpitas", from: "2026-07-01", rate: "18.50" },
  { place: "Pasadena", from: "2026-07-01", rate: "18.57" },
  { place: "San Francisco", from: "2026-07-01", rate: "19.61" },
  { place: "Santa Monica", from: "2026-07-01", rate: "18.47" },
  // January 1, 2027, as announced by October 2026
  { place: "Belmont", from: "2027-01-01", rate: "19.60" },
  { place: "Burlingame", from: "2027-01-01", rate: "18.47" },
  { place: "Half Moon Bay", from: "2027-01-01", rate: "18.51" },
  { place: "Hayward", from: "2027-01-01", rate: "18.39", minEmployees: 26 },
  { place: "Novato", from: "2027-01-01", rate: "17.97", minEmployees: 26 },
  { place: "Novato", from: "2027-01-01", rate: "18.25", minEmployees: 100 },
  { place: "Palo Alto", from: "2027-01-01", rate: "19.25" },
  { place: "Petaluma", from: "2027-01-01", rate: "18.93" },
  { place: "San Diego", from: "2027-01-01", rate: "18.35" },
  { place: "San Mateo", from: "2027-01-01", rate: "19.25" },
  { place: "San Mateo County (unincorporated)", from: "2027-01-01", rate: "18.58" },
  { place: "Santa Clara", from: "2027-01-01", rate: "19.25" },
  { place: "West Hollywood", from: "2027-01-01", rate: "20.94" },
].map((r) => Object.freeze(r)));

/** Every place with its own minimum wage, for the work-city picker. */
export const LOCAL_MINIMUM_WAGE_PLACES: readonly string[] = Object.freeze([...new Set(ROWS.map((r) => r.place))].sort());

/** The place's name as listed, matching case and spacing loosely; null if it has no minimum wage of its own. */
export function localWagePlace(city: string | null | undefined): string | null {
  if (!city) return null;
  const key = city.trim().replace(/\s+/g, " ").toLowerCase().replace(/^city of /, "");
  return LOCAL_MINIMUM_WAGE_PLACES.find((p) => p.toLowerCase() === key) ?? null;
}

export interface LocalMinimumWage {
  place: string;
  rate: string;
  from: string;
  /** Set when the rate depends on the employer's size. */
  sizeNote?: string;
}

/**
 * The local minimum wage for work in `city` on `date`, for an employer with
 * `employeeCount` employees. Null when the place has none, none in force
 * yet, or the employer is too small for it.
 */
export function localMinimumWage(city: string | null | undefined, date: string, employeeCount: number): LocalMinimumWage | null {
  const place = localWagePlace(city);
  if (!place) return null;
  const rows = ROWS.filter((r) => r.place === place && r.from <= date);
  if (!rows.length) return null;
  const from = rows.map((r) => r.from).sort().at(-1)!;
  const tiered = rows.filter((r) => r.from === from);
  const row = tiered
    .filter((r) => (r.minEmployees ?? 0) <= employeeCount)
    .sort((a, b) => (b.minEmployees ?? 0) - (a.minEmployees ?? 0))[0];
  if (!row) return null;
  const out: LocalMinimumWage = { place, rate: row.rate, from };
  if (tiered.some((r) => r.minEmployees)) {
    out.sizeNote = `${place}'s rate depends on how many employees you have; this uses the ${employeeCount} on file`;
  }
  return out;
}

/** States whose local minimum wages are listed here; elsewhere no local rate is checked yet. */
export const LOCAL_MINIMUM_WAGE_STATES: readonly string[] = ["CA"];

/** The local rate if it's above the state's, else null. */
export function localMinimumAbove(
  place: { country: string; region?: string | null }, stateMinimum: string, city: string | null | undefined, date: string, employeeCount: number,
) {
  if (place.country !== "US" || !LOCAL_MINIMUM_WAGE_STATES.includes(place.region ?? "")) return null;
  const local = localMinimumWage(city, date, employeeCount);
  return local && new D(local.rate).gt(stateMinimum) ? local : null;
}
