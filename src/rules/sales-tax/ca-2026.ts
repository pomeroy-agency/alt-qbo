import type { RulePackMeta, Source } from "../types.js";

// Canadian sales taxes: the federal GST (5%), the harmonized sales tax (HST)
// that replaces it in Ontario and the Atlantic provinces, the provincial sales
// taxes of British Columbia, Manitoba (RST) and Saskatchewan, and Quebec's
// QST. What is taxable is decided by the kind of sale; which province's tax
// applies by where the customer is (the place of supply); and whether the
// business charges it by its registrations. Draft until Greg's review.

export type CaRegion = "AB" | "BC" | "MB" | "NB" | "NL" | "NS" | "NT" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

/** How the GST/HST (and QST, which follows it) treats a kind of sale. */
export type GstStatus = "taxable" | "zero_rated" | "exempt";

export interface CaTaxCategory {
  label: string;
  help: string;
  /** For the shared invoice screens: true when GST/HST is charged at more than 0%. */
  taxable: boolean;
  cite: string;
  gst: GstStatus;
  /** Provinces whose PST (RST in Manitoba) applies to this kind of sale. */
  pst: ("BC" | "MB" | "SK")[];
  digitalProduct?: boolean;
}

export interface RateStep {
  from: string;
  rate: string;
}

export interface CanadaSalesTaxPack extends RulePackMeta {
  kind: "ca-sales-tax";
  gstRate: string;
  /** HST provinces and their combined rate (5% federal part included), by date. */
  hst: Partial<Record<CaRegion, RateStep[]>>;
  /** Provincial sales tax (RST in Manitoba). */
  pst: Record<"BC" | "MB" | "SK", { name: string; rate: string; authority: string; dueDay: number | "last" }>;
  qstRate: string;
  /** Small supplier: no GST/HST registration needed until taxable sales pass this over four calendar quarters. */
  smallSupplierLimit: string;
  /** Sanity bound for the top combined rate on a line. */
  maxCombinedRate: string;
  categories: Record<string, CaTaxCategory>;
}

const WK = (ref: string, covers: string): Source => ({ ref, covers, basis: "working-knowledge" });

export const canadaSalesTax2026: CanadaSalesTaxPack = {
  kind: "ca-sales-tax",
  id: "ca-sales-tax-2026",
  version: "2026.1",
  place: { country: "CA", region: "ALL" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  sources: [
    WK("Excise Tax Act Part IX and Schedules V, VI and IX; CRA GST/HST rates page", "GST 5%; HST 13% in Ontario, 15% in New Brunswick, Newfoundland and Labrador and Prince Edward Island; Nova Scotia 14% from April 1, 2025; place-of-supply rules"),
    WK("Provincial Sales Tax Act (British Columbia); The Retail Sales Tax Act (Manitoba); The Provincial Sales Tax Act (Saskatchewan)", "PST 7% BC, RST 7% Manitoba, PST 6% Saskatchewan, and which services and software they tax"),
    WK("Act respecting the Québec sales tax; Revenu Québec QST rate", "QST 9.975% on the price before GST, following GST/HST taxability"),
    WK("CRA RC4022 General Information for GST/HST Registrants", "small supplier limit $30,000; filing periods and due dates; return lines 101-113"),
  ],
  reviewNotes: [
    "⚠️ check: which services each PST taxes (legal services in BC and Saskatchewan; software and SaaS in all three; professional services nowhere) is working knowledge.",
    "⚠️ check: place of supply is simplified to the customer's address for both goods and services; the full rules in Schedule IX look at delivery and where services are performed.",
    "⚠️ check: sales to customers outside Canada are treated as zero-rated exports; some services to non-residents aren't (Schedule VI Part V).",
    "PST and QST are charged only where the business is registered for them; TrailBook warns when a sale looks like it needs a registration the business hasn't recorded.",
  ],
  gstRate: "0.05",
  hst: {
    ON: [{ from: "2010-07-01", rate: "0.13" }],
    NB: [{ from: "2016-07-01", rate: "0.15" }],
    NL: [{ from: "2016-07-01", rate: "0.15" }],
    NS: [{ from: "2010-07-01", rate: "0.15" }, { from: "2025-04-01", rate: "0.14" }],
    PE: [{ from: "2016-10-01", rate: "0.15" }],
  },
  pst: {
    BC: { name: "BC PST", rate: "0.07", authority: "BC Ministry of Finance", dueDay: "last" },
    MB: { name: "Manitoba RST", rate: "0.07", authority: "Manitoba Finance", dueDay: 20 },
    SK: { name: "Saskatchewan PST", rate: "0.06", authority: "Saskatchewan Finance", dueDay: 20 },
  },
  qstRate: "0.09975",
  smallSupplierLimit: "30000",
  maxCombinedRate: "0.15",
  categories: {
    professional_service: {
      label: "Professional or consulting service",
      help: "Consulting, design, marketing, accounting, coaching and similar services. GST/HST (and QST in Quebec) apply; no province's PST does.",
      taxable: true, gst: "taxable", pst: [], cite: "ETA s. 165; PST acts (services not listed)",
    },
    legal_service: {
      label: "Legal service",
      help: "Services of a lawyer or notary. GST/HST apply, and PST in British Columbia and Saskatchewan.",
      taxable: true, gst: "taxable", pst: ["BC", "SK"], cite: "ETA s. 165; BC PST Act s. 119; SK PST Act s. 5",
    },
    goods: {
      label: "Goods",
      help: "Physical things sold or delivered: products, equipment, printed materials. GST/HST apply, and PST in BC, Manitoba and Saskatchewan.",
      taxable: true, gst: "taxable", pst: ["BC", "MB", "SK"], cite: "ETA s. 165; PST acts (tangible personal property)",
    },
    software: {
      label: "Software or SaaS",
      help: "Prewritten software, apps, software subscriptions and online software services. GST/HST apply, and PST in BC, Manitoba and Saskatchewan.",
      taxable: true, gst: "taxable", pst: ["BC", "MB", "SK"], cite: "ETA s. 165; BC PST Act (software); MB RST (software and online services); SK PST (computer services)",
    },
    repair_service: {
      label: "Repair or installation of goods",
      help: "Repairing, maintaining or installing equipment and other goods. GST/HST apply, and PST in BC, Manitoba and Saskatchewan.",
      taxable: true, gst: "taxable", pst: ["BC", "MB", "SK"], cite: "ETA s. 165; PST acts (services to tangible personal property)",
    },
    zero_rated: {
      label: "Zero-rated (0% GST/HST)",
      help: "Basic groceries, prescription drugs and medical devices, and other zero-rated supplies. Taxed at 0%: you still claim credits for the tax you paid on what you bought to make them.",
      taxable: false, gst: "zero_rated", pst: [], cite: "ETA Schedule VI",
    },
    exempt: {
      label: "Exempt from GST/HST",
      help: "Residential rent, most health care and dental services, education, childcare and financial services. No GST/HST, and you can't claim credits for tax paid to make them.",
      taxable: false, gst: "exempt", pst: [], cite: "ETA Schedule V",
    },
  },
};

export const CA_REGIONS = new Set<string>(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

/** The Canadian sales tax pack. One pack covers every province; the year's rates are the ones dated in it. */
export function canadaSalesTaxRules(_onDate: string): CanadaSalesTaxPack {
  return canadaSalesTax2026;
}

/** The HST rate in force in a province on a date, or null where GST (and maybe PST or QST) applies instead. */
export function hstRate(pack: CanadaSalesTaxPack, region: string, onDate: string): string | null {
  const steps = pack.hst[region as CaRegion];
  if (!steps) return null;
  return [...steps].reverse().find((s) => s.from <= onDate)?.rate ?? null;
}

export const PROVINCE_NAMES: Record<CaRegion, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia",
  NT: "the Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
