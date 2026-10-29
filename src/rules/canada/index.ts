import { createHash } from "node:crypto";
import { canonicalJson } from "../../core/audit.js";
import { caFederal2026 } from "./federal-2026.js";
import { CANADA_PROVINCES_2026 } from "./provinces-2026.js";
import type { CanadaFederalRulePack, CanadaRulePack, ProvinceRulePack } from "./types.js";

export * from "./types.js";

const REGISTRY: readonly CanadaRulePack[] = Object.freeze([caFederal2026, ...CANADA_PROVINCES_2026]);

export interface ResolvedCanadaRules {
  federal: CanadaFederalRulePack;
  province: ProvinceRulePack;
  /** "id@version#hash" for each pack used. */
  provenance: string[];
}

/**
 * The federal and provincial packs in force for a province or territory on
 * a date (YYYY-MM-DD). `requireReleased` refuses drafts, as live pay runs must.
 */
export function resolveCanadaRules(region: string, onDate: string, opts: { requireReleased?: boolean } = {}): ResolvedCanadaRules {
  const inForce = (p: CanadaRulePack) => p.effectiveFrom <= onDate && onDate <= p.effectiveTo;
  const federal = REGISTRY.find((p): p is CanadaFederalRulePack => p.kind === "ca-federal" && inForce(p));
  const province = REGISTRY.find((p): p is ProvinceRulePack => p.kind === "ca-province" && p.place.region === region && inForce(p));
  if (!federal || !province) throw new Error(`no Canadian rule pack in force for ${region} on ${onDate}`);
  if (opts.requireReleased) {
    for (const p of [federal, province]) {
      if (p.status !== "released") throw new Error(`rule pack ${p.id}@${p.version} is ${p.status}; it must be released for live use`);
    }
  }
  return {
    federal,
    province,
    provenance: [federal, province].map((p) => `${p.id}@${p.version}#${createHash("sha256").update(canonicalJson(p)).digest("hex").slice(0, 12)}`),
  };
}

export function allCanadaRulePacks(): readonly CanadaRulePack[] {
  return REGISTRY;
}
