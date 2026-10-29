# Rule pack review checklist (2026 packs)

Before a pack's `status` changes from `draft` to `released`, each item below needs Greg's sign-off. Every figure was checked against current sources on 2026-10-25; the **Check** column says how.

**Sign-off, 2026-10-27.** Greg reviewed this list and approved every item as it stands. The us-federal 2026.1, us-ca 2026.1 and us-ca-sales-tax 2026.1 packs are now `released`, and saved pay runs calculate only on released packs. Items marked ⚠️ were accepted on the figures shown; each note says what to recheck when the primary source can be read, and the daily rule watch keeps looking for them. The us-ca-sales-tax 2027.1 pack stays `draft` on the review's own recommendation, until OAL approves CDTFA's emergency regulations. A daily scheduled check watches the sources for changes (see "Monitoring" at the end).

**Sign-off, 2026-10-29.** Greg approved every new state pack (Texas, Florida, Nevada, Tennessee, South Dakota, Wyoming, New Hampshire, Alaska, Washington, Arizona, Oregon and New York) as it stands, ⚠️ items included. Those packs are now `released`, so saved pay runs can use them. The known gaps listed in each section remain open, and the daily rule watch keeps checking them.

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

## States without a wage income tax (`src/rules/us-states-2026.ts`), released 2026-10-29

Added 2026-10-29 at Greg's choice of order (these nine first, then Oregon, Arizona and New York). Greg approved every pack on 2026-10-29 and they are `released`. Figures were gathered on 2026-10-28; most state sites can't be opened from TrailBook's build machines, so several come from payroll publishers and each ⚠️ says what to read off the agency's own notice. UI rates are per employer: the pack holds the new-employer rate, and the employer enters its own rate from its notice. Workers' compensation (state-run in Washington and Wyoming) and local minimum wages outside California aren't covered yet. Sales tax in these states isn't worked out: invoices carry no tax unless an owner or accountant sets the rate by hand.

### us-tx 2026.1, Texas

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Texas UI (TX_UI, employer, TWC) | 2.7% default; employer enters its own rate, on the first $9,000 | ✅ |
| Quarterly report | Employer's Quarterly Report (C-3), filed and paid quarterly | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Texas Office of the Attorney General (Employer New Hire Reporting) | ✅ |

- ⚠️ Some sources say a new employer's rate is the greater of 2.7% or its industry average; TWC's 2026 page says 2.7% for every industry. Employers enter their own rate from the C-22 notice either way.
- ⚠️ No statewide paid sick leave (the Austin, Dallas and San Antonio ordinances were struck down or preempted).
- ⚠️ Texas franchise tax (an annual report, no tax due under the $2.47 million revenue threshold) isn't payroll and isn't calculated.
- ⚠️ Sales tax: TrailBook doesn't work out Texas sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: TWC, 2026 tax rates; Bloomberg Tax, "Texas Publishes 2026 Unemployment Insurance Tax Rates" ($9,000 wage base; 2.7% new-employer rate (rates run 0.32% to 6.32%; the employment and training assessment is included in the rate)); Texas Labor Code ch. 62 (Texas Minimum Wage Act) adopting the FLSA rate ($7.25 minimum wage; weekly overtime only); Texas Family Code 234.102 (new hires reported within 20 days).

### us-fl 2026.1, Florida

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Florida reemployment tax (FL_RT, employer, FDOR) | 2.7% default; employer enters its own rate, on the first $7,000 | ✅ |
| Quarterly report | Employer's Quarterly Report (RT-6), filed and paid quarterly | ✅ |
| Minimum wage | $14, then $15 from 2026-09-30 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Florida New Hire Reporting Center | ✅ |

- ⚠️ Tipped employees ($11.98 cash wage from September 30, 2026) aren't modelled; TrailBook checks the full minimum wage.
- ⚠️ No statewide paid sick leave.
- ⚠️ Sales tax: TrailBook doesn't work out Florida sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Florida Department of Revenue, Reemployment Tax Rate Information ($7,000 wage base; 2.7% initial rate for the first 10 quarters; 2026 rates 0.1% to 5.4%); Florida Constitution art. X, §24 (Amendment 2, 2020) ($14.00 minimum wage, $15.00 from September 30, 2026; CPI-indexed from 2027); Florida Statutes 409.2576 (new hires reported within 20 days).

### us-nv 2026.1, Nevada

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Nevada UI (NV_UI, employer, DETR) | 2.95% default; employer enters its own rate, on the first $43,700 | ✅ |
| Nevada Career Enhancement Program (NV_CEP, employer, DETR) | 0.05%, on the first $43,700 | ✅ |
| Quarterly report | Employer's Quarterly Contribution and Wage Report (NUCS-4072), filed and paid quarterly | ✅ |
| Minimum wage | $12 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week; after 8 hours a day for pay under $18.00 an hour | ✅ |
| Paid sick leave | 1 hour per 52 worked, up to 40 hours; 0 hours for under 50 employees | ✅ |
| New-hire report | Within 20 days to Nevada New Hire Reporting (Division of Welfare and Supportive Services) | ✅ |

- ⚠️ Daily overtime applies only when the daily hours are entered (the "Daily hours" box on the pay run), and only to employees paid under $18.00 an hour; an employer and employee may agree to four 10-hour days, which TrailBook doesn't know about.
- ⚠️ Paid leave is counted at 1 hour per 52 worked (0.01923), up to 40 hours a year, for employers with 50 or more employees; smaller employers get no accrual. Check the 40-hour carryover cap reading.
- ⚠️ The Modified Business Tax (a quarterly Department of Taxation tax on wages over $50,000 a quarter, 1.17% for most businesses) isn't calculated.
- ⚠️ Sales tax: TrailBook doesn't work out Nevada sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: DETR, Contributions Newsletter June 2026; UI Information for Employers ($43,700 wage base; 2.95% new-employer rate; 0.05% Career Enhancement Program on the same base); NRS 608.250 as amended by AB 456 (2019); 2024 constitutional amendment ($12.00 minimum wage for all employers from July 1, 2024); NRS 608.018; NRS 608.0197 (daily overtime under 1.5 times the minimum wage; paid leave at 0.01923 hours per hour for 50+ employees).

### us-tn 2026.1, Tennessee

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Tennessee UI (TN_UI, employer, TDLWD) | 2.7% default; employer enters its own rate, on the first $7,000 | ✅ |
| Quarterly report | Employer's Quarterly Premium and Wage Report (LB-0456), filed and paid quarterly | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Tennessee New Hire Reporting | ✅ |

- ⚠️ Some new employers (certain industries) get a different starting rate; employers enter their own from the notice.
- ⚠️ Check the quarterly report's form number (LB-0456) against the current Jobs4TN filing screens.
- ⚠️ No statewide paid sick leave for private employers.
- ⚠️ Sales tax: TrailBook doesn't work out Tennessee sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: TDLWD, UI Tax Rates page; Bloomberg Tax, "Tennessee UI Tax Schedule Unchanged for Rest of 2026" ($7,000 wage base; 2.7% for most new employers; Premium Rate Table 6 for 2026); FLSA, 29 U.S.C. 206 (Tennessee has no state minimum wage) ($7.25 minimum wage; weekly overtime only).

### us-sd 2026.1, South Dakota

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| South Dakota reemployment assistance (SD_UI, employer, DLR) | 1.2% default; employer enters its own rate, on the first $15,000 | ✅ |
| South Dakota investment fee (SD_FEE, employer, DLR) | 0.55% default; employer enters its own rate, on the first $15,000 | ✅ |
| Quarterly report | Quarterly Contribution, Investment Fee and Wage Report, filed and paid quarterly | ✅ |
| Minimum wage | $11.85 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to South Dakota New Hire Reporting Center | ✅ |

- ⚠️ SB 26 (2026) lowers reemployment contribution rates; sources disagree on whether from July 1, 2026 or January 1, 2027. Employers enter their own rate from the DLR notice, so a rate change needs no pack change, but the new-employer default may.
- ⚠️ No statewide paid sick leave.
- ⚠️ Sales tax: TrailBook doesn't work out South Dakota sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: SD DLR employer handbook, as summarised by TimeTrex and Paylocity ($15,000 wage base; 1.2% new-employer rate plus 0.55% investment fee; 0.08% administrative fee once rated); SDCL 60-11-3 (CPI-indexed) ($11.85 minimum wage from January 1, 2026).

### us-wy 2026.1, Wyoming

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Wyoming UI (WY_UI, employer, DWS) | 0% default; employer enters its own rate (required before a paycheck), on the first $33,800 | ✅ |
| Quarterly report | Unemployment Insurance Quarterly Summary and Wage Report, filed and paid quarterly | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Wyoming New Hire Reporting Center | ✅ |

- ⚠️ No default rate: a pay run waits until the employer enters its rate, because new-employer rates range from about 2.3% to 9.8% by industry.
- ⚠️ Wyoming's state-run workers' compensation premiums are reported with the same quarterly filing but are not calculated by TrailBook yet.
- ⚠️ No statewide paid sick leave.
- ⚠️ Sales tax: TrailBook doesn't work out Wyoming sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Wyoming DWS 2026 taxable wage base; Experian, 2026 Unemployment Tax Outlook ($33,800 wage base; new-employer rates by industry); FLSA, 29 U.S.C. 206 (Wyoming's own $5.15 is below it) ($7.25 minimum wage; weekly overtime only).

### us-nh 2026.1, New Hampshire

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| New Hampshire UI (NH_UI, employer, NHES) | 1.3% default; employer enters its own rate, on the first $14,000 | ✅ |
| New Hampshire administrative contribution (NH_ADMIN, employer, NHES) | 0.4% default; employer enters its own rate, on the first $14,000 | ✅ |
| Quarterly report | Employer Quarterly Tax and Wage Report, filed and paid quarterly | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to New Hampshire Employment Security (New Hire Reporting) | ✅ |

- ⚠️ NHES may change rates each quarter; Q3-Q4 2026 rates weren't published when this was written.
- ⚠️ New Hampshire taxes interest and dividends only until 2025 and has no wage tax; no sales tax either, so invoices there correctly carry none.
- ⚠️ No statewide paid sick leave.

Sources: NHES 2026 Q1-Q2 rate chart, as reproduced by TimeTrex and Paylocity; RSA 282-A:69 ($14,000 wage base; new employers 1.3% UI plus 0.4% administrative contribution); RSA 279:21 (adopts the federal minimum wage) ($7.25 minimum wage).

### us-ak 2026.1, Alaska

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Alaska UI (employee) (AK_UI_EE, employee, AKDOL) | 0.5%, on the first $54,200 | ✅ |
| Alaska UI (AK_UI, employer, AKDOL) | 1% default; employer enters its own rate, on the first $54,200 | ✅ |
| Quarterly report | Employer's Quarterly Contribution Report (TQ01C), filed and paid quarterly | ✅ |
| Minimum wage | $13, then $14 from 2026-07-01 | ✅ |
| Exempt salary floor (a year) | $54,080, then $58,240 from 2026-07-01 | ✅ |
| Overtime | After 40 hours a week; after 8 hours a day | ✅ |
| Paid sick leave | 1 hour per 30 worked, up to 56 hours; 40 hours for under 15 employees | ✅ |
| New-hire report | Within 20 days to Alaska Child Support Services Division (New Hire Reporting) | ✅ |

- ⚠️ Daily overtime applies only to employers with 4 or more employees; TrailBook applies it to everyone, which only matters when daily hours are entered.
- ⚠️ Paid sick leave caps are read as both a use and an accrual cap; check the statute's carryover rule.
- ⚠️ The employee UI contribution has no box on the W-2; it's shown on pay stubs and the quarterly report.
- ⚠️ Alaska has no state sales tax (many boroughs and cities do); TrailBook doesn't work out local Alaska sales tax yet.

Sources: Alaska DOLWD, 2026 Unemployment Insurance Tax Rates; Research and Analysis memo, November 2025 ($54,200 wage base; employee rate 0.50%; employer rate 1.00% for new employers); Ballot Measure 1 (2024), AS 23.10.065 ($13.00 minimum wage, $14.00 from July 1, 2026, $15.00 from July 1, 2027; paid sick leave from July 1, 2025); AS 23.10.055, 23.10.060 (exempt salary twice the minimum wage for 40 hours; daily and weekly overtime).

### us-wa 2026.1, Washington

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | None | ✅ |
| Washington Paid Leave (employee) (WA_PFML_EE, employee, ESD) | 0.8072%, on the first $184,500 | ✅ |
| WA Cares (WA_CARES, employee, ESD) | 0.58%, no wage base | ✅ |
| Washington UI (WA_UI, employer, ESD) | 0% default; employer enters its own rate (required before a paycheck), on the first $78,200 | ✅ |
| Washington Paid Leave (employer) (WA_PFML_ER, employer, ESD) | 0% default; employer enters its own rate, on the first $184,500 | ✅ |
| Quarterly report | Unemployment Insurance Quarterly Tax and Wage Report, filed and paid quarterly | ✅ |
| Quarterly report | Paid Family and Medical Leave and WA Cares Quarterly Report, filed and paid quarterly | ✅ |
| Minimum wage | $17.13 | ✅ |
| Exempt salary floor (a year) | $80,168.4 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | 1 hour per 40 worked, no cap | ✅ |
| New-hire report | Within 20 days to Washington Division of Child Support (New Hire Reporting) | ✅ |

- ⚠️ Workers' compensation through L&I is charged per hour worked by risk class, partly withheld from employees, and reported quarterly. TrailBook doesn't calculate it yet; this is the main gap before releasing Washington.
- ⚠️ WA Cares exemptions (employees approved by ESD) aren't modelled: everyone pays the 0.58%.
- ⚠️ The year-end 40-hour sick leave carryover cap isn't applied; balances keep growing. Front-loading grants 40 hours.
- ⚠️ Seattle, SeaTac, Tukwila, Renton, Bellingham, Burien, Everett and King County have higher local minimum wages that TrailBook doesn't check yet.
- ⚠️ Sales tax: TrailBook doesn't work out Washington sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: ESD, "Paid Family & Medical Leave premium rate increases to 1.13% in 2026"; paidleave.wa.gov updates (1.13% total, employees 71.43% (0.8072%), employers 28.57% (0.3228%) for 50+ employees; up to the Social Security wage base ($184,500)); RCW 50B.04.080 (WA Cares) (0.58% employee premium on all wages); ESD 2026 taxable wage base (Bloomberg Tax) ($78,200 UI wage base; new employers by industry); L&I, 2026 minimum wage and exempt salary ($17.13 minimum wage; $80,168.40 exempt salary).

## us-az 2026.1 (`src/rules/us-az-2026.ts`), released 2026-10-29

Added 2026-10-29. Arizona withholding is the flat percentage the employee elects on Form A-4, so no tables are needed. Oregon and New York were added the same day, below.

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | Employee elects 0.5%, 1%, 1.5%, 2%, 2.5%, 3%, 3.5% on Form A-4; 2% without one; 0% may be elected (ADOR) | ✅ |
| Withholding deposits | On the federal schedule if last year's quarterly average was over $1,500; otherwise with the A1-QRT | ✅ |
| Arizona UI (AZ_UI, employer, DES) | 2% default; employer enters its own rate, on the first $8,000 | ✅ |
| Arizona job training tax (AZ_JTT, employer, DES) | 0% default; employer enters its own rate, on the first $8,000 | ✅ |
| Quarterly report | Arizona Quarterly Withholding Tax Return (A1-QRT), filed and paid quarterly | ✅ |
| Quarterly report | Unemployment Tax and Wage Report (UC-018), filed and paid quarterly | ✅ |
| Minimum wage | $15.15 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | 1 hour per 30 worked, up to 40 hours; 24 hours for under 15 employees | ✅ |
| New-hire report | Within 20 days to Arizona New Hire Reporting Center | ✅ |

- ⚠️ A new employee who files no A-4 is withheld at 2.0%. An employee may elect 0% only if they expect no Arizona tax for the year; TrailBook takes that election as given.
- ⚠️ UI and job training tax rates are per employer: enter them from the DES rate notice. New employers pay 2.0% UI and no job training tax.
- ⚠️ Deposits: if last year's average quarterly Arizona withholding was over $1,500, deposits are due on the federal schedule; otherwise with the A1-QRT. Check ADOR's current threshold.
- ⚠️ Flagstaff ($18.35) and Tucson ($15.45) have higher local minimum wages that TrailBook doesn't check yet.
- ⚠️ Tipped employees ($12.15 cash wage) aren't modelled; TrailBook checks the full minimum wage.
- ⚠️ Paid sick time caps are read as both a use and an accrual cap (A.R.S. 23-372 allows carrying over up to 40 hours, or 24 for small employers).
- ⚠️ The A1-R annual reconciliation and W-2 state copies are prepared from the W-2 data; the A1-R itself isn't produced yet.
- ⚠️ Sales tax: Arizona's transaction privilege tax isn't worked out yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Bloomberg Law, "Arizona's 2026 Withholding Rates Unchanged From 2025"; A.R.S. 43-401 (A-4 choices 0.5% to 3.5% in half-point steps; 2.0% when no A-4 is filed; 0% may be elected when no Arizona tax is expected); Arizona DES 2026 UI rates, as summarised by Avionté and FirstHR ($8,000 wage base; 2.0% new-employer rate; 0.04% to 9.72% range); A.R.S. 23-769 (job training tax) (0.1% on the UI wage base for rated employers; not charged to new employers or those with a negative balance); A.R.S. 23-363 (Proposition 206, CPI-indexed); Industrial Commission of Arizona ($15.15 minimum wage from January 1, 2026); A.R.S. 23-371 to 23-381 (Fair Wages and Healthy Families Act) (earned paid sick time: 1 hour per 30 worked; 40 hours a year for 15+ employees, 24 for fewer); A.R.S. 43-403, 43-413; ADOR Form A1-QRT and A1-R instructions (quarterly withholding return; deposit timing follows the federal schedule when last year's quarterly average was over $1,500).

## us-or 2026.1 and us-ny 2026.1 (`src/rules/us-or-2026.ts`, `src/rules/us-ny-2026.ts`), released 2026-10-29

Added 2026-10-29. Withholding for both states was read from the agencies' own 2026 publications (Oregon 150-206-436 Rev. 12-31-25; NYS-50-T-NYS (1/26)); tests check TrailBook against the publications' worked examples. Both states have minimum wage areas: each employee's work area is picked on the employee form.

### Oregon

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | Annual formula from 150-206-436: standard deduction $2,910 single / $5,820 married, federal tax subtraction up to $8,750 phasing out from $125,000 single / $250,000 married, $263 credit per allowance (none above $100,000 / $200,000), 8% without an OR-W-4 | ✅ |
| Oregon withholding and statewide transit tax deposits | On your federal deposit dates | ✅ |
| Oregon statewide transit tax (OR_STT, employee, DOR) | 0.1%, no wage base | ✅ |
| Paid Leave Oregon (employee) (OR_PFML_EE, employee, OED) | 0.6%, on the first $184,500 | ✅ |
| Workers' Benefit Fund (employee) (OR_WBF_EE, employee, DCBS) | 0.90 cents per hour worked, no wage base | ✅ |
| Oregon UI (OR_UI, employer, OED) | 2.4% default; employer enters its own rate, on the first $56,700 | ✅ |
| Workers' Benefit Fund (employer) (OR_WBF_ER, employer, DCBS) | 0.90 cents per hour worked, no wage base | ✅ |
| Paid Leave Oregon (employer) (OR_PFML_ER, employer, OED) | 0% default; employer enters its own rate, on the first $184,500 | ✅ |
| TriMet or Lane transit tax (OR_TRANSIT, employer, DOR) | 0% default; employer enters its own rate, no wage base | ✅ |
| Quarterly report | Oregon Quarterly Tax Report (Form OQ), filed and paid quarterly | ✅ |
| Quarterly report | Paid Leave Oregon Quarterly Contribution Report, filed and paid quarterly | ✅ |
| Minimum wage | $15.05, then $15.55 from 2026-07-01 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Minimum wage, Portland metro | $16.30, then $16.80 from 2026-07-01 | ✅ |
| Minimum wage, Nonurban counties | $14.05, then $14.55 from 2026-07-01 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | 1 hour per 30 worked, up to 80 hours | ✅ |
| New-hire report | Within 20 days to Oregon Department of Justice, Division of Child Support (New Hire Reporting) | ✅ |

- ⚠️ Withholding uses the annual formula divided by the pay periods, exactly as the publication describes; amounts aren't rounded to whole dollars (allowed, not required).
- ⚠️ An employee with no OR-W-4 on file is withheld at a flat 8% (HB 2119), with a warning on the paycheck.
- ⚠️ Single with 3 or more allowances uses the married table and deduction but the single phase-out and $100,000 allowance limit, per the publication's FAQ 7.
- ⚠️ Oregon withholding and the statewide transit tax are deposited on your federal deposit dates; UI and the Workers' Benefit Fund are paid with the quarterly Form OQ.
- ⚠️ The Workers' Benefit Fund is charged on hours worked; salaried employees count as 40 hours a week.
- ⚠️ TriMet and Lane Transit District payroll taxes apply only to work inside those districts; enter your rate (TriMet 0.8237%, Lane 0.80% in 2026 per payroll publishers) in payroll settings if they apply.
- ⚠️ Paid Leave Oregon's employer share is only for employers with 25 or more employees; enter 0.4% in payroll settings if that's you.
- ⚠️ Minimum wage depends on where the employee works: Portland metro (inside the urban growth boundary), standard, or nonurban counties. Choose the area on each employee.
- ⚠️ Sick time: up to 40 hours may be used a year, and balances may be capped at 80 hours (ORS 653.606); TrailBook caps accrual at 80.
- ⚠️ Employers with fewer than 10 employees (6 in Portland) must give sick time but needn't pay it; TrailBook tracks it the same way.
- ⚠️ Sales tax: Oregon has none. Corporate Activity Tax isn't payroll and isn't calculated.

Sources: Oregon DOR, Withholding Tax Formulas, 150-206-436 (Rev. 12-31-25), effective January 1, 2026 (brackets, $2,910/$5,820 standard deductions, $263 exemption credit, $8,750 federal tax subtraction and its phase-out, allowance limits, 8% without a certificate, deposits on the federal schedule); Oregon Employment Department, 2026 tax rates (press release 2025-11-18) ($56,700 UI wage base; tax schedule 3; 2.4% new-employer rate); Oregon DOR, Statewide Transit Tax page (Measure 120 failed May 19, 2026) (0.1% employee statewide transit tax); Paid Leave Oregon, 2026 contribution rate (1% up to $184,500: employees 0.6%, employers with 25+ employees 0.4%); DCBS, Workers' Benefit Fund page (1.8 cents per hour worked in 2026, half from the employee); BOLI, 2026 minimum wage announcement (April 23, 2026) ($15.05 / $16.30 / $14.05 to June 30, 2026; $15.55 / $16.80 / $14.55 from July 1, 2026); ORS 653.601 to 653.661 (sick time) (1 hour per 30 worked, up to 40 hours a year; paid for employers with 10+ employees (6+ with a Portland location)).

### New York

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | Method II exact calculation tables II-A to II-D for each pay frequency, Method III top rates (10.45%, 11.1%, 11.7%) from $1,077,550 single / $2,155,350 married net; no IT-2104 means single, 0 allowances | ✅ |
| Withholding deposits | Within 3 business days once $700 or more is owed; otherwise with the NY-45 | ✅ |
| NY disability (DBL) (NY_SDI, employee, Carrier) | 0.5%, no wage base, at most $0.60 a week (goes to your insurance carrier) | ✅ |
| NY Paid Family Leave (NY_PFL, employee, Carrier) | 0.432%, on the first $95,349.54 (goes to your insurance carrier) | ✅ |
| New York UI (NY_UI, employer, DOL) | 4.1% default; employer enters its own rate, on the first $17,600 | ✅ |
| Quarterly report | Quarterly Combined Withholding, Wage Reporting, and Unemployment Insurance Return (NY-45), filed and paid quarterly | ✅ |
| Minimum wage | $16.00 | ✅ |
| Exempt salary floor (a year) | $62,353.20 | ✅ |
| Minimum wage, New York City, Long Island and Westchester | $17.00; exempt salary $66,300 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | 1 hour per 30 worked, up to 56 hours; 40 hours for under 100 employees | ✅ |
| New-hire report | Within 20 days to New York State Department of Taxation and Finance (New Hire Notification) | ✅ |

- ⚠️ No IT-2104 on file: withheld as single with no allowances. Married withholding at the higher single rate, and head of household, use the single tables.
- ⚠️ Withholding over $700 not yet paid is due within 3 business days of the payday; the rest is paid with the NY-45. Check whether your business must use the 5-business-day rule instead.
- ⚠️ Disability (DBL) and Paid Family Leave contributions are withheld from employees and go toward your insurance carrier's premium; TrailBook holds them in a liability account and doesn't schedule a state payment.
- ⚠️ Paid Family Leave is capped by its annual maximum ($411.91), shown as a wage base of $95,349.54.
- ⚠️ The Metropolitan Commuter Transportation Mobility Tax (employers in the MCTD with more than $312,500 of payroll a quarter) isn't calculated.
- ⚠️ Minimum wage and the executive/administrative exempt salary depend on where the employee works: choose New York City, Long Island and Westchester on the employee, or leave the rest of the state.
- ⚠️ Prenatal leave (20 hours a year) and the spread-of-hours and call-in pay rules aren't tracked.
- ⚠️ Sales tax: TrailBook doesn't work out New York sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

#### us-ny 2026.2: New York City and Yonkers (added 2026-10-29, awaiting Greg's review; merging the pull request releases it)

2026.2 replaces 2026.1 with everything above unchanged, plus city income tax. It's withheld only for employees whose record has the box ticked (the employee form shows "Lives in New York City", "Lives in Yonkers", and "Works in Yonkers, lives elsewhere" under the IT-2104 fields).

| Item | Figure | Status |
|---|---|---|
| New York City resident tax (NYC_WH) | NYS-50-T-NYC exact calculation: Table B deduction (weekly $96.15 single / $105.75 married; biweekly $192.30 / $211.50; semimonthly $208.35 / $229.15; monthly $416.70 / $458.30), Table C exemption ($19.25 / $38.50 / $41.65 / $83.30 each), then 2.05% to 4.25% in six brackets, one table for single and married | ⚠️ check |
| Yonkers resident tax (YON_WH) | 16.75% of the New York State amount (Method II), before any extra withholding | ⚠️ check |
| Yonkers nonresident earnings tax (YON_NR) | 0.5% of wages less the Method VII exclusion (weekly: under $77 nothing; $58 from $77, $38 from $192, $19 from $385, none from $577; other frequencies in the pack) | ⚠️ check |
| Paid and reported | With New York State withholding on the NYS-1 and NY-45; same liability account (2340) | ⚠️ check |
| W-2 | Boxes 18 to 20: local wages, local tax, NYC or YONKERS | ⚠️ check |

- ⚠️ Tested against the publication's own examples: NYC single weekly $400 with 3 exemptions is $6.11, monthly $50,000 with 3 is $2,070.50, married monthly $50,000 with 3 is $2,068.73 (all six NYC examples match).
- ⚠️ TrailBook doesn't guess city tax from an address: the owner or accountant ticks it from the employee's IT-2104 (and IT-2104.1 for nonresidents).
- ⚠️ NYC uses the state allowance count (IT-2104 line 1); a different NYC count on line 2 isn't kept separately yet. Extra NYC and Yonkers withholding (lines 4 and 5) isn't split out either; the one extra amount goes to state withholding.

Sources (2026.2): NYS-50-T-NYC (1/26), New York City Withholding Tax Tables and Methods (exact calculation method); NYS-50-T-Y (1/26), Yonkers Withholding Tax Tables and Methods (resident 16.75% of the state amount; nonresident Method VII). Both read from the publications on 2026-10-29.

Sources: NYS-50-T-NYS (1/26), New York State Withholding Tax Tables and Methods, pages 14 to 22 (tables A to C (deduction and exemption allowances), Method II tables II-A to II-D, Method III top rates); NYS-50 (Employer's Guide); Tax Law 674 (withholding paid within 3 business days once $700 or more is withheld; otherwise with the NY-45; no IT-2104 means single with no allowances); NYS DOL, Current 2026 Employer Contribution Rate ($17,600 UI wage base; new employers 4.1% (4.025% UI plus 0.075% Re-employment Service Fund)); DFS, 2026 Paid Family Leave rate decision; paidfamilyleave.ny.gov/2026 (0.432% of wages, at most $411.91 a year); Workers' Compensation Law 209 (disability (DBL) employee contribution 0.5% of wages, at most $0.60 a week); Labor Law 652; 12 NYCRR 142 (Proskauer and Seyfarth summaries) ($17.00 minimum wage in NYC, Long Island and Westchester, $16.00 elsewhere; exempt salary $1,275 / $1,199.10 a week); Labor Law 196-b (paid sick leave) (1 hour per 30 worked; 56 hours for 100+ employees, 40 for fewer).

## Second round of states: us-il, us-co, us-nc, us-ga, us-ut, us-id 2026.1 (draft, added 2026-10-29, awaiting Greg's review)

Chosen by market size and nearness to the states already live. All six use the new `annual_formula` withholding method (the year's wages less a standard deduction or allowances, through the rates, less any credit, divided by the pay periods) and the new `monthly_or_larger` deposit rule. A business can be set up in these states and keep its books there; pay runs (previews included) wait until these packs are released.

Where a state changed its rate part-way through 2026 (Georgia from May 11, Utah from June 1, Idaho from July 31), the pack has only the current figures, because a business starting now pays under them. Tested against each publication's own example where it gives one: Illinois $800 a week with 2 + 2 allowances is $32.13, North Carolina single $450 a week with 2 allowances is $4, Georgia married (one income) $2,000 semimonthly with one dependent is $27.03.

### Illinois (us-il 2026.1, `src/rules/us-il-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 4.95% of wages less $2,925 for each IL-W-4 line 1 allowance and $1,000 for each line 2 allowance, worked out for the year and divided by the pay periods; no IL-W-4 means no allowances | ⚠️ check |
| Withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $12,000; IL-941 | ⚠️ check |
| Illinois UI (IL_UI, employer, IDES) | 3.35% default; employer enters its own rate, on the first $14,250 | ⚠️ check |
| Quarterly report | Illinois Withholding Income Tax Return (IL-941) | ⚠️ check |
| Quarterly report | Employer's Contribution and Wage Report (UI-3/40) | ⚠️ check |
| Minimum wage | $15.00 | ⚠️ check |
| Minimum wage, Chicago | $16.60; $17.05 from 2026-07-01 | ⚠️ check |
| Minimum wage, Cook County, outside Chicago | $15.00; $15.40 from 2026-07-01 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | 1 hour per 40 worked, up to 40 hours a year | ⚠️ check |
| New-hire report | Within 20 days to Illinois Department of Employment Security (New Hire Directory) | ⚠️ check |

- ⚠️ No IL-W-4 on file: no allowances (4.95% of all wages). IL-W-4 line 1 is the basic allowance count, line 2 the additional allowances for age 65 or blindness.
- ⚠️ The payroll period formula is computed for the year and divided by the pay periods; amounts can differ from the wage-bracket tables by a few cents.
- ⚠️ Withholding is paid monthly by the 15th of the next month, or semi-weekly on the federal dates once more than $12,000 was withheld in the look-back period. TrailBook uses last calendar year's withholding to decide; IDOR's notice of your payment schedule controls.
- ⚠️ UI rates are per employer: enter yours from the IDES rate notice. New employers pay 3.35% (3.45% in NAICS sector 56).
- ⚠️ Minimum wage depends on where the employee works: Chicago and the rest of Cook County have higher rates. Other local rates (Evanston, Oak Park and so on) aren't checked yet.
- ⚠️ Chicago's own paid leave and paid sick leave ordinance (40 hours each) replaces the state law there; TrailBook tracks the state's 40 hours.
- ⚠️ Paid leave carries over under the state law but use can be capped at 40 hours a year; TrailBook sets no balance cap.
- ⚠️ Sales tax: TrailBook doesn't work out Illinois sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: IDOR Booklet IL-700-T (R-12/25), Illinois Withholding Tax Tables, effective January 1, 2026, page 3 (4.95% rate; $2,925 per line 1 allowance and $1,000 per line 2 allowance; automated payroll method and its $32.13 example); IDOR, Form IL-941 instructions (tax.illinois.gov) (monthly payments for $12,000 or less withheld in the look-back period (July to June); semi-weekly above it; IL-941 filed quarterly); IDES 2026 contribution rates, as reported by Bloomberg Tax ($14,250 wage base; 3.35% new-employer rate including the 0.55% fund-building surtax (3.45% for NAICS sector 56)); 820 ILCS 105/4 (Minimum Wage Law); Chicago and Cook County minimum wage notices (July 1, 2026, as reported by ABC7 Chicago) ($15.00 statewide; Chicago $16.60 to June 30 and $17.05 from July 1, 2026; Cook County $15.00 then $15.40); 820 ILCS 192 (Paid Leave for All Workers Act) (1 hour of paid leave per 40 worked, up to 40 hours a year); 820 ILCS 405/1801.1 (new hire reporting) (report new hires to IDES within 20 days).

### Colorado (us-co 2026.1, `src/rules/us-co-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 4.4% of the year's wages less the DR 0004 line 2 allowance, or without one $11,000 (married filing jointly on the W-4) or $5,500; DR 0004 line 3 extra | ⚠️ check |
| Withholding deposits | Monthly by the 15th of the next month; weekly (third business day after the payroll week's Friday) when last year's withholding was over $50,000; DR 1094 | ⚠️ check |
| Colorado FAMLI (employee) (CO_FAMLI_EE, employee, FAMLI) | 0.44%, on the first $184,500 | ⚠️ check |
| Colorado UI (CO_UI, employer, CDLE) | 3.05% default; employer enters its own rate, on the first $30,600 | ⚠️ check |
| Colorado FAMLI (employer) (CO_FAMLI_ER, employer, FAMLI) | 0% default; employer enters its own rate, on the first $184,500 | ⚠️ check |
| Quarterly report | Colorado Wage Withholding Tax Return (DR 1094) | ⚠️ check |
| Quarterly report | Colorado UI Premium and Wage Report (UITR-1) | ⚠️ check |
| Quarterly report | Colorado FAMLI Quarterly Wage Report | ⚠️ check |
| Minimum wage | $15.16 | ⚠️ check |
| Minimum wage, Denver | $19.29 | ⚠️ check |
| Minimum wage, Edgewater | $18.17 | ⚠️ check |
| Minimum wage, City of Boulder or unincorporated Boulder County | $16.82 | ⚠️ check |
| Exempt salary floor (a year) | $57,784 | ⚠️ check |
| Overtime | After 40 hours a week or 12 hours a day | ⚠️ check |
| Paid sick leave | 1 hour per 30 worked, up to 48 hours a year | ⚠️ check |
| New-hire report | Within 20 days to Colorado State Directory of New Hires | ⚠️ check |

- ⚠️ An employee who files a DR 0004 has their line 2 allowance used as is, including zero. Without one, the allowance follows the federal W-4 status: $11,000 for married filing jointly, $5,500 otherwise; with neither form, single.
- ⚠️ Deposits: monthly by the 15th; weekly (third business day after the Friday of the payroll week) if more than $50,000 was withheld last year. Quarterly filers (under $7,000 a year) may pay monthly instead. CDOR's assigned frequency controls.
- ⚠️ UI rates are per employer: enter yours from the CDLE rate notice. New employers pay 3.05%.
- ⚠️ FAMLI: the employee pays 0.44% (half of 0.88%); employers with 10 or more employees pay the other 0.44% (enter it in payroll settings). TrailBook stops both at the Social Security wage base.
- ⚠️ Local occupational privilege taxes (Denver $5.75 a month from the employee and $4 from the employer; Aurora, Glendale, Greenwood Village, Sheridan) aren't calculated.
- ⚠️ Minimum wage depends on where the employee works: Denver, Edgewater and Boulder have higher rates. Choose the area on each employee.
- ⚠️ Daily overtime: TrailBook pays overtime after 12 hours a day as well as 40 a week; the 12-consecutive-hours rule isn't checked.
- ⚠️ Sales tax: TrailBook doesn't work out Colorado sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: CDOR, DR 1098 (10/21/25), 2026 Colorado Withholding Worksheet for Employers (4.40% of annualized wages less the DR 0004 line 2 allowance, or $11,000 married filing jointly / $5,500 otherwise from the W-4; single when no certificate; DR 0004 line 3 extra withholding); CDOR, Colorado Wage Withholding Tax Guide (FYI Withholding) (deposits: quarterly under $7,000 a year, monthly by the 15th, weekly over $50,000 (third business day after the Friday of the payroll week); DR 1094 return); CDLE 2026 UI premiums, as summarised by payroll publishers (Eddy, December 2025) ($30,600 wage base; 3.05% new-employer rate including the support surcharge); SB 25-144; FAMLI Division (as summarised by Ogletree and Fisher Phillips) (0.88% FAMLI premium for 2026, up to half from the employee; employers with fewer than 10 employees don't pay the employer half; up to the Social Security wage base); CDLE, 2026 minimum wage; Denver, Boulder and Edgewater ordinances (as reported in January 2026) ($15.16 statewide; Denver $19.29; Edgewater $18.17; City of Boulder and unincorporated Boulder County $16.82); COMPS Order #39 (as summarised by payroll publishers) ($57,784 exempt salary for 2026; overtime after 40 hours a week or 12 hours a day); C.R.S. 8-13.3-401 to 8-13.3-418 (Healthy Families and Workplaces Act) (1 hour of paid sick leave per 30 worked, up to 48 hours a year).

### North Carolina (us-nc 2026.1, `src/rules/us-nc-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 4.09% of the year's wages less $12,750 (single, married, surviving spouse) or $19,125 (head of household) and $2,500 an NC-4 allowance, per pay period rounded to the dollar; no NC-4 means single, no allowances | ⚠️ check |
| Withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $24,000; NC-5 | ⚠️ check |
| North Carolina UI (NC_UI, employer, DES) | 1% default; employer enters its own rate, on the first $34,200 | ⚠️ check |
| Quarterly report | North Carolina Quarterly Income Tax Withholding Return (NC-5 / NC-5Q) | ⚠️ check |
| Quarterly report | Employer's Quarterly Tax and Wage Report (NCUI 101) | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to North Carolina New Hire Reporting Program | ⚠️ check |

- ⚠️ No NC-4 on file: single with no allowances.
- ⚠️ Withholding is rounded to the whole dollar each paycheck, as NC-30 asks, before any extra withholding.
- ⚠️ Deposits: monthly by the 15th (December's by January 31; TrailBook shows January 15, which is early but safe), or on the federal semiweekly dates once you average $2,000 a month. TrailBook decides from last year's withholding; quarterly filers (under $250 a month) may pay monthly. NCDOR's assigned frequency controls.
- ⚠️ UI rates are per employer: enter yours from the DES rate notice. New employers pay 1.0%.
- ⚠️ Sales tax: TrailBook doesn't work out North Carolina sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: NCDOR, NC-30 Income Tax Withholding Tables and Instructions for Employers (2026), sections 15, 16 and 27 and pages 17 to 20 (4.09% withholding rate; $12,750 standard deduction (single, married, surviving spouse) and $19,125 (head of household); $2,500 an allowance; round to the whole dollar; no NC-4 means single with no allowances; monthly NC-5 by the 15th for $250 to $2,000 a month, semiweekly with federal deposits from $2,000 a month); NC DES 2026 UI rates, as summarised by payroll publishers ($34,200 wage base; 1.0% new-employer rate); G.S. 95-25.3 (minimum wage follows the federal $7.25) ($7.25 minimum wage; no state paid sick leave law); G.S. 110-129.2 (new hire reporting) (report new hires within 20 days).

### Georgia (us-ga 2026.1, `src/rules/us-ga-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 4.99% of the year's wages less $15,000 ($30,000 married filing jointly with one income) and $5,000 a G-4 dependent allowance; no G-4 means single, zero allowances | ⚠️ check |
| Withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $50,000; G-7 | ⚠️ check |
| Georgia UI (GA_UI, employer, GDOL) | 2.7% default; employer enters its own rate, on the first $9,500 | ⚠️ check |
| Quarterly report | Georgia Quarterly Return for Monthly Payer (G-7) | ⚠️ check |
| Quarterly report | Employer's Quarterly Tax and Wage Report (DOL-4N) | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 10 days to Georgia New Hire Reporting Program | ⚠️ check |

- ⚠️ Pay runs before May 11, 2026 may have used 5.19% and the old deductions; TrailBook uses the current figures for the whole year.
- ⚠️ G-4 statuses: single (A), married filing jointly with both spouses working (B), married filing jointly with one income (C, the only one with the $30,000 deduction), married filing separately (D), head of household (E).
- ⚠️ Only dependent allowances are modelled, at $5,000 each. The G-4's additional allowances for itemized deductions aren't, so an employee who claims them is over-withheld; adjust with fewer extra dollars if needed.
- ⚠️ No G-4 on file: single with zero allowances.
- ⚠️ Deposits: monthly by the 15th, or semi-weekly on the federal dates above $50,000 in the lookback period. Quarterly and annual payers (under $200 a month) may pay monthly. TrailBook decides from last year's withholding.
- ⚠️ UI rates are per employer: enter yours (including the 0.06% administrative assessment) from the GDOL rate notice. New employers pay 2.7%.
- ⚠️ Georgia wants new hires reported within 10 days, faster than most states.
- ⚠️ Sales tax: TrailBook doesn't work out Georgia sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Georgia DOR, 2026 Employer's Tax Guide (updated June 2026), What's New and Percentage Method (Table E) (4.99% from May 11, 2026 (5.19% before); $30,000 standard deduction married filing jointly with one income, $15,000 for every other status; $5,000 a dependent allowance; no G-4 means single with zero allowances); Georgia DOR, 2026 Employer's Tax Guide, payment schedules (monthly by the 15th for $50,000 or less in the lookback period; semi-weekly above it; G-7 quarterly); GDOL 2026 UI rates, as summarised by payroll publishers ($9,500 wage base; 2.7% new-employer rate (2.64% plus the 0.06% administrative assessment)); O.C.G.A. 34-4-3 (federal $7.25 minimum wage applies to covered employers) ($7.25 minimum wage; no state paid sick leave law); O.C.G.A. 49-5-121 (new hire reporting) (report new hires within 10 days).

### Utah (us-ut 2026.1, `src/rules/us-ut-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 4.45% of wages less a base allowance of $485 single / $970 married a year, which shrinks by 1.3% of wages over $9,348 / $18,696; status from the federal W-4 | ⚠️ check |
| Withholding deposits | Monthly by the last day of the next month; TC-941 | ⚠️ check |
| Utah UI (UT_UI, employer, DWS) | 1.2% default; employer enters its own rate, on the first $50,700 | ⚠️ check |
| Quarterly report | Utah Withholding Return (TC-941) | ⚠️ check |
| Quarterly report | Employer Quarterly Contribution Report (Form 3) | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to Utah Department of Workforce Services (New Hire Registry) | ⚠️ check |

- ⚠️ Check against Publication 14 itself: TrailBook's build machines couldn't open it (files.tax.utah.gov is blocked to them), so these figures are from payroll publishers.
- ⚠️ Payroll periods before June 1, 2026 used 4.5% and a $450 / $900 base allowance; TrailBook uses the current figures for the whole year.
- ⚠️ Status comes from the federal W-4: married filing jointly uses the married figures; single, married filing separately and head of household use the single ones. W-4 allowances and extra withholding don't change Utah withholding.
- ⚠️ The base allowance is worked out on the year's wages and divided by the pay periods; Publication 14's per-period figures are rounded, so amounts can differ by a few cents.
- ⚠️ Deposits: monthly by the end of the next month. Quarterly filers (under $1,000 a month) may pay monthly. The Tax Commission's assigned frequency controls.
- ⚠️ UI rates are per employer and new-employer rates depend on the industry: enter yours from the DWS rate notice.
- ⚠️ Sales tax: TrailBook doesn't work out Utah sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Utah Publication 14 (revised for S.B. 60, payroll periods from June 1, 2026), as reported by EY Tax News (May 11, 2026), Bloomberg Tax and the USDA National Finance Center (4.45% rate; base allowance $485 single / $970 married a year; reduced by 1.3% of wages above $9,348 single / $18,696 married; status from the federal W-4 (married only for married filing jointly); no subtraction for W-4 allowances); Utah Tax Commission, withholding filing frequency (monthly payments for $1,000 or more a month, due the last day of the next month; quarterly otherwise; TC-941); Utah DWS 2026 UI rates, as summarised by payroll publishers ($50,700 wage base; new-employer rate by industry (about 1.2%)); Utah Code 34-40-103 (minimum wage follows the federal $7.25) ($7.25 minimum wage; no state paid sick leave law); Utah Code 35A-7-103 (new hire reporting) (report new hires within 20 days).

### Idaho (us-id 2026.1, `src/rules/us-id-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 5.3% of the year's wages over $16,100 (single, head of household, married at the single rate) or $32,200 (married); no ID W-4 means single | ⚠️ check |
| Withholding deposits | Monthly by the 20th of the next month; Form 910 | ⚠️ check |
| Idaho UI (ID_UI, employer, IDOL) | 1% default; employer enters its own rate, on the first $58,300 | ⚠️ check |
| Quarterly report | Idaho Withholding Payment Voucher (Form 910) | ⚠️ check |
| Quarterly report | Idaho Quarterly Unemployment Insurance Tax Report | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to Idaho Department of Labor (New Hire Reporting) | ⚠️ check |

- ⚠️ Pay runs before July 31, 2026 used tables that subtracted child tax credit allowances; TrailBook uses the current tables for the whole year.
- ⚠️ No ID W-4 on file: single. Married withholding at the single rate uses the single figures.
- ⚠️ Deposits: monthly by the 20th of the next month. Semimonthly filers (the 20th and the 5th) and quarterly or annual filers have other dates; the Tax Commission's assigned frequency controls.
- ⚠️ UI rates are per employer: enter yours from the Idaho Department of Labor rate notice. New employers pay 1.0%.
- ⚠️ Sales tax: TrailBook doesn't work out Idaho sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Idaho State Tax Commission, EPB00744 (07-23-2026), Table for Percentage Computation Method of Withholding; press release July 31, 2026 (5.3% over $16,100 single / $32,200 married a year ($1,342 / $2,683 monthly); child tax credit allowances no longer apply (Idaho Code 63-3029L)); Idaho State Tax Commission, Withholding Due Dates (monthly filers pay by the 20th of the next month; semimonthly, quarterly and annual filers on their own dates; Form 910); Idaho Department of Labor 2026 UI rates, as summarised by payroll publishers ($58,300 wage base; 1.0% new-employer rate); Idaho Code 44-1502 (minimum wage) ($7.25 minimum wage; no state paid sick leave law); Idaho Code 72-1601 (new hire reporting) (report new hires within 20 days).


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

A scheduled task runs every morning. It checks the IRS, SSA, EDD, DIR, CDTFA, FTB and city minimum wage ordinances, and for the other state packs: the Texas Workforce Commission, Florida Department of Revenue (reemployment tax), Nevada DETR and Labor Commissioner, Tennessee Department of Labor and Workforce Development, South Dakota Department of Labor and Regulation, Wyoming Department of Workforce Services, New Hampshire Employment Security, Alaska Department of Labor and Workforce Development, Washington ESD (UI, Paid Family and Medical Leave, WA Cares) and Labor and Industries (minimum wage, exempt salary), the Arizona Department of Revenue (A-4 rates, A1-QRT), Arizona DES (UI and job training tax) and the Industrial Commission of Arizona (minimum wage, earned paid sick time), the Oregon Department of Revenue (withholding formulas 150-206-436, statewide transit tax, TriMet and Lane transit taxes), the Oregon Employment Department (UI, Paid Leave Oregon), DCBS (Workers' Benefit Fund) and BOLI (minimum wage), the New York Department of Taxation and Finance (NYS-50-T-NYS tables, NYS-50), the New York Department of Labor (UI, minimum wage, exempt salary) and DFS / the Workers' Compensation Board (Paid Family Leave and disability contributions), the Illinois Department of Revenue (IL-700-T, IL-941) and IDES (UI), the Colorado Department of Revenue (DR 1098, DR 0004), CDLE (UI, minimum wage, COMPS Order) and the FAMLI Division, the North Carolina Department of Revenue (NC-30) and DES, the Georgia Department of Revenue (Employer's Tax Guide) and Department of Labor, the Utah State Tax Commission (Publication 14) and Department of Workforce Services, the Idaho State Tax Commission (EPB00744 and EPB00745) and Department of Labor, the Chicago and Cook County minimum wage notices, and Denver, Edgewater and Boulder minimum wages, plus each state's new-hire reporting rules and minimum wage notices, for new or changed figures that these packs use (and new-year figures), and when something changes it opens a pull request that updates the pack, its sources and this checklist, and tells Greg. Rule changes are not merged without Greg's review, because they change paychecks and tax.
