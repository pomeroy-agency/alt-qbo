import type { CanadaFederalRulePack } from "./types.js";

// Canada federal, July to December 2026 (T4127 123rd edition). The July
// edition changed only provincial figures, so these federal figures hold
// for the whole year. Draft until Greg's review.
export const caFederal2026: CanadaFederalRulePack = {
  kind: "ca-federal",
  id: "ca-federal",
  version: "2026.2",
  place: { country: "CA" },
  effectiveFrom: "2026-07-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  sources: [
    { ref: "ESDC, Canada Pension Plan maximum benefit amounts and related figures (2026), as reported in search results; payroll publishers", covers: "CPP 5.95% (4.95% base, 1% first additional), $3,500 basic exemption, YMPE $74,600, CPP2 4% to YAMPE $85,000", basis: "working-knowledge" },
    { ref: "Revenu Québec, Employers: Principal Changes for 2026, as reported in search results", covers: "QPP 6.30%, QPP2 4%; QPIP 0.430% employee, 0.602% employer, $103,000 maximum insurable; EI 1.30% in Quebec", basis: "working-knowledge" },
    { ref: "CRA 2026 EI and tax figures, as reported by payroll publishers", covers: "EI 1.63%, $68,900 maximum insurable, employer 1.4×; federal brackets 14% to $58,523, 20.5% to $117,045, 26% to $181,440, 29% to $258,482, 33%; basic personal amount $16,452 falling to $14,829 from $181,440 to $258,482; Canada employment amount $1,501", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "⚠️ secondary: every figure here came from search results and payroll publishers because canada.ca refuses automated downloads. They are replaced from T4127 (123rd edition) once Greg uploads it.",
    "⚠️ check: QPP base rate 5.3% with the 1% first additional rate, so the 6.30% total matches Revenu Québec's 2026 maximum of $4,479.30.",
    "The 16.5% Quebec abatement reduces federal tax for employees reported to Quebec.",
    "Bonuses and retroactive pay use the regular annualized formula for now; T4127's bonus method (chapter 5) comes with the payroll PR.",
  ],
  cpp: { rate: "0.0595", baseRate: "0.0495", basicExemption: "3500", ympe: "74600", secondRate: "0.04", yampe: "85000" },
  qpp: { rate: "0.063", baseRate: "0.053", basicExemption: "3500", ympe: "74600", secondRate: "0.04", yampe: "85000" },
  ei: { rate: "0.0163", quebecRate: "0.013", employerMultiple: "1.4", maxInsurableEarnings: "68900" },
  qpip: { employeeRate: "0.0043", employerRate: "0.00602", maxInsurableEarnings: "103000" },
  incomeTax: {
    brackets: [
      { over: "0", rate: "0.14" },
      { over: "58523", rate: "0.205" },
      { over: "117045", rate: "0.26" },
      { over: "181440", rate: "0.29" },
      { over: "258482", rate: "0.33" },
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
