# Rule pack review checklist (2026 packs)

Before a pack's `status` changes from `draft` to `released`, each item below needs Greg's sign-off. Every figure was checked against current sources on 2026-10-25; the **Check** column says how.

**Sign-off, 2026-10-27.** Greg reviewed this list and approved every item as it stands. The us-federal 2026.1, us-ca 2026.1 and us-ca-sales-tax 2026.1 packs are now `released`, and saved pay runs calculate only on released packs. Items marked ⚠️ were accepted on the figures shown; each note says what to recheck when the primary source can be read, and the daily rule watch keeps looking for them. The us-ca-sales-tax 2027.1 pack stays `draft` on the review's own recommendation, until OAL approves CDTFA's emergency regulations. A daily scheduled check watches the sources for changes (see "Monitoring" at the end).

## us-federal 2026.1 (`src/rules/us-federal-2026.ts`), released 2026-10-27

| Figure | Value | Source | Check |
|---|---|---|---|
| Social Security wage base | $184,500 | SSA, Oct 2025 | ✅ matches |
| SS / Medicare rates | 6.2% / 1.45% each side; Additional Medicare 0.9% over $200,000 | IRC 3101, 3111, 3102(f) | ✅ matches |
| FUTA | 0.6% net on first $7,000 | IRC 3301; Form 940 | ✅ matches. California is on the DOL's 2026 credit-reduction list (likely 1.5%); final figure after Nov 10, 2026, goes on Schedule A. `futa.creditReduction.CA` is blank until then, so Form 940 line 11 shows blank with a warning |
| Supplemental rate | 22% (37% over $1 million) | Pub 15 (2026) | ✅ matches |
| 2026 brackets, all statuses | as in file | Rev. Proc. 2025-32, Tables 1-4 | ✅ matches the IRS PDF, including head of household (17,700 / 67,450 / 105,700 / 201,750 / 256,200 / 640,600) |
| Standard deductions | $16,100 / $32,200 / $24,150 | Rev. Proc. 2025-32 §3.14 | ✅ matches |
| Worksheet 1A line 1g | $12,900 MFJ, $8,600 other | Pub 15-T (2026) | ✅ matches |
| Deposit rules | $50,000 lookback; monthly by the 15th; semiweekly Wed/Fri with 3 business days after the period; $100,000 next day; $2,500 pay with return; FUTA over $500 quarterly | Pub 15 (2026) §11, §14 Table 4 | ✅ matches the IRS PDF, including the 2026 DC legal holidays (tests reproduce Pub 15's examples) |
| Withholding schedules, all six | derived from brackets | Pub 15-T (2026) page 11 | ✅ all six now reproduce the published table exactly (tests). **Fixed:** single Step 2 thresholds were off by 50 cents because the IRS rounds halved thresholds to the dollar |

## us-ca 2026.1 (`src/rules/us-ca-2026.ts`), released 2026-10-27

Version 2026.2 (October 2026) is the same pack moved into the shared state pack format so other states can be added. No figure changed; pay runs approved earlier keep "us-ca@2026.1" in their history.

| Figure | Value | Source | Check |
|---|---|---|---|
| PIT Method B tables 1-7 (annual) | as in file | EDD 26methb.pdf | ✅ single and head-of-household thresholds and rates match the USDA payroll bulletin that reproduces the EDD tables; married thresholds are exactly twice single below $1M; every base amount is consistent. ⚠️ The EDD site is blocked from our build machines, so the $1,000 estimated-deduction allowance is confirmed only by third-party summaries |
| Low-income exemption, standard deduction, allowance credit | $18,896 / $37,791; $5,706 / $11,412; $168.30 | EDD 26methb.pdf | ✅ matches (third-party summaries of the PDF) |
| Supplemental PIT rates | 6.6%; 10.23% bonuses and stock options | EDD | ✅ matches |
| SDI | 1.3%, no wage limit | EDD rates page; SCO letter 25-019 | ✅ matches |
| UI | $7,000 base; schedule F+ (1.5% to 6.2%); 3.4% new employer | EDD | ✅ matches |
| ETT | 0.1% on first $7,000 | EDD | ✅ matches |
| Minimum wage | $16.90 statewide | Dept. of Finance; Labor Code 1182.12 | ✅ matches. ⚠️ About 40 cities and counties are higher (Los Angeles city $18.42, LA County unincorporated $18.47, San Francisco $19.61 from July 1, 2026). See local minimum wages below |
| Exempt salary floor | $70,304 | Labor Code 515(a): 2 × $16.90 × 2,080 | ✅ matches |
| Sick leave | 1 hour per 30 worked; 40-hour use cap; 80-hour accrual cap | Labor Code 246 (SB 616) | ✅ matches; unchanged for 2026. Some cities are more generous |
| PIT and SDI deposits | under $350 quarterly; $350 to $400 monthly by the 15th; over $400 on the federal semiweekly or next-day timing | EDD Payroll Tax Deposits page (2026) | ✅ accepted 2026-10-27 ⚠️ recheck: from search results (EDD site blocked here). The 2025 DE 44 used $500 where 2026 uses $400; confirm against the 2026 DE 44 table |
| UI and ETT deposits | quarterly with the DE 9; 2026 dates Apr 30, Jul 31, Nov 2, Feb 1 2027 | EDD Required Filings and Due Dates | ✅ the computed dates match the EDD's list |
| Remote-seller threshold | $500,000 | R&TC 6203 (AB 147) | ✅ matches |
| Franchise tax minimum | $800 | R&TC 17941, 23153 | ✅ matches; the first-year LLC exemption (AB 85) ended with 2023 |

### Local minimum wages (`src/rules/local-minimum-wage.ts`, added 2026-10-27, awaiting Greg's review)

Each employee can have a city where they work. When it has its own minimum wage above the state's, a pay run warns (it doesn't block) for an hourly rate below it, using the rate in force on the last day of the pay period, and the employee list flags anyone paid below today's rate.

| What | Covered | Check |
|---|---|---|
| Rates from Jan 1, 2026 | 28 cities and San Mateo County unincorporated, incl. San Jose $18.45, San Diego $17.75, Oakland $17.34, Mountain View $19.70, Sunnyvale $19.50, West Hollywood $20.25 | ⚠️ from CalChamber, Davis Wright Tremaine and CDF summaries; city sites and the Berkeley Labor Center list are blocked here |
| Rates from Jul 1, 2026 | Alameda, Berkeley, Emeryville, Fremont, Los Angeles, LA County unincorporated, Malibu, Milpitas, Pasadena, San Francisco, Santa Monica | ⚠️ same sources. Pay periods ending before Jul 1, 2026 aren't checked for these 11 |
| Announced for Jan 1, 2027 | Burlingame, Half Moon Bay, Hayward, Novato, Palo Alto, Petaluma, San Diego, San Mateo, San Mateo County, Santa Clara, West Hollywood | ⚠️ the other cities announce in Nov and Dec; the daily rule watch adds them. Local rates below the 2027 state $17.40 (e.g. Oakland's 2026 rate) are ignored |
| Size tiers | Hayward (26+ employees), Novato (26 to 99, 100+) | ⚠️ counts employees on file in TrailBook, which may miss staff paid elsewhere |
| Not covered | hotel and health-care worker rates, salaried non-exempt staff, local sick-leave rules | known gap |

### Already announced for 2027 (a 2027 pack is needed before the first 2027 pay date)

| Figure | 2027 value | Status |
|---|---|---|
| Social Security wage base | $192,300 | final (SSA, Oct 14, 2026) |
| California minimum wage | $17.40 | final (certified Jul 31, 2026) |
| Exempt salary floor | $72,384 | follows from the minimum wage |
| UI and ETT wage base, ETT rate | $7,000; 0.1% | final (EDD) |
| SDI rate | 1.4% forecast | final rate due in December |
| Federal brackets, Pub 15-T, EDD Method B | not yet published | expected Oct to Dec 2026 |

## us-ca-sales-tax 2026.1 (`src/rules/sales-tax/us-ca-2026.ts`), released 2026-10-27

| Kind of sale | Taxable | Basis |
|---|---|---|
| Professional or creative service | no | Rev. & Tax. Code §6051; Reg. 1501 |
| Delivered electronically | no | Reg. 1502(f)(1)(D) |
| Repair or installation labor (billed apart from parts) | no | Reg. 1546 |
| Shipping by carrier, separately stated | no | Reg. 1628(b) |
| Delivery in your own vehicle (added 2026-10-27, as recommended below) | yes, when the goods are taxable | Reg. 1628(b)(3) |
| Physical goods | yes | §6051 |
| Printed materials, including their design charges | yes | Regs. 1540, 1541 |
| Making something for the customer | yes | Reg. 1526 |
| Equipment rental | yes (usually) | Reg. 1660 |

Confirmed by Greg on 2026-10-27:
- **Which address sets the rate.** The customer's address is used, or the business's own address if the customer has none. Confirm this default for service businesses that rarely ship (Regs. 1802/1823).
- **Out of state.** A sale is exempt as interstate only when the customer's address is outside California (Reg. 1620).
- **Resale.** A sale is exempt only when the customer's seller's permit is on file. The number is recorded but not checked with the CDTFA (Reg. 1668).
- **Own-vehicle delivery.** Delivery in the seller's own vehicle can be taxable (Reg. 1628). Done 2026-10-27: a separate "Delivery in your own vehicle" kind of sale, taxable, with help saying to use the item's own kind when the item isn't taxable.
- **Rate lookup.** The rate comes from the CDTFA's tax rate API. It was spot-checked for four cities on 2026-10-25, and the live site returned 10.25% for Los Angeles City Hall the same day. Addresses on district boundaries still need checking.
- **Design charges.** CDTFA annotations (430.0194, 100.0103, 100.0159, 100.0162, still in the 2026 law guide) say finished or sketched designs handed over in physical form are taxable, while preliminary art billed separately is not. Designs delivered only electronically are not tangible, which is why "professional or creative service" defaults to not taxable.

### us-ca-sales-tax 2027.1 (same file, draft; rule watch and legal review 2026-10-25)

Legal review: https://claude.ai/artifact/KNyqBmPyM1axk2JoiLD44n. ca.gov was blocked from the build machines, so the statute and CDTFA text were read through search extracts; check the citations against the chaptered SB 122 and the adopted regulations before release.

| Change | 2027 value | Source | Check |
|---|---|---|---|
| Prewritten software, including downloads and SaaS ("Software or app access") | taxable for access from 2027-01-01; not taxable in the 2026 pack (on a disk, use "Physical goods") | Rev. & Tax. Code §§6016.1, 6016.2 (SB 122, Stats. 2026, ch. 23); draft Reg. 1600 | ⚠️ accepted 2026-10-27; recheck against the chaptered text before release |
| "Prewritten" test in the help text | offered to customers generally, even if first built custom | §6010.9 ("held or existing for general or repeated sale or lease"); Reg. 1502 | ✅ accepted 2026-10-27 ⚠️ recheck: same |
| Custom software (new choice, both packs) | not taxable | §6010.9; Reg. 1502 (moving to proposed Reg. 1502.2) | ✅ accepted 2026-10-27 ⚠️ recheck: same |
| Digital works and digital infrastructure ("Delivered electronically") | not taxable | §6016.1(b) | ✅ accepted 2026-10-27 ⚠️ recheck: same |
| Services delivered through software ("Professional or creative service") | not taxable when the customer pays for a person's work done after they asked | §6372.1; draft Reg. 1600(g)(3) | ✅ accepted 2026-10-27 ⚠️ recheck: CDTFA hasn't settled the line |
| Everything else | carried over from 2026 | | carried over; without a 2027 pack, invoices dated 2027 could not be issued |

How the app applies it (`src/core/sales-tax.ts`):
- **Timing.** A software line can carry the period the customer has access. Its tax follows the pack for the start of that period, not the invoice date. A period that runs across a change in taxability is refused with a request to split it. An invoice dated within about two months before the change must give the start date. One prepaid period that began in 2026 is unsettled at CDTFA; the split is the conservative reading.
- **Sourcing.** Software is taxed at the customer's own address (draft Reg. 1600(d)(2)(A): billing, shipping, payment instrument, mailing). With no customer address, a taxable software line is refused rather than taxed at the business's address.
- **$5,000,000 direct payment.** An owner or accountant can record a customer's use tax direct payment permit. Software lines to that customer are then not taxed, and the return figures show them on their own line. A warning appears once a customer's software billing for the year passes $4,000,000 without a permit.
- **Multiple points of use.** An owner or accountant can record the California share and date from a customer's certificate (proposed Reg. 1600.2). Software lines are taxed on that share only; the rest shows on the return figures as software used outside California. Recheck when 1600.2 is adopted.
- **Release.** Keep the pack in draft until OAL approves CDTFA's emergency regulations and the adopted text is read.

### Use tax on purchases (both packs; added 2026-10-25)

When a vendor doesn't charge California tax on something taxable, the business owes use tax on it. The case SB 122 makes common: software and SaaS bought from vendors that don't collect California tax, from January 1, 2027.

How the app applies it (`decideUseTax` and `recordBill` in `src/core/sales-tax.ts`):
- **When.** A bill accrues use tax when the person ticks "The vendor didn't charge California sales tax", which defaults to on for vendors marked that way. TrailBook doesn't decide whether the vendor should have charged tax.
- **What.** Each line's kind decides taxability under the same pack as invoices, and software follows the start of the access period with the same split rule. So software bought for 2027 access accrues use tax and software for 2026 access doesn't.
- **Rate.** The CDTFA rate for the business's own address, where it uses what it bought. That includes district use tax, on the reading that the business uses the purchase in the district where it is located. An owner or accountant can set the rate by hand.
- **Books.** The use tax is added to the cost of the line (its expense or asset account) and credited to sales tax payable. It is never owed to the vendor, so payables and the bill total don't include it.
- **Return figures.** Bills that accrued use tax show as "purchases subject to use tax", with the use tax by tax area. That is the use tax line on the CDTFA-401.

| Point | Reading used | Source | Check |
|---|---|---|---|
| Buyer owes use tax when the seller didn't collect | yes, on property (from 2027, software) stored, used or consumed in California | Rev. & Tax. Code §§6201, 6202 | ✅ Greg accepted 2026-10-25 (recheck the text when ca.gov can be reached) |
| District use tax follows the place of use | the business's own address | Rev. & Tax. Code §7262; Reg. 1823 | ✅ Greg accepted 2026-10-25: business address; revisit if multi-location clients need it |
| Software with users inside and outside California | taxed in full; no multiple-points-of-use split on purchases yet | proposed Reg. 1600.2 | ✅ Greg accepted 2026-10-25: accrue in full (conservative); revisit when 1600.2 is adopted |
| Where it's reported | the CDTFA-401 for seller's permit holders. Without a permit: a CDTFA use tax return for qualified purchasers (generally $100,000+ gross receipts), otherwise the California income tax return | Rev. & Tax. Code §6225 (qualified purchasers) | ✅ Greg accepted 2026-10-25 (recheck the threshold when ca.gov can be reached) |
| Resale, and items used outside California | not accrued: the person leaves the box unticked or picks a non-taxable kind | Reg. 1668 | ✅ by design |

## States without a wage income tax (`src/rules/us-states-2026.ts`), draft, awaiting Greg's review

Added 2026-10-29 at Greg's choice of order (these nine first, then Oregon, Arizona and New York). Each pack is `draft`: a business there can keep its books and preview payroll, but saved pay runs are refused until Greg approves the figures below and the pack is `released`. Figures were gathered on 2026-10-28; most state sites can't be opened from TrailBook's build machines, so several come from payroll publishers and each ⚠️ says what to read off the agency's own notice. UI rates are per employer: the pack holds the new-employer rate, and the employer enters its own rate from its notice. Workers' compensation (state-run in Washington and Wyoming) and local minimum wages outside California aren't covered yet. Sales tax in these states isn't worked out: invoices carry no tax unless an owner or accountant sets the rate by hand.

### us-tx 2026.1, Texas (draft)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Texas UI (TX_UI, employer, TWC) | 2.7% default; employer enters its own rate, on the first $9,000 | for Greg's review |
| Quarterly report | Employer's Quarterly Report (C-3), filed and paid quarterly | for Greg's review |
| Minimum wage | $7.25 | for Greg's review |
| Exempt salary floor (a year) | $35,568 | for Greg's review |
| Overtime | After 40 hours a week | for Greg's review |
| Paid sick leave | No state law | for Greg's review |
| New-hire report | Within 20 days to Texas Office of the Attorney General (Employer New Hire Reporting) | for Greg's review |

- ⚠️ Some sources say a new employer's rate is the greater of 2.7% or its industry average; TWC's 2026 page says 2.7% for every industry. Employers enter their own rate from the C-22 notice either way.
- ⚠️ No statewide paid sick leave (the Austin, Dallas and San Antonio ordinances were struck down or preempted).
- ⚠️ Texas franchise tax (an annual report, no tax due under the $2.47 million revenue threshold) isn't payroll and isn't calculated.
- ⚠️ Sales tax: TrailBook doesn't work out Texas sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: TWC, 2026 tax rates; Bloomberg Tax, "Texas Publishes 2026 Unemployment Insurance Tax Rates" ($9,000 wage base; 2.7% new-employer rate (rates run 0.32% to 6.32%; the employment and training assessment is included in the rate)); Texas Labor Code ch. 62 (Texas Minimum Wage Act) adopting the FLSA rate ($7.25 minimum wage; weekly overtime only); Texas Family Code 234.102 (new hires reported within 20 days).

### us-fl 2026.1, Florida (draft)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Florida reemployment tax (FL_RT, employer, FDOR) | 2.7% default; employer enters its own rate, on the first $7,000 | for Greg's review |
| Quarterly report | Employer's Quarterly Report (RT-6), filed and paid quarterly | for Greg's review |
| Minimum wage | $14, then $15 from 2026-09-30 | for Greg's review |
| Exempt salary floor (a year) | $35,568 | for Greg's review |
| Overtime | After 40 hours a week | for Greg's review |
| Paid sick leave | No state law | for Greg's review |
| New-hire report | Within 20 days to Florida New Hire Reporting Center | for Greg's review |

- ⚠️ Tipped employees ($11.98 cash wage from September 30, 2026) aren't modelled; TrailBook checks the full minimum wage.
- ⚠️ No statewide paid sick leave.
- ⚠️ Sales tax: TrailBook doesn't work out Florida sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Florida Department of Revenue, Reemployment Tax Rate Information ($7,000 wage base; 2.7% initial rate for the first 10 quarters; 2026 rates 0.1% to 5.4%); Florida Constitution art. X, §24 (Amendment 2, 2020) ($14.00 minimum wage, $15.00 from September 30, 2026; CPI-indexed from 2027); Florida Statutes 409.2576 (new hires reported within 20 days).

### us-nv 2026.1, Nevada (draft)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Nevada UI (NV_UI, employer, DETR) | 2.95% default; employer enters its own rate, on the first $43,700 | for Greg's review |
| Nevada Career Enhancement Program (NV_CEP, employer, DETR) | 0.05%, on the first $43,700 | for Greg's review |
| Quarterly report | Employer's Quarterly Contribution and Wage Report (NUCS-4072), filed and paid quarterly | for Greg's review |
| Minimum wage | $12 | for Greg's review |
| Exempt salary floor (a year) | $35,568 | for Greg's review |
| Overtime | After 40 hours a week; after 8 hours a day for pay under $18.00 an hour | for Greg's review |
| Paid sick leave | 1 hour per 52 worked, up to 40 hours; 0 hours for under 50 employees | for Greg's review |
| New-hire report | Within 20 days to Nevada New Hire Reporting (Division of Welfare and Supportive Services) | for Greg's review |

- ⚠️ Daily overtime applies only when the daily hours are entered (the "Daily hours" box on the pay run), and only to employees paid under $18.00 an hour; an employer and employee may agree to four 10-hour days, which TrailBook doesn't know about.
- ⚠️ Paid leave is counted at 1 hour per 52 worked (0.01923), up to 40 hours a year, for employers with 50 or more employees; smaller employers get no accrual. Check the 40-hour carryover cap reading.
- ⚠️ The Modified Business Tax (a quarterly Department of Taxation tax on wages over $50,000 a quarter, 1.17% for most businesses) isn't calculated.
- ⚠️ Sales tax: TrailBook doesn't work out Nevada sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: DETR, Contributions Newsletter June 2026; UI Information for Employers ($43,700 wage base; 2.95% new-employer rate; 0.05% Career Enhancement Program on the same base); NRS 608.250 as amended by AB 456 (2019); 2024 constitutional amendment ($12.00 minimum wage for all employers from July 1, 2024); NRS 608.018; NRS 608.0197 (daily overtime under 1.5 times the minimum wage; paid leave at 0.01923 hours per hour for 50+ employees).

### us-tn 2026.1, Tennessee (draft)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Tennessee UI (TN_UI, employer, TDLWD) | 2.7% default; employer enters its own rate, on the first $7,000 | for Greg's review |
| Quarterly report | Employer's Quarterly Premium and Wage Report (LB-0456), filed and paid quarterly | for Greg's review |
| Minimum wage | $7.25 | for Greg's review |
| Exempt salary floor (a year) | $35,568 | for Greg's review |
| Overtime | After 40 hours a week | for Greg's review |
| Paid sick leave | No state law | for Greg's review |
| New-hire report | Within 20 days to Tennessee New Hire Reporting | for Greg's review |

- ⚠️ Some new employers (certain industries) get a different starting rate; employers enter their own from the notice.
- ⚠️ Check the quarterly report's form number (LB-0456) against the current Jobs4TN filing screens.
- ⚠️ No statewide paid sick leave for private employers.
- ⚠️ Sales tax: TrailBook doesn't work out Tennessee sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: TDLWD, UI Tax Rates page; Bloomberg Tax, "Tennessee UI Tax Schedule Unchanged for Rest of 2026" ($7,000 wage base; 2.7% for most new employers; Premium Rate Table 6 for 2026); FLSA, 29 U.S.C. 206 (Tennessee has no state minimum wage) ($7.25 minimum wage; weekly overtime only).

### us-sd 2026.1, South Dakota (draft)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| South Dakota reemployment assistance (SD_UI, employer, DLR) | 1.2% default; employer enters its own rate, on the first $15,000 | for Greg's review |
| South Dakota investment fee (SD_FEE, employer, DLR) | 0.55% default; employer enters its own rate, on the first $15,000 | for Greg's review |
| Quarterly report | Quarterly Contribution, Investment Fee and Wage Report, filed and paid quarterly | for Greg's review |
| Minimum wage | $11.85 | for Greg's review |
| Exempt salary floor (a year) | $35,568 | for Greg's review |
| Overtime | After 40 hours a week | for Greg's review |
| Paid sick leave | No state law | for Greg's review |
| New-hire report | Within 20 days to South Dakota New Hire Reporting Center | for Greg's review |

- ⚠️ SB 26 (2026) lowers reemployment contribution rates; sources disagree on whether from July 1, 2026 or January 1, 2027. Employers enter their own rate from the DLR notice, so a rate change needs no pack change, but the new-employer default may.
- ⚠️ No statewide paid sick leave.
- ⚠️ Sales tax: TrailBook doesn't work out South Dakota sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: SD DLR employer handbook, as summarised by TimeTrex and Paylocity ($15,000 wage base; 1.2% new-employer rate plus 0.55% investment fee; 0.08% administrative fee once rated); SDCL 60-11-3 (CPI-indexed) ($11.85 minimum wage from January 1, 2026).

### us-wy 2026.1, Wyoming (draft)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Wyoming UI (WY_UI, employer, DWS) | 0% default; employer enters its own rate (required before a paycheck), on the first $33,800 | for Greg's review |
| Quarterly report | Unemployment Insurance Quarterly Summary and Wage Report, filed and paid quarterly | for Greg's review |
| Minimum wage | $7.25 | for Greg's review |
| Exempt salary floor (a year) | $35,568 | for Greg's review |
| Overtime | After 40 hours a week | for Greg's review |
| Paid sick leave | No state law | for Greg's review |
| New-hire report | Within 20 days to Wyoming New Hire Reporting Center | for Greg's review |

- ⚠️ No default rate: a pay run waits until the employer enters its rate, because new-employer rates range from about 2.3% to 9.8% by industry.
- ⚠️ Wyoming's state-run workers' compensation premiums are reported with the same quarterly filing but are not calculated by TrailBook yet.
- ⚠️ No statewide paid sick leave.
- ⚠️ Sales tax: TrailBook doesn't work out Wyoming sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Wyoming DWS 2026 taxable wage base; Experian, 2026 Unemployment Tax Outlook ($33,800 wage base; new-employer rates by industry); FLSA, 29 U.S.C. 206 (Wyoming's own $5.15 is below it) ($7.25 minimum wage; weekly overtime only).

### us-nh 2026.1, New Hampshire (draft)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| New Hampshire UI (NH_UI, employer, NHES) | 1.3% default; employer enters its own rate, on the first $14,000 | for Greg's review |
| New Hampshire administrative contribution (NH_ADMIN, employer, NHES) | 0.4% default; employer enters its own rate, on the first $14,000 | for Greg's review |
| Quarterly report | Employer Quarterly Tax and Wage Report, filed and paid quarterly | for Greg's review |
| Minimum wage | $7.25 | for Greg's review |
| Exempt salary floor (a year) | $35,568 | for Greg's review |
| Overtime | After 40 hours a week | for Greg's review |
| Paid sick leave | No state law | for Greg's review |
| New-hire report | Within 20 days to New Hampshire Employment Security (New Hire Reporting) | for Greg's review |

- ⚠️ NHES may change rates each quarter; Q3-Q4 2026 rates weren't published when this was written.
- ⚠️ New Hampshire taxes interest and dividends only until 2025 and has no wage tax; no sales tax either, so invoices there correctly carry none.
- ⚠️ No statewide paid sick leave.

Sources: NHES 2026 Q1-Q2 rate chart, as reproduced by TimeTrex and Paylocity; RSA 282-A:69 ($14,000 wage base; new employers 1.3% UI plus 0.4% administrative contribution); RSA 279:21 (adopts the federal minimum wage) ($7.25 minimum wage).

### us-ak 2026.1, Alaska (draft)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Alaska UI (employee) (AK_UI_EE, employee, AKDOL) | 0.5%, on the first $54,200 | for Greg's review |
| Alaska UI (AK_UI, employer, AKDOL) | 1% default; employer enters its own rate, on the first $54,200 | for Greg's review |
| Quarterly report | Employer's Quarterly Contribution Report (TQ01C), filed and paid quarterly | for Greg's review |
| Minimum wage | $13, then $14 from 2026-07-01 | for Greg's review |
| Exempt salary floor (a year) | $54,080, then $58,240 from 2026-07-01 | for Greg's review |
| Overtime | After 40 hours a week; after 8 hours a day | for Greg's review |
| Paid sick leave | 1 hour per 30 worked, up to 56 hours; 40 hours for under 15 employees | for Greg's review |
| New-hire report | Within 20 days to Alaska Child Support Services Division (New Hire Reporting) | for Greg's review |

- ⚠️ Daily overtime applies only to employers with 4 or more employees; TrailBook applies it to everyone, which only matters when daily hours are entered.
- ⚠️ Paid sick leave caps are read as both a use and an accrual cap; check the statute's carryover rule.
- ⚠️ The employee UI contribution has no box on the W-2; it's shown on pay stubs and the quarterly report.
- ⚠️ Alaska has no state sales tax (many boroughs and cities do); TrailBook doesn't work out local Alaska sales tax yet.

Sources: Alaska DOLWD, 2026 Unemployment Insurance Tax Rates; Research and Analysis memo, November 2025 ($54,200 wage base; employee rate 0.50%; employer rate 1.00% for new employers); Ballot Measure 1 (2024), AS 23.10.065 ($13.00 minimum wage, $14.00 from July 1, 2026, $15.00 from July 1, 2027; paid sick leave from July 1, 2025); AS 23.10.055, 23.10.060 (exempt salary twice the minimum wage for 40 hours; daily and weekly overtime).

### us-wa 2026.1, Washington (draft)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Washington Paid Leave (employee) (WA_PFML_EE, employee, ESD) | 0.8072%, on the first $184,500 | for Greg's review |
| WA Cares (WA_CARES, employee, ESD) | 0.58%, no wage base | for Greg's review |
| Washington UI (WA_UI, employer, ESD) | 0% default; employer enters its own rate (required before a paycheck), on the first $78,200 | for Greg's review |
| Washington Paid Leave (employer) (WA_PFML_ER, employer, ESD) | 0% default; employer enters its own rate, on the first $184,500 | for Greg's review |
| Quarterly report | Unemployment Insurance Quarterly Tax and Wage Report, filed and paid quarterly | for Greg's review |
| Quarterly report | Paid Family and Medical Leave and WA Cares Quarterly Report, filed and paid quarterly | for Greg's review |
| Minimum wage | $17.13 | for Greg's review |
| Exempt salary floor (a year) | $80,168.4 | for Greg's review |
| Overtime | After 40 hours a week | for Greg's review |
| Paid sick leave | 1 hour per 40 worked, no cap | for Greg's review |
| New-hire report | Within 20 days to Washington Division of Child Support (New Hire Reporting) | for Greg's review |

- ⚠️ Workers' compensation through L&I is charged per hour worked by risk class, partly withheld from employees, and reported quarterly. TrailBook doesn't calculate it yet; this is the main gap before releasing Washington.
- ⚠️ WA Cares exemptions (employees approved by ESD) aren't modelled: everyone pays the 0.58%.
- ⚠️ The year-end 40-hour sick leave carryover cap isn't applied; balances keep growing. Front-loading grants 40 hours.
- ⚠️ Seattle, SeaTac, Tukwila, Renton, Bellingham, Burien, Everett and King County have higher local minimum wages that TrailBook doesn't check yet.
- ⚠️ Sales tax: TrailBook doesn't work out Washington sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: ESD, "Paid Family & Medical Leave premium rate increases to 1.13% in 2026"; paidleave.wa.gov updates (1.13% total, employees 71.43% (0.8072%), employers 28.57% (0.3228%) for 50+ employees; up to the Social Security wage base ($184,500)); RCW 50B.04.080 (WA Cares) (0.58% employee premium on all wages); ESD 2026 taxable wage base (Bloomberg Tax) ($78,200 UI wage base; new employers by industry); L&I, 2026 minimum wage and exempt salary ($17.13 minimum wage; $80,168.40 exempt salary).

## Prepared payroll forms (`src/payroll/forms.ts`)

The forms are worksheets with each line's figure, for copying into the filing site. TrailBook doesn't file them.

| Form | What to check | Source | Check |
|---|---|---|---|
| 941 | Line numbers and labels 1-16; line 7 fractions of cents; Schedule B over $50,000 or semiweekly | 2026 Form 941 and instructions (Rev. Mar 2026) | ✅ line numbers match the IRS PDF. Lines 5b, 5f, 8, 9 and 11 (tips, sick-pay and credit adjustments) aren't used by TrailBook and are left out |
| 940 | Lines 1a-15a; line 4 exempt payments (section 125); line 9/10 not used; quarterly liability when over $500 | 2025 Form 940 and Schedule A (the 2026 form comes out in December) | ✅ accepted 2026-10-27 ⚠️ recheck: checked against the 2025 form; recheck against the 2026 form when published. Line 11 waits for California's 2026 credit reduction |
| DE 9 | Item letters C (total subject wages), D (UI, ETT, SDI wages, rates and contributions), E (UI and ETT), F (SDI), G, H (PIT withheld), I (deposits), J (balance due) | DE 9 form and instructions | ✅ accepted 2026-10-27 ⚠️ recheck: from memory of the form; the EDD and DIR sites are blocked here. Confirm each item letter against the current DE 9 |
| DE 9C | A1-A3 employee counts for the pay period including the 12th of each month; per employee SSN, name, total subject wages, PIT wages, PIT withheld | DE 9C form and instructions | ✅ accepted 2026-10-27 ⚠️ recheck: same as DE 9 |
| W-2 / W-3 | Boxes 1-6, 12 code D (401(k)), 14 CASDI, 15-17 with the 8-digit EDD account number; W-3 b and c | 2026 General Instructions for Forms W-2 and W-3 | ✅ matches. Box 12 DD (employer health coverage cost) isn't filled in; employers filing fewer than 250 W-2s are exempt |
| Due dates | 941 and DE 9: last day of the month after the quarter, moved to the next business day; 940 and W-2: Jan 31 (moved past weekends) | Pub 15 (2026); EDD | ✅ |

## Sales and use tax return worksheet (`src/core/sales-tax-return.ts`)

A worksheet for the business's own CDTFA-401, built on the sales tax report. TrailBook doesn't file or pay it.

| Item | What TrailBook does | Source | Check |
|---|---|---|---|
| Due dates | Last day of the month after the period (monthly, quarterly, yearly; fiscal year July to June), moved past weekends and California holidays | CDTFA filing due dates | ✅ accepted 2026-10-27 ⚠️ recheck: from working knowledge; ca.gov is blocked here. Confirm the weekend and holiday rule |
| Prepayments | Quarterly prepay accounts: due the 24th of the month after each of the first two months of the quarter; in Q2 the second covers May 1 to June 15 (due June 24). Each line shows the tax charged and the accepted shares: 90% of the month, or a third of the same quarter last year; Q2's second: 90% of May plus 90% of June 1-15, 135% of May, or half of last year's Q2 | CDTFA-367-SUT and 367-EFT (via search extracts) | ✅ accepted 2026-10-27 ⚠️ recheck: confirm against the current CDTFA forms; the sources disagree on the order of the Q2 options |
| Accrual basis | Sales count in the period of the invoice date. An invoice voided after its period ends stays in that period, with a warning to amend | Accrual is the CDTFA default; cash basis needs the CDTFA's approval | ✅ Greg chose accrual (2026-10-25) and approved 2026-10-27 |
| Line labels | Labeled by what the line is, not by line number, because the online return numbers its lines differently from the paper CDTFA-401 | CDTFA-401 | ✅ accepted 2026-10-27 ⚠️ recheck: match each to the 2027 online return. SB 122 direct-pay and multiple-points-of-use software go under "other deductions" with a description; confirm CDTFA doesn't add its own lines |
| State and district tax | State and local at 7.25% of taxable sales; district tax per place on Schedule A at the looked-up rate less 7.25% | CDTFA-401 Schedule A | ✅ accepted 2026-10-27 ⚠️ recheck: Schedule A asks for district codes; TrailBook shows the place name from the rate lookup |
| Excess tax collected | When invoices charged more than the return computes, a warning says to pay the extra | Rev. & Tax. Code §6901.5 | ✅ |
| No permit | An invoice charging tax with no seller's permit recorded shows a warning (it isn't stopped) | Rev. & Tax. Code §§6066, 6071 | ✅ |
| Reminders | An email to owners, admins and accountants up to 5 days before each return and prepayment due date, once per date, after the period ends | Follows the due dates above | ✅ added after Greg's approval 2026-10-27 |

## Chart of accounts tax lines (`src/rules/coa/us-service.ts`)

Tax-line codes for Schedule C, 1065, 1120S and 1120 are from working knowledge and need checking against the current forms and against each Intuit product's trial-balance import layout.

## Adding a state

Each state is one file in `src/rules` with a `StateRulePack`, added to the registry in `src/rules/index.ts` and to `LIVE` in `src/rules/jurisdictions.ts`. New packs start as `draft`: a business can be set up there and preview payroll, but saved pay runs are refused until Greg reviews the figures here and the pack is `released`. Each new state gets its own section in this file, and its agencies are added to the daily rule watch below.

## Monitoring

A scheduled task runs every morning. It checks the IRS, SSA, EDD, DIR, CDTFA, FTB and city minimum wage ordinances, and for the draft state packs: the Texas Workforce Commission, Florida Department of Revenue (reemployment tax), Nevada DETR and Labor Commissioner, Tennessee Department of Labor and Workforce Development, South Dakota Department of Labor and Regulation, Wyoming Department of Workforce Services, New Hampshire Employment Security, Alaska Department of Labor and Workforce Development, Washington ESD (UI, Paid Family and Medical Leave, WA Cares) and Labor and Industries (minimum wage, exempt salary), plus each state's new-hire reporting rules and minimum wage notices, for new or changed figures that these packs use (and new-year figures), and when something changes it opens a pull request that updates the pack, its sources and this checklist, and tells Greg. Rule changes are not merged without Greg's review, because they change paychecks and tax.
