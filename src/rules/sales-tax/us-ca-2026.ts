import type { RulePackMeta } from "../types.js";

// Which California sales are taxable, by the kind of thing sold. Rates are
// not here: they depend on the delivery address and come from the CDTFA's
// rate lookup when an invoice is issued.

export interface TaxCategory {
  label: string;
  /** Shown next to the choice so the person picking it knows why. */
  help: string;
  taxable: boolean;
  cite: string;
}

export interface SalesTaxRulePack extends RulePackMeta {
  kind: "us-ca-sales-tax";
  /** Statewide base rate; district taxes are added on top for most addresses. */
  statewideRate: string;
  /** Sanity bounds for a looked-up combined rate. */
  maxCombinedRate: string;
  categories: Record<string, TaxCategory>;
}

export const usCaliforniaSalesTax2026: SalesTaxRulePack = {
  kind: "us-ca-sales-tax",
  id: "us-ca-sales-tax-2026",
  version: "2026.1.0",
  place: { country: "US", region: "CA" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  statewideRate: "0.07250",
  maxCombinedRate: "0.12000",
  categories: {
    professional_service: {
      label: "Professional or creative service",
      help: "Consulting, design, writing, bookkeeping, coaching. Not taxable when nothing physical is handed over.",
      taxable: false, cite: "Rev. & Tax. Code §6051; Regulation 1501",
    },
    digital_delivery: {
      label: "Delivered electronically",
      help: "Files, software or artwork sent by email or download with no disk or print. Not taxable.",
      taxable: false, cite: "Regulation 1502(f)(1)(D)",
    },
    prewritten_software: {
      label: "Software or app access",
      help: "Ready-made software or a subscription to an online app (SaaS), sold to many customers. Not taxable in 2026 when delivered electronically; taxable from January 1, 2027.",
      taxable: false, cite: "Regulation 1502(f)(1)(D); SB 122 (2026) from 2027",
    },
    repair_labor: {
      label: "Repair or installation labor",
      help: "Labor to repair or install, billed separately from parts. Not taxable; bill parts as goods.",
      taxable: false, cite: "Regulation 1546",
    },
    shipping: {
      label: "Shipping by carrier",
      help: "Separately stated delivery charge, shipped by common carrier or mail straight to the customer. Not taxable.",
      taxable: false, cite: "Regulation 1628(b)",
    },
    goods: {
      label: "Physical goods",
      help: "Products, parts, merchandise or equipment sold to the customer. Taxable.",
      taxable: true, cite: "Rev. & Tax. Code §6051",
    },
    printed_materials: {
      label: "Printed materials",
      help: "Brochures, signs, business cards, prints. Taxable, including design charges for the finished printed piece.",
      taxable: true, cite: "Regulations 1540 and 1541",
    },
    fabrication_labor: {
      label: "Making something for the customer",
      help: "Labor to produce, assemble or customize a physical item for the customer. Taxable.",
      taxable: true, cite: "Regulation 1526",
    },
    equipment_rental: {
      label: "Equipment rental",
      help: "Renting or leasing equipment or other physical property to the customer. Usually taxable.",
      taxable: true, cite: "Regulation 1660",
    },
  },
  sources: [
    { ref: "CDTFA Publication 106, Combined Sales and Use Tax Rates", covers: "statewide 7.25% base rate", basis: "working-knowledge" },
    { ref: "CDTFA Regulations 1501, 1502, 1526, 1540, 1541, 1546, 1628, 1660", covers: "taxability of each category", basis: "working-knowledge" },
    { ref: "CDTFA tax rate API, services.maps.cdtfa.ca.gov/api/taxrate", covers: "combined rate for a delivery address", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Regulation 1540: a graphic designer or commercial artist who hands over finished art in physical form, or whose design is part of a printed item they sell, owes tax on the design charge too. The 'printed_materials' category covers that; confirm the guidance shown to users is right.",
    "Delivery address decides the district rate (Regulation 1802/1823: district taxes follow where the property is delivered when the retailer is engaged in business there). Alt-QBO uses the customer's address, else the business's own address for sales at its location. Confirm this default for service businesses that rarely ship.",
    "Out-of-state delivery is treated as exempt interstate sales (Regulation 1620) only when the customer's address is outside California.",
    "Sales for resale are exempt only with a timely, good-faith resale certificate (Regulation 1668). Alt-QBO records the customer's seller's permit number but does not verify it with the CDTFA.",
    "Shipping is nontaxable only when separately stated and by common carrier or mail direct to the customer; delivery in the seller's own vehicle can be taxable (Regulation 1628). The category help says so; consider a separate 'own delivery' category.",
    "The CDTFA rate API was checked on the deploy preview on 2026-10-25 (San Francisco 8.625%, Los Angeles 10.25%, San Diego 7.75%, Sacramento 8.75%). Spot-check addresses on district boundaries before release.",
  ],
};

// SB 122 (signed June 29, 2026) brings prewritten software into the sales
// tax base from January 1, 2027, however it's delivered, including remote
// access. Custom software and digital visual, audio and audiovisual works
// and books stay outside it, so electronically delivered creative work is
// still not taxable.
export const usCaliforniaSalesTax2027: SalesTaxRulePack = {
  ...usCaliforniaSalesTax2026,
  id: "us-ca-sales-tax-2027",
  version: "2027.1.0",
  effectiveFrom: "2027-01-01",
  effectiveTo: "2027-12-31",
  status: "draft",
  categories: {
    ...usCaliforniaSalesTax2026.categories,
    digital_delivery: {
      label: "Delivered electronically",
      help: "Files, artwork, photos, writing or custom-built software sent by email, download or a shared link, with no disk or print. Not taxable. Ready-made software and app subscriptions are taxable from 2027: choose \"Software or app access\".",
      taxable: false, cite: "Regulation 1502(f)(1)(D); SB 122 (2026) exclusions for custom software and digital works",
    },
    prewritten_software: {
      label: "Software or app access",
      help: "Ready-made software or a subscription to an online app (SaaS), sold to many customers, however it's delivered. Taxable from January 1, 2027. Custom software built for one customer is not.",
      taxable: true, cite: "SB 122 (2026), operative January 1, 2027",
    },
  },
  sources: [
    ...usCaliforniaSalesTax2026.sources,
    { ref: "SB 122 (Stats. 2026), signed June 29, 2026", covers: "prewritten software, including SaaS, taxable from 2027-01-01; exclusions", basis: "working-knowledge" },
    { ref: "CDTFA discussion paper and draft emergency regulations on digital products (Sept 2026)", covers: "SaaS and remotely accessed software within the definition", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Carried over unchanged from the 2026 pack: the 7.25% statewide rate, the 12% sanity bound, and every category except the two below. The statewide rate is not changing for 2027 as far as published sources show; January 2027 district rate changes come from the CDTFA rate lookup, not this pack.",
    "New for 2027 (rule watch, 2026-10-25): SB 122 makes prewritten software taxable however delivered, including SaaS. 'prewritten_software' is taxable; 'digital_delivery' stays not taxable for custom software and digital works (visual, audio, audiovisual, books), which SB 122 excludes. Confirmed by several secondary sources (K&L Gates, Snell & Wilmer, Baker Tilly, Avalara); the statute text and CDTFA's emergency regulations were not read directly because ca.gov is blocked from the build machines.",
    "SB 122 shifts reporting to the purchaser for some sales over $5,000,000 and has its own rules for where remotely accessed software is taxed. Alt-QBO taxes at the customer's address like any other sale; confirm that's right for SaaS sold to customers with users in several places.",
    "Software first built custom and later held for repeated sale becomes prewritten. The help text says 'sold to many customers'; confirm the wording.",
    ...usCaliforniaSalesTax2026.reviewNotes,
  ],
};

const PACKS: readonly SalesTaxRulePack[] = [usCaliforniaSalesTax2026, usCaliforniaSalesTax2027];

/** The sales-tax pack in force in a state on a date. */
export function salesTaxRules(region: string | null, onDate: string): SalesTaxRulePack | null {
  return PACKS.find((p) => p.place.region === region && p.effectiveFrom <= onDate && onDate <= p.effectiveTo) ?? null;
}

/** The newest sales-tax pack for a state, for choices that aren't tied to a date. */
export function latestSalesTaxRules(region: string | null): SalesTaxRulePack | null {
  return PACKS.filter((p) => p.place.region === region).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}
