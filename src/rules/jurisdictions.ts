// Where TrailBook can be used: countries, and the states, provinces and
// territories in each. A business picks its country, then its principal
// place of business within it. A place is "live" once it has rule packs
// (src/rules/index.ts) and Greg has approved launching it; "planned" places
// show in the picker but can't be chosen yet.

export type JurisdictionStatus = "live" | "planned";

export interface Region {
  code: string;
  name: string;
  status: JurisdictionStatus;
}

export interface Country {
  code: string;
  name: string;
  currency: string;
  /** What a region is called there: "State" or "Province or territory". */
  regionLabel: string;
  status: JurisdictionStatus;
  regions: Region[];
}

const planned = (list: [string, string][]): Region[] => list.map(([code, name]) => ({ code, name, status: "planned" as const }));

const US_REGIONS: [string, string][] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
  ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"],
  ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"],
  ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

const CANADA_REGIONS: [string, string][] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"],
  ["NS", "Nova Scotia"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"], ["SK", "Saskatchewan"],
  ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["YT", "Yukon"],
];

/** Regions launched so far, by country. */
const LIVE: Record<string, string[]> = { US: ["CA", "TX", "FL", "NV", "TN", "SD", "WY", "NH", "AK", "WA", "AZ", "OR", "NY", "IL", "CO", "NC", "GA", "UT", "ID", "MI", "VA", "MA", "NJ", "PA", "OH", "IN", "MD", "MO", "WI", "MN", "SC", "AL", "LA", "KY", "OK", "CT", "IA", "AR", "DE", "KS", "MS", "ND", "MT", "NM", "RI", "VT", "WV", "HI", "NE"] };

export const COUNTRIES: readonly Country[] = ([
  { code: "US", name: "United States", currency: "USD", regionLabel: "State", status: "live", regions: planned(US_REGIONS) },
  { code: "CA", name: "Canada", currency: "CAD", regionLabel: "Province or territory", status: "planned", regions: planned(CANADA_REGIONS) },
] as Country[]).map((c) => ({ ...c, regions: c.regions.map((r) => (LIVE[c.code]?.includes(r.code) ? { ...r, status: "live" as const } : r)) }));

export function countryOf(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

export function regionOf(country: string, region: string | null | undefined): Region | undefined {
  return countryOf(country)?.regions.find((r) => r.code === region);
}

/** A live region in a live country. */
export function isLive(country: string, region: string | null | undefined): boolean {
  return countryOf(country)?.status === "live" && regionOf(country, region)?.status === "live";
}
