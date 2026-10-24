import { createHash } from "node:crypto";
import { canonicalJson } from "../core/audit.js";
import { usCalifornia2026 } from "./us-ca-2026.js";
import { usFederal2026 } from "./us-federal-2026.js";
import type { CaliforniaRulePack, FederalRulePack, Place, RulePack } from "./types.js";

export * from "./types.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const REGISTRY: readonly RulePack[] = deepFreeze([usFederal2026, usCalifornia2026]);

/** Places the product is launched in. Anything else is refused at entity setup. */
export const SUPPORTED_PLACES: readonly Place[] = [{ country: "US", region: "CA" }];

export class JurisdictionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JurisdictionError";
  }
}

/** Content hash of a pack, recorded on every calculation so results can be traced to exact rules. */
export function rulePackHash(pack: RulePack): string {
  return createHash("sha256").update(canonicalJson(pack)).digest("hex");
}

export function isSupportedPlace(place: Place): boolean {
  return SUPPORTED_PLACES.some((p) => p.country === place.country && p.region === place.region);
}

export interface ResolveOptions {
  /** Live calculations must pass true, so draft figures never reach a real pay run. */
  requireReleased?: boolean;
}

export interface ResolvedRules {
  federal: FederalRulePack;
  state: CaliforniaRulePack;
  /** "id@version#hash" for each pack used. */
  provenance: string[];
}

/** Finds the federal and state packs in force for a place on a date (YYYY-MM-DD). */
export function resolveRules(place: Place, onDate: string, opts: ResolveOptions = {}): ResolvedRules {
  if (!isSupportedPlace(place)) {
    throw new JurisdictionError(
      `Alt-QBO is not launched in ${[place.country, place.region].filter(Boolean).join("-")} yet`,
    );
  }
  const inForce = (p: RulePack) => p.effectiveFrom <= onDate && onDate <= p.effectiveTo;
  const federal = REGISTRY.find(
    (p): p is FederalRulePack => p.kind === "us-federal" && p.place.country === place.country && inForce(p),
  );
  const state = REGISTRY.find(
    (p): p is CaliforniaRulePack =>
      p.kind === "us-ca" && p.place.country === place.country && p.place.region === place.region && inForce(p),
  );
  if (!federal || !state) {
    throw new JurisdictionError(`no rule pack in force for ${place.country}-${place.region} on ${onDate}`);
  }
  if (opts.requireReleased) {
    for (const p of [federal, state]) {
      if (p.status !== "released") {
        throw new JurisdictionError(`rule pack ${p.id}@${p.version} is ${p.status}; it must be released for live use`);
      }
    }
  }
  return {
    federal,
    state,
    provenance: [federal, state].map((p) => `${p.id}@${p.version}#${rulePackHash(p).slice(0, 12)}`),
  };
}

export function allRulePacks(): readonly RulePack[] {
  return REGISTRY;
}
