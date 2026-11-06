// TrailBook's own prices, as approved on 2026-10-25 (see docs/pricing.md).
// Prices are per business, before sales tax. Every subscription keeps a
// copy of the price list it signed up under, so a later change to this file
// never changes what an existing customer pays; moving customers to new
// prices is a separate, announced step (at most once a year, at most 10%,
// with 60 days' notice).

export type Plan = "books" | "books_payroll";
export type Interval = "month" | "year";
/** Businesses with a Canadian billing address pay in Canadian dollars; everyone else in US dollars. */
export type BillingCurrency = "USD" | "CAD";

export interface PriceList {
  version: string;
  /** Lists from before Canadian billing have no currency: they are US dollars. */
  currency?: BillingCurrency;
  /** Minor units (cents) per plan and interval. */
  plan: Record<Plan, Record<Interval, number>>;
  /** Each business after the first. */
  extraBusiness: Record<Plan, Record<Interval, number>>;
  /** Books + Payroll: each person paid in a month. Billed monthly in arrears on either interval. */
  perPersonMonth: number;
}

export const CURRENT_PRICES: PriceList = {
  version: "2026-10",
  currency: "USD",
  plan: { books: { month: 1500, year: 15000 }, books_payroll: { month: 3500, year: 35000 } },
  extraBusiness: { books: { month: 1000, year: 10000 }, books_payroll: { month: 2500, year: 25000 } },
  perPersonMonth: 400,
};

// The fixed Canadian-dollar list Greg approved on 2026-10-29 (about 1.42 CAD
// per USD, rounded), the same figures pomeroyagency.com shows Canadian
// visitors (web/currency.js). A change here needs the same change there.
export const CURRENT_PRICES_CAD: PriceList = {
  version: "2026-10-cad",
  currency: "CAD",
  plan: { books: { month: 2100, year: 21000 }, books_payroll: { month: 4900, year: 49000 } },
  extraBusiness: { books: { month: 1400, year: 14000 }, books_payroll: { month: 3500, year: 35000 } },
  perPersonMonth: 600,
};

export function currentPrices(currency: BillingCurrency): PriceList {
  return currency === "CAD" ? CURRENT_PRICES_CAD : CURRENT_PRICES;
}

/** An amount for an email or invoice line: $15.00, or C$21.00 in Canadian dollars. */
export function formatMoney(minor: number | bigint, currency: BillingCurrency | string = "USD"): string {
  const n = Number(minor);
  const abs = (Math.abs(n) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}${currency === "CAD" ? "C$" : "$"}${abs}`;
}

export const PLAN_NAMES: Record<Plan, string> = { books: "Books", books_payroll: "Books + Payroll" };

export const TRIAL_DAYS = 30;
/** The first 100 businesses to start paying keep their prices this long. */
export const FOUNDING_SEATS = 100;
export const FOUNDING_LOCK_MONTHS = 24;
/** After a failed payment, the books stay fully usable this long while the card is fixed. */
export const GRACE_DAYS = 14;
/** Days between retries of a failed payment. */
export const RETRY_DAYS = 3;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Same day of the month, `months` later; the last day of the month when it has no such day. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** The last day of a period that starts on `start`. */
export function periodEnd(start: string, interval: Interval): string {
  return addDays(addMonths(start, interval === "month" ? 1 : 12), -1);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
