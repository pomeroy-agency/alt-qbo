import type { ProvinceRulePack, QuebecIncomeTax, RateRow, Source, T4127ProvincialTax } from "./types.js";

// Provinces and territories, July to December 2026 (T4127 123rd edition and
// Revenu Québec's TP-1015.F-V). The July edition changed British Columbia,
// Newfoundland and Labrador and Prince Edward Island mid-year: their figures
// here are the prorated ones CRA uses for the rest of 2026, so the year's
// withholding comes out right. All drafts until Greg's review.

const rows = (list: [over: number, rate: number][]): RateRow[] => list.map(([over, rate]) => ({ over: String(over), rate: String(rate) }));

const SECONDARY = "⚠️ secondary: figures from search results and tax publishers because canada.ca refuses automated downloads; replaced from T4127 (123rd edition) once Greg uploads it.";

function pack(region: string, name: string, incomeTax: T4127ProvincialTax | QuebecIncomeTax, sources: Source[], reviewNotes: string[]): ProvinceRulePack {
  return {
    kind: "ca-province",
    id: `ca-${region.toLowerCase()}`,
    version: "2026.2",
    name,
    place: { country: "CA", region },
    effectiveFrom: "2026-07-01",
    effectiveTo: "2026-12-31",
    status: "draft",
    sources,
    reviewNotes,
    incomeTax,
  };
}

const t4127 = (td1: string, brackets: RateRow[], basicPersonalAmount: string, extra: Partial<T4127ProvincialTax> = {}): T4127ProvincialTax => ({
  method: "t4127", td1, brackets, creditRate: brackets[0]!.rate, basicPersonalAmount, ...extra,
});

export const caAlberta2026 = pack("AB", "Alberta",
  t4127("TD1AB", rows([[0, 0.08], [61200, 0.10], [154259, 0.12], [185111, 0.13], [246813, 0.14], [370220, 0.15]]), "22769",
    { supplementalCredit: { over: "60000", rate: "0.02" } }),
  [{ ref: "CRA T4032AB January 2026 general information, as quoted in search results; Alberta 2025 thresholds indexed 2%", covers: "8% to $61,200 up to 15% over $370,220; basic personal amount $22,769", basis: "working-knowledge" }],
  [SECONDARY, "⚠️ check: middle thresholds ($154,259, $185,111, $246,813) are the 2025 ones indexed by 2%.", "⚠️ check: the supplemental credit (2% of non-refundable credits above $60,000) is how TrailBook reads Alberta's new credit; it only matters for very large TD1AB claims."]);

export const caBritishColumbia2026 = pack("BC", "British Columbia",
  t4127("TD1BC", rows([[0, 0.0614], [50363, 0.077], [100728, 0.105], [115648, 0.1229], [140430, 0.147], [190405, 0.168], [265545, 0.205]]), "13216",
    { taxReduction: { kind: "bc", amount: "805", over: "25570", rate: "0.0356" } }),
  [
    { ref: "Province of British Columbia, personal income tax rates (2026), as quoted in search results", covers: "5.60% to $50,363, 7.70%, 10.50%, 12.29%, 14.70%, 16.80%, 20.50% over $265,545", basis: "working-knowledge" },
    { ref: "Payroll publishers on T4127 123rd edition (July 2026)", covers: "prorated 6.14% lowest rate and $805 tax reduction for July to December; basic personal amount $13,216", basis: "working-knowledge" },
  ],
  [SECONDARY, "The lowest rate rose from 5.06% to 5.60% for 2026; payroll used 5.06% to June, so July to December uses 6.14% (2 × 5.60 − 5.06) for the bracket and credits.", "⚠️ check: tax reduction $805 for July to December (full year $690); the $25,570 threshold and 3.56% reduction rate are 2025's $25,020 indexed 2.2% and 2025's rate."]);

export const caManitoba2026 = pack("MB", "Manitoba",
  t4127("TD1MB", rows([[0, 0.108], [47000, 0.1275], [100000, 0.174]]), "15780", { bpaPhaseOut: { from: "200000", to: "400000", min: "0" } }),
  [{ ref: "EY, Manitoba Budget 2026 tax alert; tax publishers", covers: "10.8% to $47,000, 12.75% to $100,000, 17.4% above (not indexed); basic personal amount $15,780, phased out between $200,000 and $400,000 of net income", basis: "working-knowledge" }],
  [SECONDARY, "⚠️ check: TrailBook phases the basic personal amount out on annual taxable income from pay, as T4127 does with A."]);

export const caNewBrunswick2026 = pack("NB", "New Brunswick",
  t4127("TD1NB", rows([[0, 0.094], [50957, 0.14], [101914, 0.16], [188765, 0.195]]), "13664"),
  [{ ref: "CI Financial, 2026 New Brunswick budget highlights; 2025 figures indexed 2%", covers: "9.4%, 14%, 16%, 19.5%; basic personal amount $13,664", basis: "working-knowledge" }],
  [SECONDARY, "⚠️ check: sources disagree on the first threshold ($50,957 from indexing 2025's $49,958, or $52,333)."]);

export const caNewfoundland2026 = pack("NL", "Newfoundland and Labrador",
  t4127("TD1NL", rows([[0, 0.087], [44678, 0.145], [89354, 0.158], [159528, 0.178], [223340, 0.198], [285319, 0.208], [570638, 0.213], [1141275, 0.218]]), "15000"),
  [{ ref: "Wealthsimple and CI Financial (2026 NL budget, indexing 1.1%); payroll publishers on T4127 123rd edition", covers: "8.7% to $44,678 up to 21.8% over $1,141,275; basic personal amount $13,094 for 2026, $15,000 prorated for July to December", basis: "working-knowledge" }],
  [SECONDARY, "The 2026 budget raised the basic personal amount; payroll used $11,188 to June, so July to December uses $15,000."]);

export const caNovaScotia2026 = pack("NS", "Nova Scotia",
  t4127("TD1NS", rows([[0, 0.0879], [30995, 0.1495], [61991, 0.1667], [97417, 0.175], [157124, 0.21]]), "11932"),
  [{ ref: "Government of Nova Scotia, Personal income tax rates and indexation (2026, indexed 1.6%), as quoted in search results", covers: "8.79% to $30,995 up to 21% over $157,124; basic personal amount $11,932", basis: "working-knowledge" }],
  [SECONDARY]);

export const caOntario2026 = pack("ON", "Ontario",
  t4127("TD1ON", rows([[0, 0.0505], [53891, 0.0915], [107785, 0.1116], [150000, 0.1216], [220000, 0.1316]]), "12989", {
    surtax: rows([[5818, 0.20], [7446, 0.36]]),
    healthPremium: [
      { over: "20000", base: "0", rate: "0.06", cap: "300" },
      { over: "36000", base: "300", rate: "0.06", cap: "450" },
      { over: "48000", base: "450", rate: "0.25", cap: "600" },
      { over: "72000", base: "600", rate: "0.25", cap: "750" },
      { over: "200000", base: "750", rate: "0.25", cap: "900" },
    ],
    taxReduction: { kind: "on", basic: "300", perDependant: "554" },
  }),
  [{ ref: "CRA T4032ON January 2026 and tax publishers", covers: "5.05% to $53,891 up to 13.16% over $220,000; basic personal amount $12,989; surtax 20% over $5,818 and 36% over $7,446; tax reduction $300; Ontario Health Premium schedule (not indexed)", basis: "working-knowledge" }],
  [SECONDARY, "⚠️ check: $554 per dependant for the Ontario tax reduction is 2025's amount indexed 1.9%."]);

export const caPrinceEdwardIsland2026 = pack("PE", "Prince Edward Island",
  t4127("TD1PE", rows([[0, 0.095], [33928, 0.1347], [65820, 0.166], [106890, 0.1762], [142520, 0.19]]), "15000"),
  [{ ref: "PEI 2026 budget summary (ACGCA), as quoted in search results", covers: "9.5% to $33,928 up to 19% over $142,520; basic personal amount $15,000", basis: "working-knowledge" }],
  [SECONDARY, "⚠️ check: payroll publishers say the July edition adds a prorated 21% rate over $200,000, but PEI's budget says the 20% bracket starts January 1, 2027. Not included until T4127 settles it."]);

export const caSaskatchewan2026 = pack("SK", "Saskatchewan",
  t4127("TD1SK", rows([[0, 0.105], [54532, 0.125], [155805, 0.145]]), "20381"),
  [{ ref: "Tax publishers (2026)", covers: "10.5% to $54,532, 12.5% to $155,805, 14.5% above; basic personal amount $20,381", basis: "working-knowledge" }],
  [SECONDARY]);

export const caNorthwestTerritories2026 = pack("NT", "Northwest Territories",
  t4127("TD1NT", rows([[0, 0.059], [53003, 0.086], [106009, 0.122], [172346, 0.1405]]), "18198"),
  [{ ref: "CRA current-year tax rates (2026), as quoted in search results", covers: "5.9% to $53,003 up to 14.05% over $172,346; basic personal amount $18,198", basis: "working-knowledge" }],
  [SECONDARY, "Northern residents deduction (HD) is taken from the employee's TD1 when they live in a prescribed zone."]);

export const caNunavut2026 = pack("NU", "Nunavut",
  t4127("TD1NU", rows([[0, 0.04], [55801, 0.07], [111602, 0.09], [181439, 0.115]]), "19659"),
  [{ ref: "CRA current-year tax rates (2026), as quoted in search results", covers: "4% to $55,801 up to 11.5% over $181,439; basic personal amount $19,659", basis: "working-knowledge" }],
  [SECONDARY]);

export const caYukon2026 = pack("YT", "Yukon",
  t4127("TD1YT", rows([[0, 0.064], [58523, 0.09], [117045, 0.109], [181440, 0.128], [500000, 0.15]]), "federal", { canadaEmploymentAmount: true }),
  [{ ref: "CRA current-year tax rates (2026), as quoted in search results", covers: "6.4% to $58,523 up to 15% over $500,000; basic personal amount follows the federal amount; Canada employment amount credit", basis: "working-knowledge" }],
  [SECONDARY]);

export const caQuebec2026 = pack("QC", "Quebec",
  { method: "quebec", td1: "TP-1015.3", brackets: rows([[0, 0.14], [54345, 0.19], [108680, 0.24], [132245, 0.2575]]), creditRate: "0.14", basicPersonalAmount: "18952", employmentDeduction: { rate: "0.06", max: "1450" } },
  [{ ref: "Ministère des Finances du Québec, Parameters of the Personal Income Tax System for 2026 (November 2025), Table 3", covers: "brackets to $54,345, $108,680, $132,245; basic personal amount $18,952; deduction for workers up to $1,450 (indexed 2.05%)", basis: "published" }],
  [
    "Rates 14%, 19%, 24% and 25.75% and the 6% deduction for employment income are Quebec's 2026 rules (rates are not in the parameters document).",
    "⚠️ check: the TP-1015.F-V formula itself (deductions taken before tax, credits at 14%) is written from working knowledge until Greg uploads the guide; Revenu Québec refuses automated downloads.",
    "Quebec employees file the TP-1015.3 for Quebec tax and the federal TD1; federal tax is reduced by the 16.5% abatement.",
  ]);

export const CANADA_PROVINCES_2026: readonly ProvinceRulePack[] = [
  caAlberta2026, caBritishColumbia2026, caManitoba2026, caNewBrunswick2026, caNewfoundland2026, caNovaScotia2026,
  caOntario2026, caPrinceEdwardIsland2026, caQuebec2026, caSaskatchewan2026, caNorthwestTerritories2026, caNunavut2026, caYukon2026,
];
