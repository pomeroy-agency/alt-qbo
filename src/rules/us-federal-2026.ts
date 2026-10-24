import type { FederalRulePack } from "./types.js";

export const usFederal2026: FederalRulePack = {
  kind: "us-federal",
  id: "us-federal",
  version: "2026.1",
  place: { country: "US" },
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  status: "draft",
  sources: [
    { ref: "IRS Publication 15-T (2026), dated Dec 3, 2025", covers: "Worksheet 1A line 1g; MFJ annual schedules (used as test fixtures)", basis: "published" },
    { ref: "SSA, 2026 contribution and benefit base (Oct 2025)", covers: "Social Security wage base $184,500", basis: "published" },
    { ref: "Rev. Proc. 2025-32 (2026 inflation adjustments after P.L. 119-21)", covers: "2026 brackets and standard deductions", basis: "working-knowledge" },
    { ref: "IRC 3101, 3111, 3301; Form 941 and 940 instructions", covers: "FICA and FUTA rates", basis: "working-knowledge" },
  ],
  reviewNotes: [
    "Single and head-of-household withholding schedules are derived from the 2026 brackets and standard deductions using the same method that reproduces the published MFJ schedule exactly; compare them with Pub 15-T 2026 pages 11-12 before release.",
    "Head-of-household 2026 bracket thresholds are from working knowledge; confirm against Rev. Proc. 2025-32.",
    "FUTA here is the 0.6% net rate. California is a credit-reduction state; the 2026 reduction is set by the Department of Labor in November 2026 and lands on Form 940 Schedule A, so it is not withheld per pay run.",
  ],
  payroll: {
    socialSecurity: { employeeRate: "0.062", employerRate: "0.062", wageBase: "184500" },
    medicare: { employeeRate: "0.0145", employerRate: "0.0145", additionalRate: "0.009", additionalThreshold: "200000" },
    futa: { rate: "0.006", wageBase: "7000", note: "net of the 5.4% state credit; credit reduction handled on Schedule A" },
    supplementalRate: "0.22",
    incomeTax: {
      brackets: {
        single_or_mfs: [
          { over: "0", rate: "0.10" },
          { over: "12400", rate: "0.12" },
          { over: "50400", rate: "0.22" },
          { over: "105700", rate: "0.24" },
          { over: "201775", rate: "0.32" },
          { over: "256225", rate: "0.35" },
          { over: "640600", rate: "0.37" },
        ],
        mfj: [
          { over: "0", rate: "0.10" },
          { over: "24800", rate: "0.12" },
          { over: "100800", rate: "0.22" },
          { over: "211400", rate: "0.24" },
          { over: "403550", rate: "0.32" },
          { over: "512450", rate: "0.35" },
          { over: "768700", rate: "0.37" },
        ],
        hoh: [
          { over: "0", rate: "0.10" },
          { over: "17700", rate: "0.12" },
          { over: "67450", rate: "0.22" },
          { over: "105700", rate: "0.24" },
          { over: "201750", rate: "0.32" },
          { over: "256200", rate: "0.35" },
          { over: "640600", rate: "0.37" },
        ],
      },
      standardDeduction: { single_or_mfs: "16100", mfj: "32200", hoh: "24150" },
      line1g: { mfj: "12900", other: "8600" },
    },
  },
  entityDefaults: {
    framework: "US_GAAP",
    functionalCurrency: "USD",
    fiscalYearStartMonth: 1,
    coaTemplate: "us-service",
    ledgerRetentionYears: 7,
    payrollRetentionYears: 4,
  },
};
