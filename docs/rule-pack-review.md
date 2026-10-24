# Rule pack review checklist (2026 packs)

Before a pack's `status` changes from `draft` to `released`, each item below needs sign-off (for Greg's review).

## us-federal 2026.1 (`src/rules/us-federal-2026.ts`)

| Figure | Value | Basis |
|---|---|---|
| Social Security wage base | $184,500 | SSA announcement, Oct 2025 |
| SS / Medicare rates | 6.2% / 1.45% each side; Additional Medicare 0.9% over $200,000 | statute |
| FUTA | 0.6% net on first $7,000 | statute; California credit reduction for 2026 is set in Nov 2026 and handled on Schedule A |
| Worksheet 1A line 1g | $12,900 MFJ, $8,600 other | Pub 15-T (2026), confirmed |
| MFJ withholding schedules | standard and Step 2 | Pub 15-T (2026); our derivation reproduces both exactly (test) |
| Single / HoH withholding schedules | derived from 2026 brackets | **compare with Pub 15-T 2026 tables**; Step 2 half-bracket rounding to be confirmed |
| HoH bracket thresholds | 17,700 / 67,450 / 105,700 / 201,750 / 256,200 / 640,600 | **working knowledge; confirm against Rev. Proc. 2025-32** |

## us-ca 2026.1 (`src/rules/us-ca-2026.ts`)

| Figure | Value | Basis |
|---|---|---|
| PIT Method B tables 1-7 (annual) | as in file | EDD 26methb.pdf |
| SDI | 1.3%, no wage limit | EDD 2026 rates page |
| UI | $7,000 base; 3.4% new-employer default | EDD; each employer enters its assigned rate |
| ETT | 0.1% on first $7,000 | EDD |
| Minimum wage | $16.90 statewide | **confirm; city ordinances not modelled** |
| Exempt salary floor | $70,304 (2 x min wage x 2,080) | **confirm** |
| Sick leave | 1 hour per 30 worked; 40-hour use cap; 80-hour accrual cap | Labor Code 246 as amended by SB 616 |
| Sales tax | services non-taxable by default; $500k remote-seller threshold | **confirm** |
| Franchise tax minimum | $800 | **confirm** |

## Chart of accounts tax lines (`src/rules/coa/us-service.ts`)

Tax-line codes for Schedule C, 1065, 1120S and 1120 are from working knowledge and need checking against the current forms and against each Intuit product's trial-balance import layout.
