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
  /**
   * A digital product (Rev. & Tax. Code §6016.1): prewritten software however
   * delivered. Its tax follows the customer's own address and the period the
   * customer has access, and the SB 122 direct-payment and multiple-points-of-
   * use rules apply to it.
   */
  digitalProduct?: boolean;
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
  status: "released",
  statewideRate: "0.07250",
  maxCombinedRate: "0.12000",
  categories: {
    professional_service: {
      label: "Professional or creative service",
      help: "Consulting, design, writing, bookkeeping, coaching. Not taxable when nothing physical is handed over.",
      taxable: false, cite: "Rev. & Tax. Code §6051; Regulation 1501",
    },
    custom_software: {
      label: "Custom software",
      help: "Software written for this one customer, or a separately billed change made to their order to existing software. Not taxable.",
      taxable: false, cite: "Rev. & Tax. Code §6010.9; Regulation 1502",
    },
    digital_delivery: {
      label: "Delivered electronically",
      help: "Files, software or artwork sent by email or download with no disk or print. Not taxable.",
      taxable: false, cite: "Regulation 1502(f)(1)(D)",
    },
    prewritten_software: {
      label: "Software or app access",
      help: "Software or an app you offer to customers generally, including downloads, subscriptions and online access (SaaS). Not taxable in 2026 when downloaded or used online; on a disk or drive, choose \"Physical goods\". Taxable from January 1, 2027: enter when the customer's access starts.",
      taxable: false, cite: "Regulation 1502(f)(1)(D); Rev. & Tax. Code §6016.1 from January 1, 2027",
      digitalProduct: true,
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
    own_delivery: {
      label: "Delivery in your own vehicle",
      help: "Delivery charge when you or your staff deliver taxable goods yourselves, not by carrier or mail. Taxable like the goods. If what you delivered isn't taxable, the charge isn't either: choose the same kind of sale as the item.",
      taxable: true, cite: "Regulation 1628(b)(3)",
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
    { ref: "Rev. & Tax. Code §§6201, 6202, 6225, 7262", covers: "use tax owed by the buyer when the seller didn't collect; qualified purchasers; district use tax", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Regulation 1540: a graphic designer or commercial artist who hands over finished art in physical form, or whose design is part of a printed item they sell, owes tax on the design charge too. The 'printed_materials' category covers that; confirm the guidance shown to users is right.",
    "Delivery address decides the district rate (Regulation 1802/1823: district taxes follow where the property is delivered when the retailer is engaged in business there). TrailBook uses the customer's address, else the business's own address for sales at its location. Confirm this default for service businesses that rarely ship.",
    "Out-of-state delivery is treated as exempt interstate sales (Regulation 1620) only when the customer's address is outside California.",
    "Sales for resale are exempt only with a timely, good-faith resale certificate (Regulation 1668). TrailBook records the customer's seller's permit number but does not verify it with the CDTFA.",
    "Shipping is nontaxable only when separately stated and by common carrier or mail direct to the customer; delivery in the seller's own vehicle can be taxable (Regulation 1628). The category help says so; consider a separate 'own delivery' category.",
    "Use tax on purchases (Rev. & Tax. Code §§6201, 6202): a bill marked as untaxed by the vendor accrues use tax on its taxable lines, using these same categories (software by the start of access), at the CDTFA rate for the business's own address (district use tax, §7262). It is added to the line's cost and credited to sales tax payable. Greg accepted these readings on 2026-10-25: the citations, the business address as the place of use, and accruing software in full (no multiple-points-of-use split on purchases until Reg. 1600.2 is adopted). Recheck the statute text when ca.gov can be reached.",
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
    professional_service: {
      label: "Professional or creative service",
      help: "Consulting, design, writing, bookkeeping, coaching. Not taxable when nothing physical is handed over, including work delivered through a portal or app when the customer is paying for a person's work done after they asked for it.",
      taxable: false, cite: "Rev. & Tax. Code §§6051, 6372.1; Regulation 1501; draft Regulation 1600(g)(3)",
    },
    digital_delivery: {
      label: "Delivered electronically",
      help: "Files, artwork, photos, writing, music, video or e-books sent by email, download or a shared link, with no disk or print. Also cloud hosting or platforms customers run their own software on. Not taxable. For ready-made software or app access, choose \"Software or app access\".",
      taxable: false, cite: "Regulation 1502(f)(1)(D); Rev. & Tax. Code §6016.1(b) (digital assets, audio, audiovisual and visual works, books, video games, digital infrastructure)",
    },
    prewritten_software: {
      label: "Software or app access",
      help: "Software or an app you offer to customers generally, including downloads, subscriptions and online access (SaaS). Taxable from January 1, 2027, even if it started as a custom project. Enter when the customer's access starts, and bill setup, training or consulting on separate lines.",
      taxable: true, cite: "Rev. & Tax. Code §§6016.1, 6016.2, 6010.9; draft Regulation 1600",
      digitalProduct: true,
    },
  },
  sources: [
    ...usCaliforniaSalesTax2026.sources,
    { ref: "SB 122 (Stats. 2026, ch. 23), signed June 29, 2026: Rev. & Tax. Code §§6010.9, 6016.1, 6016.2, 6372.1", covers: "prewritten software, including SaaS, taxable from 2027-01-01; exclusions; custom software; human-effort services; $5,000,000 direct payment", basis: "working-knowledge" },
    { ref: "CDTFA draft emergency Regulations 1600, 1600.2 and 1502.2 (discussion paper, Sept 1, 2026); notice L-1036", covers: "remote access, sourcing by the customer's address (1600(d)(2)(A)), timing by access period, human-effort exemption (1600(g)(3)), multiple-points-of-use certificate (1600.2)", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Carried over unchanged from the 2026 pack: the 7.25% statewide rate, the 12% sanity bound, and every category except the three below. The statewide rate is not changing for 2027 as far as published sources show; January 2027 district rate changes come from the CDTFA rate lookup, not this pack.",
    "Legal review 2026-10-25 (https://claude.ai/artifact/KNyqBmPyM1axk2JoiLD44n): 'prewritten_software' is taxable (§6016.1, however delivered, including remote access under §6016.2). Custom software (§6010.9) has its own non-taxable choice. 'professional_service' names the human-effort exemption (§6372.1) and 'digital_delivery' names the §6016.1(b) exclusions, including digital infrastructure. ca.gov was blocked from the build machines, so the statute and CDTFA text were read through search extracts; confirm against the chaptered text before release.",
    "Sourcing (draft Reg. 1600(d)(2)(A)): billing address, then shipping, payment instrument, mailing. TrailBook uses the customer's address as the billing address and refuses a taxable software line when the customer has none, rather than using the business's own address.",
    "Timing: tax follows the access period, not the invoice date. Each software line carries the period the customer has access; a period that runs across a change in taxability must be split. How CDTFA will treat one prepaid period that began in 2026 is unsettled; TrailBook asks for the split, the conservative reading.",
    "$5,000,000 direct payment: a customer flagged as holding a use tax direct payment permit (owner or accountant only) is not charged tax on software lines. TrailBook warns once a customer's software billing for the year passes $4,000,000 without the flag; it does not apply the threshold itself.",
    "Multiple points of use (proposed Reg. 1600.2, not yet adopted): a customer's certificate can give the share of use in California; software lines are taxed on that share only. Recheck when 1600.2 is adopted.",
    "Keep this pack in draft until OAL approves CDTFA's emergency regulations and the adopted text is read.",
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
