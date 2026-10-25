import type { RateLookup } from "../core/sales-tax.js";

// California's official rate lookup: the CDTFA's public tax rate API, which
// returns the combined state and district rate for an address. Free, no key.
// https://services.maps.cdtfa.ca.gov/api/taxrate

const BASE = "https://services.maps.cdtfa.ca.gov/api/taxrate/GetRateByAddress";

export function cdtfaRateLookup(fetchImpl: typeof fetch = fetch, timeoutMs = 8000): RateLookup {
  return cached(async (a) => {
    const url = `${BASE}?${new URLSearchParams({ address: a.line1, city: a.city, zip: a.zip.slice(0, 5) })}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`the CDTFA rate lookup answered ${res.status}`);
    return parseCdtfaRate(await res.json());
  });
}

/**
 * Remembers answers for a few hours, so the live preview on the invoice
 * screen doesn't ask the CDTFA again for every keystroke. Rates change at
 * most quarterly, and the invoice records the rate it was issued with.
 */
export function cached(lookup: RateLookup, ttlMs = 6 * 3600_000, max = 500): RateLookup {
  const memo = new Map<string, { at: number; value: Awaited<ReturnType<RateLookup>> }>();
  return async (a) => {
    const key = [a.line1, a.city, a.state, a.zip].map((s) => s.trim().toLowerCase()).join("|");
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await lookup(a);
    if (memo.size >= max) memo.delete(memo.keys().next().value!);
    memo.set(key, { at: Date.now(), value });
    return value;
  };
}

/** Reads the CDTFA's answer. Refuses anything ambiguous rather than guess a rate. */
export function parseCdtfaRate(body: any): { rate: string; jurisdiction: string; matchedAddress?: string } {
  const infos: any[] = Array.isArray(body?.taxRateInfo) ? body.taxRateInfo : [];
  const rates = [...new Set(infos.map((i) => Number(i?.rate)).filter((r) => Number.isFinite(r) && r > 0))];
  if (!rates.length) throw new Error("the CDTFA couldn't find a rate for that address");
  if (rates.length > 1) throw new Error("that address sits on a boundary between tax areas; check it, or have an accountant set the rate");
  const info = infos.find((i) => Number(i?.rate) === rates[0]);
  // The CDTFA answers in capitals ("SAN FRANCISCO"); people read "San Francisco".
  const title = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const place = [title(info?.jurisdiction), title(info?.city), info?.county ? `${title(info.county)} County` : ""].filter(Boolean);
  return {
    rate: rates[0]!.toFixed(5),
    jurisdiction: [...new Set(place)].join(", ") || "California",
    matchedAddress: typeof body?.geocodeInfo?.formattedAddress === "string" ? body.geocodeInfo.formattedAddress : undefined,
  };
}

/**
 * Stand-in rates for local development and demos without network access to
 * the CDTFA: a few well-known cities, else the statewide 7.25%. Never used
 * in production.
 */
export const sampleRateLookup: RateLookup = async (a) => {
  const zip = a.zip.slice(0, 3);
  const known: Record<string, [string, string]> = {
    "900": ["0.09750", "Los Angeles, Los Angeles County"],
    "941": ["0.08625", "San Francisco, San Francisco County"],
    "921": ["0.07750", "San Diego, San Diego County"],
    "958": ["0.08750", "Sacramento, Sacramento County"],
  };
  const [rate, jurisdiction] = known[zip] ?? ["0.07250", `${a.city} (sample statewide rate)`];
  return { rate, jurisdiction: `${jurisdiction} (sample rate)` };
};
