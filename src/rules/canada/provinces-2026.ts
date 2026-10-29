import type { ProvinceRulePack, QuebecIncomeTax, RateRow, Source, T4127ProvincialTax } from "./types.js";

// Provinces and territories, July to December 2026, from CRA's T4127 123rd
// edition (Table 8.1 rates and constants, Table 8.2 amounts) and Revenu
// Québec's TP-1015.F-V. The July edition changed British Columbia,
// Newfoundland and Labrador and Prince Edward Island mid-year: their figures
// here are the prorated ones CRA uses for the rest of 2026, so the year's
// withholding comes out right. Released 2026-10-29 after Greg's review.

const rows = (list: [over: number, rate: number, constant: number][]): RateRow[] =>
  list.map(([over, rate, constant]) => ({ over: String(over), rate: String(rate), constant: String(constant) }));

const T4127_JULY = "CRA T4127 Payroll Deductions Formulas, 123rd edition (effective July 1, 2026), uploaded by Greg 2026-10-29";
const table81 = (covers: string): Source => ({ ref: `${T4127_JULY}, Tables 8.1 and 8.2`, covers, basis: "published" });
const T4127_JANUARY = "CRA T4127 Payroll Deductions Formulas, 122nd edition (effective January 1, 2026), uploaded by Greg 2026-10-29";

function pack(region: string, name: string, incomeTax: T4127ProvincialTax | QuebecIncomeTax, sources: Source[], reviewNotes: string[]): ProvinceRulePack {
  return {
    kind: "ca-province",
    id: `ca-${region.toLowerCase()}`,
    version: "2026.3",
    name,
    place: { country: "CA", region },
    effectiveFrom: "2026-07-01",
    effectiveTo: "2026-12-31",
    status: "released",
    sources,
    reviewNotes,
    incomeTax,
  };
}

const t4127 = (td1: string, brackets: RateRow[], basicPersonalAmount: string, extra: Partial<T4127ProvincialTax> = {}): T4127ProvincialTax => ({
  method: "t4127", td1, brackets, creditRate: brackets[0]!.rate, basicPersonalAmount, ...extra,
});

export const caAlberta2026 = pack("AB", "Alberta",
  t4127("TD1AB", rows([[0, 0.08, 0], [61200, 0.10, 1224], [154259, 0.12, 4309], [185111, 0.13, 6160], [246813, 0.14, 8628], [370220, 0.15, 12331]]), "22769",
    { supplementalCredit: { over: "4896", rate: "0.25" } }),
  [
    table81("8% to $61,200 up to 15% over $370,220 with constants; basic personal amount $22,769"),
    { ref: `${T4127_JANUARY}, chapter 4 step 5 (Alberta)`, covers: "K5P = 25% of (K1P + K2P) above $4,896", basis: "published" },
  ],
  ["The supplemental credit only matters for TD1AB claims above about $56,000."]);

export const caBritishColumbia2026 = pack("BC", "British Columbia",
  t4127("TD1BC", rows([[0, 0.0614, 0], [50363, 0.077, 786], [100728, 0.105, 3606], [115648, 0.1229, 5676], [140430, 0.147, 9061], [190405, 0.168, 13059], [265545, 0.205, 22884]]), "13216",
    { taxReduction: { kind: "bc", amount: "805", over: "25570", rate: "0.0356", zeroAbove: "44952" } }),
  [
    table81("prorated 6.14% lowest rate, 7.70% to 20.50% over $265,545 with constants; basic personal amount $13,216"),
    { ref: `${T4127_JULY}, What's new and chapter 4 step 5 (British Columbia)`, covers: "lowest rate 5.06% to 5.60% for 2026 (Budget, February 17, 2026), prorated 6.14% July to December; basic reduction $805 prorated ($690 for the year), less 3.56% of income over $25,570, none over $44,952", basis: "published" },
  ],
  ["Payroll used 5.06% and a $575 reduction to June, so July to December uses CRA's prorated 6.14% and $805 to make the year come out right. From January 2027 BC brackets and credits stay at 2026 levels (indexation paused 2027 to 2030)."]);

export const caManitoba2026 = pack("MB", "Manitoba",
  t4127("TD1MB", rows([[0, 0.108, 0], [47000, 0.1275, 917], [100000, 0.174, 5567]]), "15780", { bpaPhaseOut: { from: "200000", to: "400000", min: "0" } }),
  [
    table81("10.8% to $47,000, 12.75% to $100,000, 17.4% above, with constants; basic personal amount by the BPAMB formula"),
    { ref: `${T4127_JANUARY}, chapter 2 (BPAMB formula) and what's new`, covers: "basic personal amount $15,780 (not indexed), falling evenly to $0 between $200,000 and $400,000 of net income (A + HD)", basis: "published" },
  ],
  []);

export const caNewBrunswick2026 = pack("NB", "New Brunswick",
  t4127("TD1NB", rows([[0, 0.094, 0], [52333, 0.14, 2407], [104666, 0.16, 4501], [193861, 0.195, 11286]]), "13664"),
  [table81("9.4% to $52,333, 14%, 16%, 19.5% over $193,861 with constants; basic personal amount $13,664")],
  []);

export const caNewfoundland2026 = pack("NL", "Newfoundland and Labrador",
  t4127("TD1NL", rows([[0, 0.087, 0], [44678, 0.145, 2591], [89354, 0.158, 3753], [159528, 0.178, 6943], [223340, 0.198, 11410], [285319, 0.208, 14263], [570638, 0.213, 17117], [1141275, 0.218, 22823]]), "15000",
    { claimReplaced: { old: "11188", now: "15000" } }),
  [
    table81("8.7% to $44,678 up to 21.8% over $1,141,275 with constants; basic personal amount $15,000 (prorated)"),
    { ref: `${T4127_JULY}, What's new (Newfoundland and Labrador)`, covers: "basic personal amount $11,188 to $13,094 for 2026 (announced April 29, 2026), prorated $15,000 from July; a TD1NL filed before July needs no replacement", basis: "published" },
  ],
  ["A TD1NL claiming only the basic amount is read as $15,000 from July; TrailBook applies that when the claim equals the old $11,188."]);

export const caNovaScotia2026 = pack("NS", "Nova Scotia",
  t4127("TD1NS", rows([[0, 0.0879, 0], [30995, 0.1495, 1909], [61991, 0.1667, 2976], [97417, 0.175, 3784], [157124, 0.21, 9283]]), "11932"),
  [table81("8.79% to $30,995 up to 21% over $157,124 with constants; basic personal amount $11,932")],
  ["The BPANS income-based formula was removed for 2026 (T4127 122nd edition); the flat $11,932 applies to everyone."]);

export const caOntario2026 = pack("ON", "Ontario",
  t4127("TD1ON", rows([[0, 0.0505, 0], [53891, 0.0915, 2210], [107785, 0.1116, 4376], [150000, 0.1216, 5876], [220000, 0.1316, 8076]]), "12989", {
    surtax: [{ over: "5818", rate: "0.20" }, { over: "7446", rate: "0.36" }],
    healthPremium: [
      { over: "20000", base: "0", rate: "0.06", cap: "300" },
      { over: "36000", base: "300", rate: "0.06", cap: "450" },
      { over: "48000", base: "450", rate: "0.25", cap: "600" },
      { over: "72000", base: "600", rate: "0.25", cap: "750" },
      { over: "200000", base: "750", rate: "0.25", cap: "900" },
    ],
    taxReduction: { kind: "on", basic: "300", perDependant: "554" },
  }),
  [
    table81("5.05% to $53,891 up to 13.16% over $220,000 with constants; basic personal amount $12,989; surtax 20% over $5,818 and 36% over $7,446; tax reduction basic amount (S2) $300"),
    { ref: `${T4127_JANUARY}, chapter 4 step 5 (Ontario)`, covers: "Health Premium (V2): nil to $20,000, then 6% and 25% steps capped at $300, $450, $600, $750 and $900, not reduced by S; tax reduction S = 2 × ($300 + Y) − (T4 + V1), Y = $554 per dependant under 19 and per disabled dependant", basis: "published" },
  ],
  []);

export const caPrinceEdwardIsland2026 = pack("PE", "Prince Edward Island",
  t4127("TD1PE", rows([[0, 0.095, 0], [33928, 0.1347, 1347], [65820, 0.166, 3407], [106890, 0.1762, 4497], [142520, 0.19, 6464], [200000, 0.21, 10464]]), "15000"),
  [
    table81("9.5% to $33,928 up to 19% to $200,000, prorated 21% above, with constants; basic personal amount $15,000"),
    { ref: `${T4127_JULY}, What's new (Prince Edward Island)`, covers: "new 20% bracket over $200,000 for 2026 (introduced April 14, 2026), prorated 21% from July", basis: "published" },
  ],
  ["The new top bracket starts in 2026 (CRA prorates it to 21% for July to December); some publishers say 2027."]);

export const caSaskatchewan2026 = pack("SK", "Saskatchewan",
  t4127("TD1SK", rows([[0, 0.105, 0], [54532, 0.125, 1091], [155805, 0.145, 4207]]), "20381"),
  [table81("10.5% to $54,532, 12.5% to $155,805, 14.5% above, with constants; basic personal amount $20,381")],
  []);

export const caNorthwestTerritories2026 = pack("NT", "Northwest Territories",
  t4127("TD1NT", rows([[0, 0.059, 0], [53003, 0.086, 1431], [106009, 0.122, 5247], [172346, 0.1405, 8436]]), "18198"),
  [table81("5.9% to $53,003 up to 14.05% over $172,346 with constants; basic personal amount $18,198")],
  ["The northern residents deduction (HD) comes from the employee's TD1 when they live in a prescribed zone."]);

export const caNunavut2026 = pack("NU", "Nunavut",
  t4127("TD1NU", rows([[0, 0.04, 0], [55801, 0.07, 1674], [111602, 0.09, 3906], [181439, 0.115, 8442]]), "19659"),
  [table81("4% to $55,801 up to 11.5% over $181,439 with constants; basic personal amount $19,659")],
  ["The northern residents deduction (HD) comes from the employee's TD1."]);

export const caYukon2026 = pack("YT", "Yukon",
  t4127("TD1YT", rows([[0, 0.064, 0], [58523, 0.09, 1522], [117045, 0.109, 3745], [181440, 0.128, 7193], [500000, 0.15, 18193]]), "federal", { canadaEmploymentAmount: true }),
  [table81("6.4% to $58,523 up to 15% over $500,000 with constants; basic personal amount by BPAYT; Canada employment amount $1,501 (K4P)")],
  ["BPAYT = BPAF (T4127 122nd edition, chapter 2): the federal amount and its phase-out."]);

export const caQuebec2026 = pack("QC", "Quebec",
  {
    method: "quebec", td1: "TP-1015.3",
    brackets: rows([[0, 0.14, 0], [54345, 0.19, 2717], [108680, 0.24, 8151], [132245, 0.2575, 10465]]),
    creditRate: "0.14", basicPersonalAmount: "18952", employmentDeduction: { rate: "0.06", max: "1450" }, labourFundCreditRate: "0.15",
  },
  [
    { ref: "Revenu Québec, TP-1015.F-V (2026-01), Formulas to Calculate Source Deductions and Contributions, uploaded by Greg 2026-10-29", covers: "section 2.1.1 formula; rates 14%, 19%, 24%, 25.75% with constants $0, $2,717, $8,151, $10,465 over $54,345, $108,680, $132,245; basic personal amount $18,952; deduction for workers 6% up to $1,450; QPP 6.30% (5.30% base), QPP2 4%; QPIP 0.430% / 0.602% to $103,000; Appendices 1 and 3", basis: "published" },
    { ref: "Ministère des Finances du Québec, Parameters of the Personal Income Tax System for 2026 (November 2025)", covers: "same thresholds and amounts, indexed 2.05%", basis: "published" },
  ],
  [
    "Quebec employees file the TP-1015.3 for Quebec tax and the federal TD1; federal tax is reduced by the 16.5% abatement.",
    "The guide includes no change announced after November 25, 2025; the rule watch checks Revenu Québec for mid-year changes.",
    "Health services fund (employer, 1.65% to 4.26% by total payroll) is a payroll-run item for the next pull request.",
  ]);

export const CANADA_PROVINCES_2026: readonly ProvinceRulePack[] = [
  caAlberta2026, caBritishColumbia2026, caManitoba2026, caNewBrunswick2026, caNewfoundland2026, caNovaScotia2026,
  caOntario2026, caPrinceEdwardIsland2026, caQuebec2026, caSaskatchewan2026, caNorthwestTerritories2026, caNunavut2026, caYukon2026,
];
