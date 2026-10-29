import type { CanadaFederalRulePack } from "./types.js";

// Canada federal, July to December 2026 (T4127 123rd edition). The July
// edition changed only provincial figures, so these federal figures hold
// for the whole year (checked against the January edition). Released
// 2026-10-29 after Greg's review.
export const caFederal2026: CanadaFederalRulePack = {
  kind: "ca-federal",
  id: "ca-federal",
  version: "2026.3",
  place: { country: "CA" },
  effectiveFrom: "2026-07-01",
  effectiveTo: "2026-12-31",
  status: "released",
  sources: [
    { ref: "CRA T4127 Payroll Deductions Formulas, 123rd edition (effective July 1, 2026), uploaded by Greg 2026-10-29, Tables 8.1 and 8.2 and chapter 4", covers: "federal rates 14%, 20.5%, 26%, 29%, 33% over $58,523, $117,045, $181,440, $258,482 with constants $3,804, $10,241, $15,685, $26,024; Canada employment amount $1,501; Quebec abatement 16.5%; maximum base CPP $3,519.45 (4.95% of 5.95%) and maximum EI $1,123.07; no federal change from the January edition; base CPP to fall from 4.95% to 4.75% on January 1, 2027", basis: "published" },
    { ref: "Revenu Québec TP-1015.F-V (2026-01), Principal changes and sections 3 and 4", covers: "QPP 6.30% (5.30% base, 1% first additional) on $3,500 to $74,600, QPP2 4% to $85,000; QPIP 0.430% employee and 0.602% employer to $103,000", basis: "published" },
    { ref: "CRA T4127 Payroll Deductions Formulas, 122nd edition (effective January 1, 2026), uploaded by Greg 2026-10-29, chapters 1, 2, 4, 6 and 7", covers: "CPP 5.95% to $4,230.45 and CPP2 4% to $416 (W = greater of PIYTD and YMPE); exemption per period truncated, contributions and premiums rounded half up; EI 1.63% to $1,123.07 (Quebec 1.30% to $895.70); K2Q with QPIP to $442.90; BPAF $16,452 falling by $1,623 / $77,042 per dollar of net income over $181,440 to $14,829; K4 on employment income before deductions; credits use the year's maximums once reached", basis: "published" },
  ],
  reviewNotes: [
    "The 16.5% Quebec abatement reduces federal tax for employees reported to Quebec; their K2 credit uses QPP base contributions, Quebec EI and QPIP.",
    "Bonuses and retroactive pay use the regular annualized formula for now; T4127's bonus method comes with the payroll pull request.",
    "2027: base CPP falls to 4.75% (T4127 upcoming changes); a 2027 pack is needed before the first 2027 pay date.",
  ],
  cpp: { rate: "0.0595", baseRate: "0.0495", basicExemption: "3500", ympe: "74600", secondRate: "0.04", yampe: "85000" },
  qpp: { rate: "0.063", baseRate: "0.053", basicExemption: "3500", ympe: "74600", secondRate: "0.04", yampe: "85000" },
  ei: { rate: "0.0163", quebecRate: "0.013", employerMultiple: "1.4", maxInsurableEarnings: "68900" },
  qpip: { employeeRate: "0.0043", employerRate: "0.00602", maxInsurableEarnings: "103000" },
  incomeTax: {
    brackets: [
      { over: "0", rate: "0.14", constant: "0" },
      { over: "58523", rate: "0.205", constant: "3804" },
      { over: "117045", rate: "0.26", constant: "10241" },
      { over: "181440", rate: "0.29", constant: "15685" },
      { over: "258482", rate: "0.33", constant: "26024" },
    ],
    creditRate: "0.14",
    basicPersonalAmount: { max: "16452", min: "14829", phaseFrom: "181440", phaseTo: "258482" },
    canadaEmploymentAmount: "1501",
    quebecAbatement: "0.165",
  },
  entityDefaults: {
    framework: "ASPE",
    functionalCurrency: "CAD",
    fiscalYearStartMonth: 1,
    coaTemplate: "ca-service",
    // Income Tax Act s. 230(4): six years from the end of the last tax year they relate to.
    ledgerRetentionYears: 6,
    payrollRetentionYears: 6,
  },
};
