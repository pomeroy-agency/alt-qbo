import { Decimal } from "decimal.js";

// Exact decimal arithmetic for rates and tax math. Results are rounded to
// cents half-up, the convention IRS and EDD worksheets use.
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export type Currency = string;

/** An amount in integer minor units (cents for USD) with its currency. */
export interface Money {
  readonly minor: bigint;
  readonly currency: Currency;
}

const MINOR_DIGITS: Record<string, number> = { USD: 2, CAD: 2, GBP: 2, EUR: 2, AUD: 2, JPY: 0 };

export function minorDigits(currency: Currency): number {
  const digits = MINOR_DIGITS[currency];
  if (digits === undefined) throw new Error(`unsupported currency ${currency}`);
  return digits;
}

export function money(minor: bigint, currency: Currency = "USD"): Money {
  minorDigits(currency);
  return { minor, currency };
}

/** Parses a decimal string such as "1234.50" into minor units. Rejects sub-cent input. */
export function parseMoney(value: string, currency: Currency = "USD"): Money {
  const digits = minorDigits(currency);
  const d = new D(value);
  const scaled = d.mul(new D(10).pow(digits));
  if (!scaled.isInteger()) throw new Error(`${value} has more than ${digits} decimal places`);
  return money(BigInt(scaled.toFixed(0)), currency);
}

/** Rounds a decimal major-unit amount to minor units, half-up. */
export function toMinor(amount: Dec | string | number, currency: Currency = "USD"): bigint {
  const digits = minorDigits(currency);
  return BigInt(new D(amount).toDecimalPlaces(digits, D.ROUND_HALF_UP).mul(new D(10).pow(digits)).toFixed(0));
}

/** Converts minor units back to a major-unit decimal. */
export function toMajor(minor: bigint, currency: Currency = "USD"): Dec {
  return new D(minor.toString()).div(new D(10).pow(minorDigits(currency)));
}

export function formatMoney(m: Money): string {
  return `${toMajor(m.minor, m.currency).toFixed(minorDigits(m.currency))} ${m.currency}`;
}

export function sumMinor(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}
