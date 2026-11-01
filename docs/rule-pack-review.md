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
| Announced for Jan 1, 2027 | Belmont $19.60 (city FAQ page, rule watch 2026-10-28), Burlingame, Half Moon Bay, Hayward, Novato, Palo Alto, Petaluma, San Diego, San Mateo, San Mateo County, Santa Clara, West Hollywood | ⚠️ the other cities announce in Nov and Dec; the daily rule watch adds them. Local rates below the 2027 state $17.40 (e.g. Oakland's 2026 rate) are ignored |
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

### Other states: announced for 2027 (rule watch 2026-10-29 and later; each 2027 state pack needs these)

| State | Figure | 2026 pack | 2027 value | Source |
|---|---|---|---|---|
| Washington | UI wage base | $78,200 | $82,000 | ESD 2025 average annual wage release (June 2026), as reported by the Washington Research Council and Tri-Cities Business News |
| Washington | Paid Family and Medical Leave premium | 1.13% (employees 71.43%) | 1.2% (employees 70.7%, employers with 50+ employees 29.3%) | ESD news release, Oct 16, 2026 |
| Nevada | UI and Career Enhancement wage base | $43,700 | $45,400 | ESD chief economist memo, Jun 1, 2026 (NRS 612.545) |
| Wyoming | UI wage base | $33,800 | $34,900 | Wyoming DWS, as reported by HR Morning and Thomas & Company (Sep 2026) |
| New York | Paid Family Leave | 0.432%, at most $411.91 | 0.452%, at most $451.81 | DFS rate decision; paidfamilyleave.ny.gov/2027 |
| New York | Minimum wage | $17.00 NYC, Long Island, Westchester; $16.00 elsewhere | unchanged on Jan 1, 2027 (the off-ramp was met; a proposal to raise it from March 2027 is not law) | governor.ny.gov, New York State Minimum Wage for 2027 |
| Colorado | Minimum wage | $15.16 | $15.71 (tipped $12.69) | CDLE press release, Aug 13, 2026 (Bloomberg Tax, ColoradoBiz); rule watch 2026-10-30 |
| Colorado | Denver minimum wage | $19.29 | $19.84 (tipped $16.82) | Denver Labor press release, Aug 6, 2026 (Bloomberg Tax); rule watch 2026-10-30 |
| Minnesota | Minimum wage | $11.41 | $11.87 (90-day under-20 training wage $9.68) | DLI news release, Aug 19, 2026 (Bloomberg Tax); rule watch 2026-10-30 |
| Minnesota | Minneapolis minimum wage | $16.37 | $17.02, all employers | City of Minneapolis website, Aug 2026 (Bloomberg Government, Brightmine); rule watch 2026-10-30 |
| Minnesota | St. Paul minimum wage | $16.37 (one rate in the pack) | Jan 1: $17.02 for 101+ employees, $16.37 for 6 to 100, $14.25 for 5 or fewer. Jul 1: $17.02 for 6 or more, $15.00 for 5 or fewer | City of Saint Paul announcement, 2027 minimum wage rates (stpaul.gov); rule watch 2026-10-30. The 2027 pack needs St. Paul's size tiers |
| Washington | Minimum wage and exempt salary | $17.13; $80,168.40 | $17.73 (14 and 15 year olds $15.07). Exempt salary $82,976.40 ($1,595.70 a week) for 50 or fewer employees, $92,196 ($1,773 a week) for 51 or more; hourly computer professionals $62.06 | L&I news release 26-17 (Sep 30, 2026) and rule notice WSR 26-20-043; rule watch 2026-10-31. The 2027 pack needs the exempt salary split by employer size |
| Arizona | Minimum wage | $15.15 | $15.65 (tip credit stays $3.00) | Industrial Commission of Arizona 2027 poster (KTAR, FreshPlaza); rule watch 2026-10-31 |
| Ohio | Minimum wage | $11.00 | $11.40 (tipped $5.70); applies above $420,000 gross receipts | Ohio Dept of Commerce 2027 poster and announcement, Sep 30, 2026; rule watch 2026-10-31 |
| Maine | Minimum wage and exempt salary | $15.10; $45,300 | $15.70; exempt salary $905.79 a week ($47,101.08) | Maine DOL 2027 minimum wage poster (maine.gov/labor/docs/2027); rule watch 2026-10-31 |
| New Jersey | Minimum wage | $15.92; seasonal or fewer than 6 employees $15.23 | $16.48; seasonal or fewer than 6 employees $16.25 (farm $15.00, tipped cash wage $6.61) | NJDOL press release, Sep 29, 2026 (main rate); the other categories from secondary tables quoting it; rule watch 2026-10-31 |
| Montana | Minimum wage | $10.85 | $11.20 | Montana DLI annual adjustment, as reported by HR Morning and FedRateCalc (state page not yet showing it); rule watch 2026-10-31 |
| Connecticut | Minimum wage | $16.94 | $17.48 (tipped cash wages for 2027 not yet published) | Governor's press release, Aug 5, 2026 (CT Mirror, Hartford Business Journal); rule watch 2026-11-01 |
| Virginia | Minimum wage | $12.77 | $13.75 from Jan 1, 2027 ($15.00 from Jan 1, 2028); farm workers covered from 2027 | SB 1 / HB 1, signed Apr 9, 2026 (Virginia Mercury); rule watch 2026-11-01 |
| Alaska | Minimum wage and exempt salary | $14.00 from Jul 1, 2026; $58,240 | $15.00 from Jul 1, 2027 (exempt salary twice that for 40 hours, $62,400); CPI-indexed after | Ballot Measure 1 (2024), AS 23.10.065; rule watch 2026-11-01. The 2027 pack needs it as a mid-year change |

Not yet final, so not listed: New Jersey's 2027 wage bases ($46,400 UI, $177,100 disability and family leave) are only a proposed rule (58 N.J.R. 1978(a)). Colorado's ($32,100) and Oklahoma's ($24,400) UI wage bases appear on one aggregator only. Cupertino, Los Altos and Redwood City 2027 rates are still unconfirmed (payroll charts only, no city notice). South Dakota's $12.30 for 2027 is a Bloomberg Tax calculation; the DLR page still shows 2026. Seattle's $22.14 for 2027 is announced, but Washington local minimum wages aren't checked yet.

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

## Second round of states: us-il, us-co, us-nc, us-ga, us-ut, us-id 2026.1, released 2026-10-29

Chosen by market size and nearness to the states already live. All six use the new `annual_formula` withholding method (the year's wages less a standard deduction or allowances, through the rates, less any credit, divided by the pay periods) and the new `monthly_or_larger` deposit rule. Greg approved every pack on 2026-10-29 and they are `released`; the ⚠️ notes below stay as the known limits to watch.

Where a state changed its rate part-way through 2026 (Georgia from May 11, Utah from June 1, Idaho from July 31), the pack has only the current figures, because a business starting now pays under them. Tested against each publication's own example where it gives one: Illinois $800 a week with 2 + 2 allowances is $32.13, North Carolina single $450 a week with 2 allowances is $4, Georgia married (one income) $2,000 semimonthly with one dependent is $27.03.

### Illinois (us-il 2026.1, `src/rules/us-il-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 4.95% of wages less $2,925 for each IL-W-4 line 1 allowance and $1,000 for each line 2 allowance, worked out for the year and divided by the pay periods; no IL-W-4 means no allowances | ✅ |
| Withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $12,000; IL-941 | ✅ |
| Illinois UI (IL_UI, employer, IDES) | 3.35% default; employer enters its own rate, on the first $14,250 | ✅ |
| Quarterly report | Illinois Withholding Income Tax Return (IL-941) | ✅ |
| Quarterly report | Employer's Contribution and Wage Report (UI-3/40) | ✅ |
| Minimum wage | $15.00 | ✅ |
| Minimum wage, Chicago | $16.60; $17.05 from 2026-07-01 | ✅ |
| Minimum wage, Cook County, outside Chicago | $15.00; $15.40 from 2026-07-01 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | 1 hour per 40 worked, up to 40 hours a year | ✅ |
| New-hire report | Within 20 days to Illinois Department of Employment Security (New Hire Directory) | ✅ |

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
| State income tax on wages | 4.4% of the year's wages less the DR 0004 line 2 allowance, or without one $11,000 (married filing jointly on the W-4) or $5,500; DR 0004 line 3 extra | ✅ |
| Withholding deposits | Monthly by the 15th of the next month; weekly (third business day after the payroll week's Friday) when last year's withholding was over $50,000; DR 1094 | ✅ |
| Colorado FAMLI (employee) (CO_FAMLI_EE, employee, FAMLI) | 0.44%, on the first $184,500 | ✅ |
| Colorado UI (CO_UI, employer, CDLE) | 3.05% default; employer enters its own rate, on the first $30,600 | ✅ |
| Colorado FAMLI (employer) (CO_FAMLI_ER, employer, FAMLI) | 0% default; employer enters its own rate, on the first $184,500 | ✅ |
| Quarterly report | Colorado Wage Withholding Tax Return (DR 1094) | ✅ |
| Quarterly report | Colorado UI Premium and Wage Report (UITR-1) | ✅ |
| Quarterly report | Colorado FAMLI Quarterly Wage Report | ✅ |
| Minimum wage | $15.16 | ✅ |
| Minimum wage, Denver | $19.29 | ✅ |
| Minimum wage, Edgewater | $18.17 | ✅ |
| Minimum wage, City of Boulder or unincorporated Boulder County | $16.82 | ✅ |
| Exempt salary floor (a year) | $57,784 | ✅ |
| Overtime | After 40 hours a week or 12 hours a day | ✅ |
| Paid sick leave | 1 hour per 30 worked, up to 48 hours a year | ✅ |
| New-hire report | Within 20 days to Colorado State Directory of New Hires | ✅ |

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
| State income tax on wages | 4.09% of the year's wages less $12,750 (single, married, surviving spouse) or $19,125 (head of household) and $2,500 an NC-4 allowance, per pay period rounded to the dollar; no NC-4 means single, no allowances | ✅ |
| Withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $24,000; NC-5 | ✅ |
| North Carolina UI (NC_UI, employer, DES) | 1% default; employer enters its own rate, on the first $34,200 | ✅ |
| Quarterly report | North Carolina Quarterly Income Tax Withholding Return (NC-5 / NC-5Q) | ✅ |
| Quarterly report | Employer's Quarterly Tax and Wage Report (NCUI 101) | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to North Carolina New Hire Reporting Program | ✅ |

- ⚠️ No NC-4 on file: single with no allowances.
- ⚠️ Withholding is rounded to the whole dollar each paycheck, as NC-30 asks, before any extra withholding.
- ⚠️ Deposits: monthly by the 15th (December's by January 31; TrailBook shows January 15, which is early but safe), or on the federal semiweekly dates once you average $2,000 a month. TrailBook decides from last year's withholding; quarterly filers (under $250 a month) may pay monthly. NCDOR's assigned frequency controls.
- ⚠️ UI rates are per employer: enter yours from the DES rate notice. New employers pay 1.0%.
- ⚠️ Sales tax: TrailBook doesn't work out North Carolina sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: NCDOR, NC-30 Income Tax Withholding Tables and Instructions for Employers (2026), sections 15, 16 and 27 and pages 17 to 20 (4.09% withholding rate; $12,750 standard deduction (single, married, surviving spouse) and $19,125 (head of household); $2,500 an allowance; round to the whole dollar; no NC-4 means single with no allowances; monthly NC-5 by the 15th for $250 to $2,000 a month, semiweekly with federal deposits from $2,000 a month); NC DES 2026 UI rates, as summarised by payroll publishers ($34,200 wage base; 1.0% new-employer rate); G.S. 95-25.3 (minimum wage follows the federal $7.25) ($7.25 minimum wage; no state paid sick leave law); G.S. 110-129.2 (new hire reporting) (report new hires within 20 days).

### Georgia (us-ga 2026.1, `src/rules/us-ga-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 4.99% of the year's wages less $15,000 ($30,000 married filing jointly with one income) and $5,000 a G-4 dependent allowance; no G-4 means single, zero allowances | ✅ |
| Withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $50,000; G-7 | ✅ |
| Georgia UI (GA_UI, employer, GDOL) | 2.7% default; employer enters its own rate, on the first $9,500 | ✅ |
| Quarterly report | Georgia Quarterly Return for Monthly Payer (G-7) | ✅ |
| Quarterly report | Employer's Quarterly Tax and Wage Report (DOL-4N) | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 10 days to Georgia New Hire Reporting Program | ✅ |

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
| State income tax on wages | 4.45% of wages less a base allowance of $485 single / $970 married a year, which shrinks by 1.3% of wages over $9,348 / $18,696; status from the federal W-4 | ✅ |
| Withholding deposits | Monthly by the last day of the next month; TC-941 | ✅ |
| Utah UI (UT_UI, employer, DWS) | 1.2% default; employer enters its own rate, on the first $50,700 | ✅ |
| Quarterly report | Utah Withholding Return (TC-941) | ✅ |
| Quarterly report | Employer Quarterly Contribution Report (Form 3) | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Utah Department of Workforce Services (New Hire Registry) | ✅ |

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
| State income tax on wages | 5.3% of the year's wages over $16,100 (single, head of household, married at the single rate) or $32,200 (married); no ID W-4 means single | ✅ |
| Withholding deposits | Monthly by the 20th of the next month; Form 910 | ✅ |
| Idaho UI (ID_UI, employer, IDOL) | 1% default; employer enters its own rate, on the first $58,300 | ✅ |
| Quarterly report | Idaho Withholding Payment Voucher (Form 910) | ✅ |
| Quarterly report | Idaho Quarterly Unemployment Insurance Tax Report | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Idaho Department of Labor (New Hire Reporting) | ✅ |

- ⚠️ Pay runs before July 31, 2026 used tables that subtracted child tax credit allowances; TrailBook uses the current tables for the whole year.
- ⚠️ No ID W-4 on file: single. Married withholding at the single rate uses the single figures.
- ⚠️ Deposits: monthly by the 20th of the next month. Semimonthly filers (the 20th and the 5th) and quarterly or annual filers have other dates; the Tax Commission's assigned frequency controls.
- ⚠️ UI rates are per employer: enter yours from the Idaho Department of Labor rate notice. New employers pay 1.0%.
- ⚠️ Sales tax: TrailBook doesn't work out Idaho sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Idaho State Tax Commission, EPB00744 (07-23-2026), Table for Percentage Computation Method of Withholding; press release July 31, 2026 (5.3% over $16,100 single / $32,200 married a year ($1,342 / $2,683 monthly); child tax credit allowances no longer apply (Idaho Code 63-3029L)); Idaho State Tax Commission, Withholding Due Dates (monthly filers pay by the 20th of the next month; semimonthly, quarterly and annual filers on their own dates; Form 910); Idaho Department of Labor 2026 UI rates, as summarised by payroll publishers ($58,300 wage base; 1.0% new-employer rate); Idaho Code 44-1502 (minimum wage) ($7.25 minimum wage; no state paid sick leave law); Idaho Code 72-1601 (new hire reporting) (report new hires within 20 days).


## Third round of states: us-mi, us-va, us-ma, us-nj 2026.1, released 2026-10-29

The next four by market size and nearness. All four use the `annual_formula` method from the second round, which gained four options for them: a year's tax rounded to the dollar before dividing (Virginia), allowances that are credits off the tax rather than deductions (Massachusetts blindness), a one-time exemption base once any exemption is claimed (Massachusetts $3,400), the employee's Social Security and Medicare coming off wages first up to a yearly cap (Massachusetts $2,000), and a no-tax floor on low annual wages (Massachusetts $8,000). Quarterly deposits and forms can now name a due day and skip the weekend extension (New Jersey's NJ-927, due the 30th with no extension). Greg approved every pack on 2026-10-29 and they are `released`; the ⚠️ notes below stay as the known limits to watch.

Tested against the publications' examples where they give one: Virginia $2,649 semimonthly with 5 exemptions is $109.50. Massachusetts, New Jersey and Michigan were checked by hand against their formulas (for example Massachusetts $1,000 a week, 1 exemption, $76.50 of FICA is $41.94; New Jersey Rate A $1,000 a week with 2 allowances is $27.02).

Michigan city income taxes (Detroit and about 23 other cities) are the main gap: they aren't withheld yet.

### Michigan (us-mi 2026.1, `src/rules/us-mi-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 4.25% of the year's wages less $5,900 an MI-W4 exemption, divided by the pay periods; no MI-W4 means no exemptions | ✅ |
| Withholding deposits | Monthly by the 20th of the next month; Form 5080 | ✅ |
| Michigan UI (MI_UI, employer, UIA) | 2.7% default; employer enters its own rate, on the first $9,000 | ✅ |
| Quarterly report | Employer's Quarterly Wage/Tax Report (UIA 1028) | ✅ |
| Minimum wage | $13.73 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | 1 hour per 30 worked, up to 72 hours a year (40 under 11 employees) | ✅ |
| New-hire report | Within 20 days to Michigan New Hire Operations Center | ✅ |

- ⚠️ michigan.gov answered our requests with 403, so the rate and exemption come from Treasury's figures as reported by Bloomberg Tax and the USDA payroll bulletin, not the Form 446 itself. Worth a look at Form 446 before release.
- ⚠️ No MI-W4 on file: no exemptions (4.25% of all wages).
- ⚠️ City income taxes (Detroit 2.4% resident and 1.2% nonresident, Grand Rapids, Lansing and about 20 others) aren't withheld. Employers with staff in those cities must withhold them separately for now.
- ⚠️ Withholding is paid monthly by the 20th of the next month (Form 5080). Accelerated filers pay on the federal dates; TrailBook keeps every Michigan employer on the monthly date, so an accelerated filer must follow Treasury's notice.
- ⚠️ UI rates are per employer: enter yours from the UIA rate notice. New employers pay 2.7%. The UI wage base is $9,000 for employers who file on time and owe nothing, $9,500 otherwise; TrailBook uses $9,000.
- ⚠️ Earned sick time: employers with 11 or more employees, 72 hours a year; 10 or fewer, 40 hours.
- ⚠️ Sales tax: TrailBook doesn't work out Michigan sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Michigan Treasury, Withholding Tax Information by Calendar Year (2026), as reported by Bloomberg Tax and the USDA NFC payroll bulletin (4.25% rate; $5,900 a personal exemption (up from $5,800)); Michigan Treasury Form 446 (withholding guide), as summarised by payroll publishers (monthly payments due the 20th of the next month on Form 5080; accelerated filers on the federal dates); Michigan UIA 2026 rates, as reported by Bloomberg Tax and EY ($9,000 wage base for employers in good standing ($9,500 if delinquent); 2.7% new-employer rate (5% for new construction employers)); Michigan LEO, minimum wage notice ($13.73 from January 1, 2026 ($15.00 from January 1, 2027)); Earned Sick Time Act (MCL 408.961 et seq., as amended February 2025) (1 hour per 30 worked; employers with 11 or more employees may cap use at 72 hours a year, smaller employers at 40); MCL 421.13j (new hire reporting) (report new hires within 20 days).

### Virginia (us-va 2026.1, `src/rules/us-va-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $8,750, $930 a VA-4 personal exemption and $800 an age 65 or blind exemption, at 2% / 3% / 5% / 5.75% (over $3,000 / $5,000 / $17,000), the year's tax rounded to the dollar, divided by the pay periods | ✅ |
| Withholding deposits | Monthly by the 25th of the next month; on the federal semiweekly dates when last year's withholding was over $12,000; VA-5 | ✅ |
| Virginia UI (VA_UI, employer, VEC) | 2.5% default; employer enters its own rate, on the first $8,000 | ✅ |
| Quarterly report | Employer's Quarterly Tax and Payroll Report (VEC-FC-20/21) | ✅ |
| Minimum wage | $12.77 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Virginia New Hire Reporting Center | ✅ |

- ⚠️ The annual tax is rounded to the whole dollar before dividing, as in Virginia's own example ($2,628 / 24 = $109.50).
- ⚠️ VA-4 line 1 is personal exemptions (E1, $930 each); line 2 is exemptions for age 65 or blindness (E2, $800 each). No VA-4 on file: no exemptions.
- ⚠️ Withholding is paid monthly by the 25th (VA-5), or semi-weekly on the federal dates from $3,000 a quarter (VA-15, with the VA-16 each quarter). TrailBook decides from last year's withholding; Virginia Tax's filing-frequency letter controls. Quarterly filers (under $300 a quarter) can pay monthly.
- ⚠️ UI rates are per employer: enter yours from the VEC rate notice, including the fund-building and pool charges. New employers pay 2.5%.
- ⚠️ Virginia has no general paid sick leave law (only home health workers are covered).
- ⚠️ Sales tax: TrailBook doesn't work out Virginia sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Virginia Tax, Employer Withholding Instructions (2614086 Rev. 10/26), formula for taxable year 2025 and after ($8,750 deduction; $930 per personal exemption (E1) and $800 per age 65 or blind exemption (E2); 2%, 3%, 5%, 5.75% brackets; the $109.50 example); Virginia Tax, Employer Withholding Instructions, filing frequency and Forms VA-5, VA-15, VA-16 (quarterly under $300 a quarter, monthly from $300 to $2,999 (VA-5 due the 25th), semi-weekly from $3,000 a quarter (within 3 banking days of the federal cutoff)); VEC 2026 rates, as summarised by Paychex and Paylocity ($8,000 wage base; 2.5% new-employer rate); Virginia DOLI, minimum wage notice (July 2025) ($12.77 from January 1, 2026); Va. Code 63.2-1946 (new hire reporting) (report new hires within 20 days).

### Massachusetts (us-ma 2026.1, `src/rules/us-ma-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | Wages less this paycheck's Social Security and Medicare (until $2,000 a year), for the year, less $3,400 plus $1,000 an M-4 exemption (when at least one), at 5% (9% over $1,107,750), less $120 for head of household and $110 a blind person; nothing when an exemption is claimed and the year's wages are under $8,000 | ✅ |
| Withholding deposits | Monthly by the 15th of the next month; weekly (third business day after the payroll week's Friday) when last year's withholding was over $25,000; M-941 | ✅ |
| Massachusetts PFML (employee) (MA_PFML_EE, employee, DFML) | 0.46%, on the first $184,500 | ✅ |
| Massachusetts PFML (employer) (MA_PFML_ER, employer, DFML) | 0% default; employer enters its own rate, on the first $184,500 | ✅ |
| Massachusetts UI (MA_UI, employer, DUA) | 2.42% default; employer enters its own rate, on the first $15,000 | ✅ |
| Massachusetts Workforce Training Fund (MA_WTF, employer, DUA) | 0.056%, on the first $15,000 | ✅ |
| Massachusetts EMAC (MA_EMAC, employer, DUA) | 0% default; employer enters its own rate, on the first $15,000 | ✅ |
| Quarterly report | Employer's Return of Income Taxes Withheld (M-941) | ✅ |
| Quarterly report | Massachusetts Employment and Wage Detail Report | ✅ |
| Quarterly report | Massachusetts PFML Quarterly Contribution Return | ✅ |
| Minimum wage | $15.00 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | 1 hour per 30 worked, up to 40 hours a year | ✅ |
| New-hire report | Within 14 days to Massachusetts DOR New Hire Reporting | ✅ |

- ⚠️ The Social Security and Medicare subtraction uses this paycheck's amounts until the year's total reaches $2,000. Earlier pay this year is counted from the year-to-date wages, so an employee hired after other payroll in the year starts from the wages TrailBook has.
- ⚠️ M-4 line 1 is the exemption count. One exemption gives $4,400; each further one $1,000 more. No M-4 on file: no exemptions. Full-time students under $8,000 a year can be marked exempt.
- ⚠️ TrailBook works the formula over the year, so amounts can differ from the wage-bracket tables by a few cents.
- ⚠️ Withholding is paid monthly by the 15th; TrailBook uses the 15th for the quarter's last month too, though DOR allows until the M-941 at the end of the next month. Above $25,000 a year DOR wants quarter-monthly payments; TrailBook's nearest schedule is weekly, which pays at least as early.
- ⚠️ UI rates are per employer: enter yours from the DUA rate notice, including any COVID-19 Recovery Assessment. New employers pay 2.42%.
- ⚠️ EMAC applies from the employer's fourth year (0.12%, then 0.24%, then 0.34%); new employers leave it blank.
- ⚠️ PFML: TrailBook withholds the full 0.46% employee share; employers that choose to pay some of it for their employees can't set that yet. Employers with 25 or more covered individuals enter the 0.42% employer share.
- ⚠️ Earned sick time is paid at 11 or more employees; smaller employers must give the same hours unpaid.
- ⚠️ Sales tax: TrailBook doesn't work out Massachusetts sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Massachusetts DOR, Circular M (Rev. 12/25), Income Tax Withholding Tables and percentage method from January 1, 2026 (FICA subtraction up to $2,000; exemption factor $4,400 for one, $3,400 plus $1,000 each for more; 5% and 9% above $1,107,750; head of household $120 and blindness $110 a year; no withholding under $8,000 a year when an exemption is claimed); Massachusetts DOR, Form M-941 instructions, as summarised by payroll publishers (monthly payments by the 15th (the quarter's last month with the M-941 at month end) for $1,201 to $25,000 a year; quarter-monthly above $25,000); Massachusetts DUA, Learn about UI contribution rates (mass.gov) (2.42% new-employer rate for 2026 (6.08% for new construction employers); $15,000 wage base (M.G.L. c. 151A, s. 14)); Massachusetts DFML 2026 contribution rates, as reported by Seyfarth and Fisher Phillips (0.88% of wages up to the Social Security wage base ($184,500); employees can be charged up to 0.46%; employers with 25 or more covered individuals pay the other 0.42%); M.G.L. c. 151A, s. 14L (Workforce Training Fund) and s. 14G (EMAC) (0.056% Workforce Training Fund on the UI wage base; EMAC from the employer's fourth year); M.G.L. c. 151, s. 1 (minimum wage); c. 149, s. 148C (earned sick time) ($15.00 minimum wage; 1 hour per 30 worked, up to 40 hours a year (paid at 11 or more employees)); M.G.L. c. 62E, s. 2 (new hire reporting) (report new hires within 14 days).

### New Jersey (us-nj 2026.1, `src/rules/us-nj-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $1,000 an NJ-W4 allowance, through Rate table A (single or filing separately) or B (joint, head of household, surviving spouse), or C, D or E chosen on line 3: 1.5% up to 11.8% over $1 million; no NJ-W4 means Rate A, no allowances | ✅ |
| Withholding deposits | Monthly by the 15th of the next month; weekly (third business day after the payroll week's Friday) when last year's withholding was over $9,999.99; NJ-500 | ✅ |
| New Jersey UI/WF (employee) (NJ_UIWF_EE, employee, NJDOL) | 0.425%, on the first $44,800 | ✅ |
| New Jersey disability (employee) (NJ_DI_EE, employee, NJDOL) | 0.19%, on the first $171,100 | ✅ |
| New Jersey family leave (employee) (NJ_FLI_EE, employee, NJDOL) | 0.23%, on the first $171,100 | ✅ |
| New Jersey UI (NJ_UI_ER, employer, NJDOL) | 2.6825% default; employer enters its own rate, on the first $44,800 | ✅ |
| New Jersey WF/SWF (employer) (NJ_WF_ER, employer, NJDOL) | 0.1175%, on the first $44,800 | ✅ |
| New Jersey disability (employer) (NJ_DI_ER, employer, NJDOL) | 0.5% default; employer enters its own rate, on the first $44,800 | ✅ |
| New Jersey UI, disability and family leave deposits | Quarterly by the 30th of the month after the quarter, the business day before when that's a weekend or holiday; NJ-927 | ✅ |
| Quarterly report | Employer's Quarterly Report (NJ-927) and WR-30 | ✅ |
| Minimum wage | $15.92 | ✅ |
| Minimum wage, Seasonal or fewer than 6 employees | $15.23 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | 1 hour per 30 worked, up to 40 hours a year | ✅ |
| New-hire report | Within 20 days to New Jersey New Hire Reporting Center | ✅ |

- ⚠️ No NJ-W4 on file: Rate A with no allowances. NJ-WT says only that tax must be withheld; Rate A with none is the usual reading.
- ⚠️ TrailBook works the rate tables over the year, so amounts can differ from the weekly or biweekly tables by a few cents.
- ⚠️ Employee contributions: UI and WF/SWF together (0.425%) on the first $44,800, and disability (0.19%) and family leave (0.23%) on the first $171,100. They show on the W-2 in box 14.
- ⚠️ Employer UI and disability rates are per employer: enter yours from the NJDOL rate notice (new employers pay 2.6825% and 0.5%). The 0.1175% WF/SWF share is the same for everyone. Rates run July to June; update them each July.
- ⚠️ Withholding is paid monthly by the 15th (NJ-500), or weekly for $10,000 or more withheld last year. The NJ-927 and WR-30 are due the 30th after the quarter, and New Jersey doesn't extend that for weekends, so TrailBook moves the date back to the business day before.
- ⚠️ Minimum wage: pick "Seasonal or fewer than 6 employees" as the work area for those employers ($15.23). Farm and tipped rates aren't modelled.
- ⚠️ Pennsylvania residents who file an NJ-165 are withheld for Pennsylvania instead; TrailBook doesn't handle the reciprocal agreement yet.
- ⚠️ Sales tax: TrailBook doesn't work out New Jersey sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: NJ Division of Taxation, NJ-WT (September 2025), Which Rate Table to Use and the allowance value table (Rate A for NJ-W4 boxes 1 and 3, Rate B for boxes 2, 4 and 5, or the table chosen on line 3; $1,000 a year per allowance); NJ Division of Taxation, New Jersey Gross Income Tax Withholding Rate Tables, annual payroll period, Rates A to E (the bracket rates from 1.5% to 11.8%); NJ Division of Taxation, NJ-WT, payment schedules (monthly NJ-500 payments by the 15th; NJ-927 each quarter; weekly payments for $10,000 or more withheld in the prior year); NJDOL, Employer Services rate information (nj.gov/labor), 2026 (worker UI 0.3825%, WF/SWF 0.0425%, DI 0.19%, FLI 0.23%; new employer UI 2.6825%, DI 0.5%, WF/SWF 0.1175%; $44,800 wage base (UI, WF/SWF and employer DI), $171,100 for worker DI and FLI; NJ-927 and WR-30 due the 30th after the quarter with no weekend extension); NJDOL press release, October 1, 2025 ($15.92 minimum wage from January 1, 2026; $15.23 for seasonal employers and those with fewer than 6 employees); N.J.S.A. 34:11D (Earned Sick Leave Law) (1 hour per 30 worked, up to 40 hours a year); N.J.S.A. 2A:17-56.61 (new hire reporting) (report new hires within 20 days).

## Fourth round of states: us-pa, us-oh 2026.1, released 2026-10-29

Pennsylvania and Ohio, the first states with local income taxes on most paychecks. Local taxes there depend on where each employee lives and works, across thousands of municipalities and school districts, so TrailBook doesn't hold the rates: the employer ticks each local tax for the employee and enters the rate (Pennsylvania earned income tax, Ohio city and school district taxes) or the yearly amount (Pennsylvania Local Services Tax), and the place, which goes in W-2 box 20. Philadelphia's wage tax has set rates, which drop on July 1, 2026. Three new local methods carry this (`flat_rate`, `employee_rate`, `annual_amount`), and `monthly_or_larger` deposits gain a semi-monthly tier (Pennsylvania, $1,000 to $4,999.99 a quarter) and look back at their own taxes (Philadelphia). Greg approved both packs on 2026-10-29 and they are `released`; the ⚠️ notes below stay as the known limits to watch.

Read from the agencies' own pages on 2026-10-29: Pennsylvania's 3.07% and deposit tiers (Department of Revenue), Pennsylvania UC (L&I 2026 highlights), Ohio's August 2026 formula and filing guidelines (Department of Taxation). From payroll publishers: Philadelphia's rates (phila.gov can't be opened from TrailBook's build machines), Ohio UI and the Ohio minimum wage.

### Pennsylvania (us-pa 2026.1, `src/rules/us-pa-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | Flat 3.07% of all compensation; no certificate or exemptions | ✅ |
| Pennsylvania withholding deposits | Monthly by the 15th of the next month; semi-monthly (third business day after the 15th and the month's end) over $3,999.99 last year; on the federal semiweekly dates when last year's withholding was over $19,999.99; W-3 | ✅ |
| Philadelphia wage tax deposits | Monthly by the 15th of the next month; weekly (third business day after the payroll week's Friday) when last year's withholding was over $192,000; Philadelphia wage tax return | ✅ |
| Pennsylvania local earned income tax (Act 32) (PA_EIT, Local tax collector) | Rate entered for each employee (up to 5%) on wages | ✅ |
| Pennsylvania Local Services Tax (PA_LST, Local tax collector) | Yearly amount entered for each employee (up to $52.00), spread evenly over the paychecks | ✅ |
| Lives in Philadelphia (wage tax, resident rate) (PHL_WAGE_R, Philadelphia Revenue) | 3.74%; 3.735% from 2026-07-01 | ✅ |
| Works in Philadelphia but lives elsewhere (wage tax, nonresident rate) (PHL_WAGE_NR, Philadelphia Revenue) | 3.43%; 3.425% from 2026-07-01 | ✅ |
| Pennsylvania UC (employee) (PA_UC_EE, employee, L&I) | 0.07%, no wage base | ✅ |
| Pennsylvania UC (PA_UC, employer, L&I) | 3.822% default; employer enters its own rate, on the first $10,000 | ✅ |
| Local earned income and services taxes deposits | Quarterly by the 30th of the month after the quarter; Quarterly local tax return | ✅ |
| Quarterly report | Employer Quarterly Reconciliation Worksheet (PA W-3) | ✅ |
| Quarterly report | Employer's Report for Unemployment Compensation (UC-2/UC-2A) | ✅ |
| Quarterly report | Quarterly local earned income and services tax return | ✅ |
| Quarterly report | Philadelphia Wage Tax quarterly return | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Pennsylvania New Hire Reporting Program | ✅ |

- ⚠️ State withholding needs no certificate: 3.07% of all compensation. Residents of New Jersey, Ohio, Indiana, Maryland, Virginia and West Virginia who file a REV-419 are exempt under reciprocity; TrailBook doesn't handle that yet and withholds Pennsylvania tax for them.
- ⚠️ Local earned income tax (Act 32): for each employee, enter the higher of their home municipality's total resident rate and the work location's nonresident rate (DCED's Municipal Statistics site lists both by PSD code), and their PSD code. Philadelphia residents pay Philadelphia's wage tax instead and have no EIT.
- ⚠️ Local Services Tax: enter the yearly amount the work location charges (up to $52; $10 or less in some places, which some take once). TrailBook spreads it evenly over the year's paychecks. Employees who file an exemption certificate (under $12,000 a year there) should have it unticked.
- ⚠️ Philadelphia wage tax: tick resident or nonresident. The rate drops on July 1, 2026; TrailBook uses the pay period's last day to pick it. Nonresidents owe it only for work done in Philadelphia, which TrailBook doesn't split.
- ⚠️ Local tax deposits: EIT and LST are paid to the work location's tax collector (Keystone, Berkheimer, Jordan and others) within 30 days after each quarter, which TrailBook shows as the 30th; some collectors want them monthly. Philadelphia's wage tax is paid monthly by the 15th, or weekly at $16,000 or more a month.
- ⚠️ State withholding deposits follow the Department of Revenue's four tiers by last year's withholding: monthly by the 15th, semi-monthly from $4,000 a year, the federal semi-weekly dates from $20,000. The under-$300-a-quarter tier is shown monthly (earlier than needed).
- ⚠️ UC: employees pay 0.07% of all wages; employers pay their notice rate on the first $10,000 (new employers 3.822%, construction 10.5924%).
- ⚠️ Philadelphia (40 hours) and Pittsburgh (24 or 40 hours) have their own paid sick leave ordinances; TrailBook tracks none for Pennsylvania.
- ⚠️ Sales tax: TrailBook doesn't work out Pennsylvania sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: PA Department of Revenue, Employer Withholding (pa.gov/agencies/revenue) (flat 3.07% of compensation for resident and nonresident employees; quarterly under $300 a quarter, monthly by the 15th from $300 to $999, semi-monthly within 3 banking days from $1,000 to $4,999.99, semi-weekly on the federal-style Wednesday/Friday dates from $5,000 a quarter ($20,000 a year); W-3 quarterly reconciliation); PA L&I, UC Trust Fund Solvency Measures in Effect for Calendar Year 2026 (pa.gov/agencies/dli) ($10,000 wage base; employee withholding 0.07% of all wages with no cap; newly liable non-construction employers .038220 (9.2% surcharge included, 0.60% additional tax not applied)); PA DCED, Act 32 earned income tax guidance, as quoted by payroll publishers (withhold the higher of the employee's total resident EIT rate and the work location's nonresident rate; 6-digit PSD codes; remit to the work location's tax collection district); Local Tax Enabling Act (Act 7 of 2007), Local Services Tax (up to $52 a year, taken in equal amounts over the year's pay periods; employees earning under $12,000 a year in the municipality can be exempt); City of Philadelphia wage tax rate table, as reported by payroll publishers (phila.gov could not be opened from TrailBook's build machines) (3.74% resident / 3.43% nonresident to June 30, 2026; 3.735% / 3.425% from July 1, 2026; monthly payments by the 15th, weekly at $16,000 or more a month); 43 P.S. 333.104 (Minimum Wage Act); 23 Pa.C.S. 4392 (new hire reporting) ($7.25 minimum wage; report new hires within 20 days; no statewide paid sick leave law).

### Ohio (us-oh 2026.1, `src/rules/us-oh-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $650 an IT 4 exemption, at 1.6% to $26,050, then $416.80 plus 2.99% to $100,000, then $2,627.91 plus 3.4% (formula effective August 1, 2026); no IT 4 means no exemptions | ✅ |
| Ohio withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $83,999.99; IT 501 | ✅ |
| Ohio school district withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $83,999.99; SD 101 | ✅ |
| Ohio city income tax deposits | Monthly by the 15th of the next month; City withholding return | ✅ |
| Ohio city tax where they work (OH_CITY, City tax administrator) | Rate entered for each employee (up to 3%) on wages | ✅ |
| Also withhold for the city they live in (OH_CITY_RES, City tax administrator) | Rate entered for each employee (up to 3%) on wages | ✅ |
| School district income tax (traditional base) (OH_SD, Ohio Taxation) | Rate entered for each employee (up to 3%) on wages less the state exemptions | ✅ |
| School district income tax (earned income base) (OH_SD_EI, Ohio Taxation) | Rate entered for each employee (up to 3%) on wages | ✅ |
| Ohio UI (OH_UI, employer, ODJFS) | 2.85% default; employer enters its own rate, on the first $9,000 | ✅ |
| Quarterly report | Employer's Contribution Report (JFS-20125) | ✅ |
| Quarterly report | Ohio municipal withholding return | ✅ |
| Minimum wage | $11.00 | ✅ |
| Minimum wage, Gross receipts $405,000 or less | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Ohio New Hire Reporting Center | ✅ |

- ⚠️ Ohio cut its withholding rates from August 1, 2026. Pay runs before then used the older tables; TrailBook uses the current formula for the whole year, so it slightly under-withholds against the old tables for January to July pay dates.
- ⚠️ IT 4 exemptions are $650 each. No IT 4 on file: no exemptions.
- ⚠️ City tax: enter the rate of the city or village where the employee works (most are 1% to 2.5%) and its name. If you also withhold for the city they live in as a courtesy, tick the home city box and enter its rate, less any credit it gives for the work city's tax.
- ⚠️ School district tax: TrailBook withholds it when you tick it and enter the rate from the employee's IT 4 school district number. Traditional-base districts take the rate on wages less the $650 exemptions; earned-income districts take it on all wages.
- ⚠️ Deposits: Ohio withholding (with the SD 101 for school districts) is paid monthly by the 15th, or on the federal semi-weekly dates (Ohio's partial-weekly periods match them) at $84,000 or more in the look-back year. TrailBook uses last calendar year rather than the year to June 30. Quarterly filers ($2,000 or less) are shown monthly, earlier than needed.
- ⚠️ City taxes are paid to the city or its collector (RITA, CCA or the city's own office), usually monthly by the 15th; small employers may be quarterly.
- ⚠️ UI rates are per employer: enter yours from the ODJFS rate notice, including the 0.15% fee. New employers pay 2.85% (5.85% in construction).
- ⚠️ Minimum wage: employers with gross receipts of $405,000 or less pick that area ($7.25).
- ⚠️ Sales tax: TrailBook doesn't work out Ohio sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Ohio Department of Taxation, Employer Withholding Taxes: Optional Computer Formula (Rev. 07/26, effective August 1, 2026) ($650 an exemption; 1.6% up to $26,050; $416.80 plus 2.99% to $100,000; $2,627.91 plus 3.4% above); Ohio Department of Taxation, 2026 Employer and School District Withholding Tax Filing Guidelines (quarterly for $2,000 or less of Ohio and school district tax in the look-back year (to June 30), monthly by the 15th up to $84,000, partial-weekly (3 banking days after each Saturday-to-Tuesday and Wednesday-to-Friday period) from $84,000; traditional-base school districts use the Ohio wage base and exemptions, earned-income districts a flat rate with no exemptions); ODJFS 2026 contribution rates, as reported by payroll publishers and the HB 376 fiscal note ($9,000 wage base; 2.85% new-employer rate including the 0.15% technology and customer service fee (5.85% in construction)); Ohio Constitution art. II, s. 34a; Ohio Department of Commerce minimum wage notice for 2026, as reported ($11.00 for employers with gross receipts over $405,000; $7.25 at or below); ORC 718 (municipal income tax withholding); ORC 4141.29 (new hire reporting) (employers withhold the city tax where work is done, and may withhold for the home city; report new hires within 20 days; no statewide paid sick leave law).

## Fifth round of states: us-in, us-md, us-mo, us-wi, us-mn, us-sc 2026.1, released 2026-10-29

The next six by market size and nearness. All use the `annual_formula` method, which gained what these states need: a third kind of allowance (Indiana's adopted-child exemption), a standard deduction that shrinks with wages (Wisconsin), and a deduction that is a share of wages up to a cap once an allowance is claimed (South Carolina's 10% up to $7,500). Local taxes: Indiana county tax and Maryland county tax are rates the employer enters for each employee from the state's county table; Indiana's is on wages less the state exemptions and Maryland's on the state's taxable wages (a new `state_taxable` base). Kansas City and St. Louis earnings taxes are set at 1%. Minnesota Paid Leave premiums start in 2026 and are added. Greg approved every pack on 2026-10-29 and they are `released`; the ⚠️ notes below stay as the known limits to watch.

Tested against each publication's own examples: Indiana's $800 weekly example ($13.96 state, $4.73 county), South Carolina's $750 weekly with 3 allowances ($10.58), Wisconsin's three W-166 examples ($7.59, $14.34, $22.08), and Maryland's 3.30% percentage table (state plus county equal the table's combined 8.05%). Minnesota and Missouri were checked by hand against their formulas.

Read from the agencies' own documents on 2026-10-29: Indiana Departmental Notice #1, the Maryland Comptroller's 2026 withholding guide, tables and county-rate memo, Missouri's Employer's Tax Guide (Form 4282), Wisconsin's Publication W-166, Minnesota's 2026 withholding booklet and UI Minnesota's 2026 rate and Paid Leave pages, and South Carolina's WH-1603F and withholding page. From payroll publishers: Indiana, Missouri, Wisconsin, South Carolina and Maryland UI rates, Minnesota Paid Leave's employee share and wage base, Kansas City and St. Louis deposit schedules, and Indiana's deposit dates.

### Indiana (us-in 2026.1, `src/rules/us-in-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 2.95% of wages less $1,000 a WH-4 personal exemption, $1,500 a dependent exemption and $3,000 an adopted child, spread over the pay periods; no WH-4 means no exemptions | ✅ |
| Indiana county income tax (IN_COUNTY, Indiana Revenue) | Rate entered for each employee (up to 3.5%) on wages less the state exemptions | ✅ |
| Indiana state and county withholding deposits | Monthly by the 20th of the next month; WH-1 | ✅ |
| Indiana UI deposits | Quarterly with the UC-1/UC-5A | ✅ |
| Indiana UI (IN_UI, employer, DWD) | 2.5% default; employer enters its own rate, on the first $9,500 | ✅ |
| Quarterly report | Employer's Quarterly Contribution and Wage Report (UC-1/UC-5A) | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Indiana New Hire Reporting Center | ✅ |

- ⚠️ WH-4 line 5 is personal exemptions ($1,000 each, including 65 or older and blind); lines 6 and 7 together are dependent exemptions ($1,500 each); line 8 is adopted children ($3,000 each). No WH-4 on file: no exemptions.
- ⚠️ County tax: tick it and enter the rate from the county table in Departmental Notice #1 for the county the employee lived in on January 1 (or worked in, if they lived outside Indiana), and the county's name. It's withheld on the same base as the state tax and paid with the WH-1.
- ⚠️ Deposits: TrailBook shows the WH-1 due on the 20th of the next month, the early-filer date. Employers with $1,000 a month or less on average have until the 30th, so the dates shown are earlier than needed for them.
- ⚠️ UI rates are per employer: enter yours from the DWD rate notice. New employers pay 2.5%.
- ⚠️ Sales tax: TrailBook doesn't work out Indiana sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Indiana Department of Revenue, Departmental Notice #1 (R47 / 10-26, effective October 1, 2026) (2.95% state rate for 2026; $1,000 per personal exemption (WH-4 line 5), $1,500 per dependent and first-time dependent exemption (lines 6 and 7), $3,000 per adopted child (line 8); county tax on the same base at the January 1 county of residence (or of principal work for nonresidents); the 92 county rates; the $800 weekly example); Indiana Department of Revenue filing calendar, as summarised by Thomson Reuters and payroll publishers (WH-1 monthly, due the 20th of the next month for early filers (over $1,000 a month on average last year), the 30th for others); Indiana DWD 2026 rates, as summarised by payroll publishers ($9,500 wage base; 2.5% new-employer rate); IC 22-2-2 (minimum wage); IC 22-4-10-1.5 (new hire reporting) ($7.25 minimum wage; no state paid sick leave law; report new hires within 20 days).

### Maryland (us-md 2026.1, `src/rules/us-md-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $3,400 and $3,200 an MW507 exemption, at 4.75% rising to 6.5% (single brackets from $100,000, joint and head of household from $150,000), divided by the pay periods; plus the county rate below | ✅ |
| Maryland county income tax (or the nonresident rate) (MD_COUNTY, Comptroller of Maryland) | Rate entered for each employee (up to 3.3%) on the state's taxable wages | ✅ |
| Maryland state and county withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $14,999.99; MW506 | ✅ |
| Maryland UI deposits | Quarterly with the Quarterly contribution and employment report | ✅ |
| Maryland UI (MD_UI, employer, Maryland Labor) | 2.6% default; employer enters its own rate, on the first $8,500 | ✅ |
| Quarterly report | Maryland Quarterly Contribution and Employment Report | ✅ |
| Minimum wage | $15.00 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | 1 hour per 30 worked, up to 40 hours a year (balance up to 64) | ✅ |
| New-hire report | Within 20 days to Maryland New Hire Registry | ✅ |

- ⚠️ Maryland's withholding combines the state tax and the county tax. TrailBook shows them as two lines (Maryland income tax and Maryland county income tax) and puts the county tax in W-2 boxes 18 to 20. ⚠️ check: Maryland may want state and county combined in box 17 instead.
- ⚠️ MW507 status: single (also married filing separately), married filing jointly, head of household (joint brackets), or married withholding at the single rate. Exemptions are $3,200 each; the MW507 worksheet lowers how many higher earners can claim. No MW507 on file: single with no exemptions, and you should withhold the 3.30% county rate.
- ⚠️ County tax: tick it and enter the rate of the county (or Baltimore City) the employee lives in, from the Comptroller's 2026 table, and the county's name. Anne Arundel and Frederick rates depend on income; use the one for the employee's expected wages. For a nonresident working in Maryland, enter 2.25% and "Nonresident".
- ⚠️ Small paychecks: the Comptroller's tables say not to withhold on very small paychecks (under $96 a week); TrailBook still works out the small amount.
- ⚠️ Deposits: TrailBook shows the MW506 monthly, due the 15th of the next month. Accelerated filers ($15,000 or more last year) owe within 3 business days of each payday once $700 builds up; TrailBook shows them on the federal semi-weekly dates, which can be a day or two later after a Saturday or Sunday payday. Quarterly filers (under $700 a quarter) can pay later.
- ⚠️ UI rates are per employer: enter yours from the Maryland Department of Labor rate notice. New employers pay 2.6%. ⚠️ check: a 0.15% administrative fee on taxable wages from 2026 is mentioned in a 2026 fiscal note; it isn't added here.
- ⚠️ FAMLI (paid family and medical leave) contributions start January 1, 2027; nothing is taken in 2026.
- ⚠️ Sales tax: TrailBook doesn't work out Maryland sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Comptroller of Maryland, 2026 percentage method of withholding tables (e.g. 3.30 percent local income tax) ($3,400 standard deduction; $3,200 per exemption; combined rates from 8.05% (4.75% + 3.30%) with brackets at $150,000 joint / $100,000 single and up); Comptroller of Maryland, Central Payroll Bureau memo, 2026 Maryland State and Local Income Tax Withholding Information (February 4, 2026) (state brackets to 6.5% over $1,200,000 joint / $1,000,000 single; 2026 county rates (Anne Arundel and Frederick by income); 3.30% when no county is known; nonresident special rate 2.25%); Comptroller of Maryland, 2026 Maryland Employer Withholding Guide (monthly MW506 by the 15th of the next month (over $700 in a quarter); quarterly under $700; accelerated within 3 business days of payday after $15,000 last year once $700 builds up); Maryland Department of Labor 2026 Table A, with rates as reported by Bloomberg Tax ($8,500 wage base; 2.6% new-employer rate); Md. Code, Lab. & Empl. 3-413 (minimum wage), 3-1301 (Healthy Working Families Act), Fam. Law 10-108.6 (new hire reporting); HB 102 (2025) on FAMLI ($15.00 minimum wage; 1 hour of sick and safe leave per 30 worked, up to 40 used and 64 held a year (unpaid under 15 employees); report new hires within 20 days; FAMLI contributions start January 1, 2027).

### Missouri (us-mo 2026.1, `src/rules/us-mo-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $16,100 ($32,200 spouse not working, $24,150 head of household), 0% to $1,348 then 2% to 4.7% over $9,436, per pay period rounded to the dollar; no MO W-4 means single | ✅ |
| Lives or works in Kansas City (1% earnings tax) (KC_EARN, Kansas City Revenue) | 1% of wages | ✅ |
| Lives or works in the City of St. Louis (1% earnings tax) (STL_EARN, St. Louis Collector of Revenue) | 1% of wages | ✅ |
| Missouri withholding deposits | Monthly by the 15th of the next month; MO-941 | ✅ |
| Kansas City earnings tax deposits | Monthly by the 15th of the next month; RD-130M | ✅ |
| St. Louis earnings tax deposits | Quarterly with the W-10 | ✅ |
| Missouri UI deposits | Quarterly with the MODES-4-7 | ✅ |
| Missouri UI (MO_UI, employer, DOLIR) | 2.376% default; employer enters its own rate, on the first $9,000 | ✅ |
| Quarterly report | Quarterly Contribution and Wage Report (MODES-4-7) | ✅ |
| Quarterly report | Kansas City Employer's Quarterly Return of Earnings Tax Withheld (RD-110) | ✅ |
| Quarterly report | St. Louis Employer's Return of Earnings Tax Withheld (W-10) | ✅ |
| Minimum wage | $15.00 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Missouri New Hire Reporting Program | ✅ |

- ⚠️ MO W-4 status: single, married with a working spouse and married filing separately share the $16,100 deduction; tick the box for a spouse who doesn't work ($32,200); head of household is $24,150. No MO W-4 on file: single. Missouri asks for each paycheck's withholding rounded to the whole dollar.
- ⚠️ Deposits: TrailBook shows Missouri withholding monthly by the 15th of the next month, which is what monthly filers owe for the first two months of each quarter (the third month can wait for the MO-941, so the date shown is earlier than needed). Quarter-monthly filers ($9,000 a month in two of the last 12 months) owe more often than shown; TrailBook doesn't work those out.
- ⚠️ Kansas City and St. Louis earnings taxes: tick the one that applies when the employee lives in the city or works there. Both are 1% of wages. Kansas City's is paid on the same schedule as Missouri withholding (RD-130M) with a quarterly RD-110; St. Louis's on the quarterly W-10. Work done outside the city by a nonresident isn't taxed; TrailBook doesn't split wages by where the work was done.
- ⚠️ UI rates are per employer: enter yours from the DOLIR rate notice. New employers pay 2.376% (nonprofits 1%).
- ⚠️ Missouri's Proposition A paid sick leave was repealed from August 28, 2025, so there's no state paid sick leave.
- ⚠️ Sales tax: TrailBook doesn't work out Missouri sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Missouri DOR, Employer's Tax Guide (Form 4282), 2026 Missouri Withholding Tax Formula (standard deductions $16,100 / $32,200 / $24,150; annual brackets 0% to $1,348, then 2% to 4.5% in $1,348 steps, 4.7% over $9,436; rounding to the whole dollar); Missouri DOR, Employer's Tax Guide (Form 4282), filing frequencies and 2026 due dates (monthly ($500 a month in two of the last 12 months) by the 15th, the quarter's last month with the MO-941 by the end of the next month; quarterly and annual filers; quarter-monthly at $9,000 a month); Missouri DOLIR 2026 rates, as reported by Bloomberg Tax ($9,000 wage base; 2.376% new-employer rate (1% nonprofits)); RSMo 290.502 as amended by Proposition A (2024) and HB 567 (2025); Kansas City Code ch. 68 and St. Louis City earnings tax, as summarised by payroll publishers ($15.00 minimum wage from January 1, 2026; Proposition A's paid sick leave repealed from August 28, 2025; 1% Kansas City and St. Louis earnings taxes, paid on the state's frequency (Kansas City) or quarterly (St. Louis W-10)); RSMo 285.304 (new hire reporting) (report new hires within 20 days).

### Wisconsin (us-wi 2026.1, `src/rules/us-wi-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less a sliding deduction ($6,702 single, less 12% over $17,780; $9,461 married, less 20% over $25,727) and $400 a WT-4 exemption, 3.54% / 4.65% / 5.30% / 7.65%, divided by the pay periods | ✅ |
| Wisconsin withholding deposits | Monthly by the last day of the next month; WT-6 | ✅ |
| Wisconsin UI deposits | Quarterly with the UCT-101 | ✅ |
| Wisconsin UI (WI_UI, employer, DWD) | 3.05% default; employer enters its own rate, on the first $14,000 | ✅ |
| Quarterly report | Quarterly Contribution Report and wage report (UCT-101) | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to Wisconsin New Hire Reporting Center | ✅ |

- ⚠️ WT-4 status: single, married, or married but withholding at the higher single rate. No WT-4 on file: single with no exemptions.
- ⚠️ Deposits: the department assigns each employer a frequency. TrailBook shows the WT-6 monthly, due the last day of the next month. Employers assigned semi-monthly owe the first half of each month by its last day and the second half by the 15th of the next month, earlier than shown; quarterly and annual filers can pay later.
- ⚠️ UI rates are per employer: enter yours from the DWD rate notice. Most new employers pay 3.05%.
- ⚠️ Sales tax: TrailBook doesn't work out Wisconsin sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Wisconsin DOR Publication W-166, Withholding Tax Guide, alternate method (laws as of January 15, 2026) (deduction $6,702 single (less 12% over $17,780, none from $73,630) and $9,461 married (less 20% over $25,727, none from $73,032); $400 per exemption; 3.54% to $12,760, 4.65% to $25,520, 5.30% to $280,950, 7.65% above; the three worked examples); Wisconsin DOR Publication W-166, filing frequency and due dates (frequency assigned by the department; monthly and quarterly WT-6 due the last day of the next month; semi-monthly due the last day of the month (1st to 15th) and the 15th of the next (16th to month end)); Wisconsin DWD UI financing summary and 2026 rates, as summarised by payroll publishers ($14,000 wage base; 3.05% new-employer rate (2.50% construction is per payroll size)); Wis. Stat. 104 (minimum wage); Publication W-166 (new hire reporting) ($7.25 minimum wage; no state paid sick leave law; report new hires within 20 days).

### Minnesota (us-mn 2026.1, `src/rules/us-mn-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $5,300 a W-4MN allowance; single 5.35% from $4,700 to 9.85% over $207,850, married 5.35% from $14,700 to 9.85% over $352,630; divided by the pay periods | ✅ |
| Minnesota withholding deposits | On the federal deposit dates when last year's average quarter was over $1,500, otherwise quarterly; quarterly withholding return | ✅ |
| Minnesota UI deposits | Quarterly with the Quarterly UI Wage Detail Report | ✅ |
| Minnesota Paid Leave premiums deposits | Quarterly with the Paid Leave wage detail report | ✅ |
| Minnesota Paid Leave (employee) (MN_PFL_EE, employee, DEED) | 0.44%, on the first $185,000 | ✅ |
| Minnesota Paid Leave (employer) (MN_PFL_ER, employer, DEED) | 0.44% default; employer enters its own rate, on the first $185,000 | ✅ |
| Minnesota UI (MN_UI, employer, UI Minnesota) | 1.69% default; employer enters its own rate, on the first $44,000 | ✅ |
| Minnesota workforce enhancement fee (MN_WEF, employer, UI Minnesota) | 0.1%, on the first $44,000 | ✅ |
| Quarterly report | Quarterly UI Wage Detail Report | ✅ |
| Quarterly report | Paid Leave quarterly wage detail and premiums | ✅ |
| Minimum wage | $11.41 | ✅ |
| Minimum wage, Minneapolis | $16.37 | ✅ |
| Minimum wage, St. Paul | $16.37 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | 1 hour per 30 worked, up to 48 hours a year (balance up to 80) | ✅ |
| New-hire report | Within 20 days to Minnesota New Hire Reporting Center | ✅ |

- ⚠️ W-4MN status: single, married, or married but withholding at the higher single rate. No W-4MN on file: single with no allowances.
- ⚠️ Deposits: TrailBook follows your federal deposit dates when the average quarter's Minnesota withholding last year was over $1,500 (Minnesota looks at the previous quarter), and otherwise shows it due with the quarterly return.
- ⚠️ UI rates are per employer: enter yours from the UI tax rate determination, with the 0.40% base tax and 14% additional assessment included. New employers get an industry rate; TrailBook's default is 1.08% plus the base tax and assessment (professional services, 1.69%). The 0.10% workforce enhancement fee is added separately.
- ⚠️ Paid Leave: TrailBook takes the employee's 0.44% from pay and adds the employer's share (0.44%, or 0.22% for small employers assigned the 0.66% rate). Employers that pay the whole premium themselves enter 0.88% as their share and the employee's is still taken; tell us if you need that switched off.
- ⚠️ Minneapolis and St. Paul have their own minimum wage ($16.37 in 2026); pick the area for employees working there. St. Paul's smaller employers may have a lower rate.
- ⚠️ Sales tax: TrailBook doesn't work out Minnesota sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Minnesota Department of Revenue, 2026 Minnesota Income Tax Withholding instruction booklet, computer formula ($5,300 per allowance; single schedule from $4,700 (5.35%, 6.80% from $38,010, 7.85% from $114,130, 9.85% from $207,850); married from $14,700 (6.80% from $63,400, 7.85% from $208,180, 9.85% from $352,630)); Minnesota Department of Revenue, 2026 withholding booklet, deposit schedules (semiweekly or monthly (by the 15th) following the federal schedule when more than $1,500 was withheld in the previous quarter; otherwise quarterly with the return); Unemployment Insurance Minnesota (uimn.org), 2026 tax rate factors and new employer rates; Paid Leave small employer premium rate page ($44,000 wage base; 0.40% base tax; 14% additional assessment; new-employer rates by industry (1.00% to 4.06%); Paid Leave 0.88% (0.66% small employers)); Minnesota DEED Paid Leave premiums, as reported by PayrollOrg and EY (employees can be charged up to 50% of the premium (0.44%); the small employer share is 0.22%; premiums apply up to $185,000 of wages); Minnesota DLI minimum wage page; Minn. Stat. 181.9445 (earned sick and safe time); Minneapolis and St. Paul ordinances as reported ($11.41 minimum wage for 2026; 1 hour per 30 worked, up to 48 a year; $16.37 in Minneapolis and St. Paul); Minn. Stat. 256.998 (new hire reporting) (report new hires within 20 days).

### South Carolina (us-sc 2026.1, `src/rules/us-sc-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $5,000 an SC W-4 allowance and, with at least one allowance, 10% of wages up to $7,500; 0% to $3,640, 3% to $18,230, 6% above; divided by the pay periods | ✅ |
| South Carolina withholding deposits | On the federal deposit dates; WH-1605/WH-1606 | ✅ |
| South Carolina UI deposits | Quarterly with the UCE-120 | ✅ |
| South Carolina UI (SC_UI, employer, DEW) | 1% default; employer enters its own rate, on the first $14,000 | ✅ |
| Quarterly report | SC Withholding Quarterly Tax Return (WH-1605, WH-1606 for the fourth quarter) | ✅ |
| Quarterly report | Employer Quarterly Contribution and Wage Report (UCE-120) | ✅ |
| Minimum wage | $7.25 | ✅ |
| Exempt salary floor (a year) | $35,568 | ✅ |
| Overtime | After 40 hours a week | ✅ |
| Paid sick leave | No state law | ✅ |
| New-hire report | Within 20 days to South Carolina New Hire Reporting Program | ✅ |

- ⚠️ Act 110 (signed March 30, 2026) lowered the 2026 income tax rates to 1.99% and 5.21%. SCDOR says it will adjust the withholding tables but hasn't published new ones; until it does, employers use the WH-1603F above, which this pack follows. The daily rule watch looks for the new tables.
- ⚠️ SC W-4 allowances are $5,000 each. The 10% standard deduction (up to $7,500) applies only when at least one allowance is claimed. No SC W-4 on file: no allowances, so no deduction.
- ⚠️ Deposits: South Carolina withholding is due with the same frequency as your federal deposits (monthly by the 15th, or the semi-weekly dates). The quarterly WH-1605 (WH-1606 for the fourth quarter) is due the last day of the month after the quarter.
- ⚠️ UI rates are per employer: enter yours from the DEW rate notice. New employers pay 1.0%.
- ⚠️ Sales tax: TrailBook doesn't work out South Carolina sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: SCDOR WH-1603F, Formula for Computing South Carolina 2026 Withholding Tax (Rev. 11/4/25) ($5,000 per allowance; standard deduction of 10% of wages up to $7,500 with one or more allowances, none with zero; 0% to $3,640, 3% to $18,230, 6% above; the $750 weekly example ($10.58)); SCDOR withholding page and Information Letter #26-20 (Act 110) (deposits with the same frequency as federal payments; quarterly WH-1605 and WH-1606 due the last day of the month after the quarter; Act 110 rate changes with withholding tables still to be adjusted); SC DEW glossary and 2026 rate announcement ($14,000 wage base; 1.0% new-employer rate); SC Code 41-10 (no state minimum wage); SC Code 63-17-2310 (new hire reporting) (federal $7.25 minimum wage; no state paid sick leave law; report new hires within 20 days).

## Sixth round of states: us-al, us-la, us-ky, us-ok, us-ct, us-ia 2026.1, released 2026-10-29

The next six. All use the `annual_formula` method, which gained what they need: a deduction or exemption looked up by the year's wages (Alabama's standard deduction schedule, Connecticut Table A), a personal exemption by status, allowance amounts by wages (Alabama dependents), subtracting the year's federal withholding (Alabama), tax added by wages and a credit taken as a share of the tax (Connecticut Tables C, D and E), and a flat rate for a status (Connecticut's 6.99% with no CT-W4). Local taxes: Alabama and Kentucky occupational taxes are rates the employer enters for each employee. Connecticut Paid Leave (0.5%, employee) is added. Greg approved every pack on 2026-10-29 and they are `released`; the ⚠️ notes below stay as the known limits to watch.

Tested against each publication's own examples: Alabama's M-2 $850 weekly ($29.59, with $35.19 federal withheld), Louisiana's two R-1306 examples ($13.98, $111.54), Kentucky's two formula examples ($104.65 and $47.98; the PDF prints $47), Oklahoma's $1,825 semi-monthly example ($37), Iowa's three formula examples ($59.26, $38.72, $45.15), and Connecticut's 2026 weekly tables for every code (A, B, C, D and F) at four wage levels, which match to the cent.

Read from the agencies' own documents on 2026-10-29: Alabama's 2026 withholding booklet, Louisiana's R-1306 and withholding page, Kentucky's 2026 withholding formula (the copy Greg supplied), Oklahoma's OW-2 and OESC 2026 figures, Connecticut's TPG-211, 2026 withholding tables, IP 2026(1) and DOL 2026 UI rates, and Iowa's 2026 withholding formula, withholding page and filing frequencies. From payroll publishers: Alabama, Louisiana and Iowa UI rates, Kentucky's deposit thresholds, and Connecticut Paid Leave's rate and base.

### Alabama (us-al 2026.1, `src/rules/us-al-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less the standard deduction from Alabama's schedule ($3,000 single or 0, $4,250 MS, $8,500 M, $5,200 H, shrinking from $26,000 of wages to $2,500 / $2,500 / $5,000 / $2,500 at $35,500), the year's federal income tax withheld, the A-4 personal exemption ($1,500 S or MS, $3,000 M or H) and $1,000 a dependent ($500 over $50,000, $300 over $100,000); 2% / 4% / 5% from $500 and $3,000 ($1,000 and $6,000 for M); divided by the pay periods; no A-4 means "0" | ⚠️ check |
| City or county occupational tax (AL_OCC, City or county) | Rate entered for each employee (up to 2%) on wages | ⚠️ check |
| Alabama withholding deposits | Monthly by the 15th of the next month; A-6 / A-1 | ⚠️ check |
| Alabama occupational tax deposits | Quarterly with the occupational tax return | ⚠️ check |
| Alabama UI deposits | Quarterly with the UC-CR4 | ⚠️ check |
| Alabama UI (AL_UI, employer, ADOW) | 2.7% default; employer enters its own rate, on the first $8,000 | ⚠️ check |
| Quarterly report | Employer's Quarterly Return of Income Tax Withheld (A-1) | ⚠️ check |
| Quarterly report | Employer's Quarterly Contribution and Wage Report (UC-CR4) | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 7 days to Alabama New Hire Reporting | ⚠️ check |

- ⚠️ A-4 status: 0 (no personal exemption), S (single, $1,500), MS (married filing separately, $1,500), M (married, $3,000) or H (head of family, $3,000). M uses the married brackets; the others use the single ones. Dependents (other than a spouse) go in the dependents box. No A-4 on file: "0", as the booklet says.
- ⚠️ Alabama subtracts the federal income tax withheld from the same paycheck (annualized). TrailBook takes it from the federal amount it works out for that paycheck, including any extra W-4 withholding.
- ⚠️ The booklet says the formula result may be rounded to the dollar; TrailBook keeps cents.
- ⚠️ Occupational tax: tick it and enter the city or county rate (Birmingham 1%, Bessemer 1%, Gadsden 2% and others) and the place. Each city or county collects its own; TrailBook shows one quarterly payment for all of them. ⚠️ check: some cities want monthly returns, and some also tax employers.
- ⚠️ Deposits: TrailBook shows Alabama withholding monthly (Form A-6), due the 15th of the next month. Employers who withhold $1,000 or less in a month can wait until the quarterly A-1 (the last day of the month after the quarter), so TrailBook may show a date earlier than needed.
- ⚠️ UI rates are per employer: enter yours from the Alabama Department of Workforce rate notice. New employers pay 2.7%. ⚠️ check: the $8,000 wage base and 2.7% are from payroll publishers; adol.alabama.gov isn't reachable from here.
- ⚠️ Sales tax: TrailBook doesn't work out Alabama sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Alabama Department of Revenue, Withholding Tax Tables and Instructions (whbooklet_0126), Formula For Computing Alabama Withholding Tax and Schedule of Standard Deduction Amounts (standard deduction by status and wages; federal withholding subtracted; personal exemption $1,500 (S, MS) or $3,000 (M, H); dependents $1,000 / $500 over $50,000 / $300 over $100,000; 2% / 4% / 5% with brackets at $500 and $3,000 ($1,000 and $6,000 for M); zero exemptions without an A-4; the M-2 $850 weekly example ($29.59)); Same booklet, Withholding Tax Returns (monthly A-6 by the 15th once more than $1,000 is withheld in the first or second month of a quarter; quarterly A-1 by the last day of the month after the quarter; A-3 by January 31; occupational and UI taxes not administered by the Department); Alabama Department of Workforce 2026 rates, as reported by payroll publishers (adol.alabama.gov isn't reachable from here) ($8,000 wage base; 2.7% new-employer rate); Alabama has no state minimum wage or paid sick leave law; Ala. Code 25-11-5 (new hire reporting within 7 days) (federal $7.25 minimum wage; report new hires within 7 days).

### Louisiana (us-la 2026.1, `src/rules/us-la-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 3.09% of wages less the L-4 standard deduction spread over the pay periods: none for "0", $12,875 for "1" (single or married separately), $25,750 for "2" (married joint, surviving spouse or head of household); no L-4 means "0" | ⚠️ check |
| Louisiana withholding deposits | Monthly by the last day of the next month; on the federal semiweekly dates when last year's withholding was over $60,000; L-1 | ⚠️ check |
| Louisiana UI deposits | Quarterly with the LWC-UI-4 | ⚠️ check |
| Louisiana UI (LA_UI, employer, LWC) | 1% default; employer enters its own rate, on the first $7,000 | ⚠️ check |
| Quarterly report | Employer's Quarterly Return of Louisiana Withholding Tax (L-1) | ⚠️ check |
| Quarterly report | Employer's Quarterly Report of Wages Paid (LWC-UI-4) | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to Louisiana New Hire Registry | ⚠️ check |

- ⚠️ L-4 standard deduction: "0" (none), "1" (single or married filing separately, $12,875) or "2" (married filing jointly, qualifying surviving spouse or head of household, $25,750). The L-4 no longer has dependents. ⚠️ check: with no L-4 on file TrailBook uses "0" (no deduction), the cautious choice; R-1306 doesn't say.
- ⚠️ Deposits: TrailBook shows Louisiana withholding monthly, due the last day of the next month, and for employers who withheld more than $60,000 last year ($5,000 a month) on the federal deposit dates. ⚠️ check: Louisiana's semi-monthly and monthly due dates are on LDR's filing calendar, which TrailBook doesn't have yet; quarterly payers (under $500 a month) can pay later than shown.
- ⚠️ UI rates are per employer and there is no single new-employer rate: Louisiana assigns new employers their industry's average. Pay runs wait until you enter yours from the Louisiana Workforce Commission rate notice.
- ⚠️ Sales tax: TrailBook doesn't work out Louisiana sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Louisiana Department of Revenue, R-1306 (1/26), Louisiana Withholding Tables and Formulas (3.09% rate; standard deduction $12,875 (L-4 "1") or $25,750 (L-4 "2"), none for "0"; the $700 weekly example ($13.98) and $4,600 biweekly example ($111.54)); Louisiana Department of Revenue, Withholding page (updated June 30, 2026) (quarterly L-1 return; payments quarterly under $500 a month on average, monthly $500 to $5,000, semi-monthly $5,000 or more; L-3 annual reconciliation); Louisiana Workforce Commission 2026 rates, as reported by Bloomberg Tax and payroll publishers ($7,000 wage base; new employers pay their industry's average rate (at least 1%, at most 6.2%)); Louisiana has no state minimum wage or paid sick leave law; La. R.S. 23:1291.1 (new hire reporting) (federal $7.25 minimum wage; report new hires within 20 days).

### Kentucky (us-ky 2026.1, `src/rules/us-ky-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 3.5% of the year's wages less the $3,360 standard deduction, divided by the pay periods | ⚠️ check |
| City, county or school district occupational tax (KY_OCC, City or county) | Rate entered for each employee (up to 4%) on wages | ⚠️ check |
| Kentucky withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $50,000; K-1 | ⚠️ check |
| Kentucky occupational license tax deposits | Quarterly with the OL-3 or the local return | ⚠️ check |
| Kentucky UI deposits | Quarterly with the UI-3 | ⚠️ check |
| Kentucky UI (KY_UI, employer, OUI) | 2.7% default; employer enters its own rate, on the first $12,000 | ⚠️ check |
| Quarterly report | Employer's Quarterly Unemployment Wage and Tax Report (UI-3) | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to Kentucky New Hire Reporting Program | ⚠️ check |

- ⚠️ Kentucky's formula has one standard deduction ($3,360) and no allowances; the K-4 only says whether the employee is exempt. No K-4 on file: withhold with the standard deduction.
- ⚠️ The formula's second example has a typo: $1,247.40 ÷ 26 is $47.98, which TrailBook withholds; the PDF prints $47.
- ⚠️ Occupational license taxes: tick the box and enter the combined rate the employee owes where they work (for example Louisville Metro or Lexington-Fayette, plus any county or school district tax) and the place. TrailBook withholds it from all wages and shows one quarterly payment. ⚠️ check: some places cap wages, exclude 401(k) deferrals, or want monthly returns, and each needs its own return (OL-3 and the like).
- ⚠️ Deposits: TrailBook shows Kentucky withholding monthly, due the 15th of the next month, and for employers with more than $50,000 last year on the federal deposit dates. Kentucky's twice-monthly filers actually pay by the 25th (1st to 15th) and the 10th of the next month (16th to the end), so that date can be off by a few days. Quarterly and annual filers can pay later than shown. ⚠️ check: the thresholds come from 103 KAR 18:150 as summarized by payroll publishers.
- ⚠️ Overtime: Kentucky also requires time and a half for hours on the seventh day when an employee works all seven days of a workweek (KRS 337.050). TrailBook only applies the 40-hour weekly rule; enter seventh-day hours as overtime by hand.
- ⚠️ UI rates are per employer: enter yours from the Kentucky Office of Unemployment Insurance rate notice. New employers pay 2.7% (new contract construction employers 9%).
- ⚠️ Sales tax: TrailBook doesn't work out Kentucky sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Kentucky Department of Revenue, 2026 Kentucky Withholding Tax Formula, 42A003(TCF)(10-2025) ($3,360 standard deduction; 3.5% flat rate on the rest; the $3,270 monthly example ($104.65)); 103 KAR 18:150 and Kentucky withholding instructions, as summarized by payroll publishers (revenue.ky.gov isn't readable from here) (monthly K-1 by the 15th of the next month ($2,000 to $50,000 last year); twice-monthly over $50,000; quarterly or annual below; K-3 and K-5 by January 31); Kentucky Office of Unemployment Insurance, 2026 Employer Guide ($12,000 wage base; 2.7% new-employer rate (9% for new contract construction employers); no Service Capacity Upgrade Fund in 2026); KRS 337.275 (minimum wage follows federal); KRS 341.190 (new hire reporting); no state paid sick leave law ($7.25 minimum wage; report new hires within 20 days).

### Oklahoma (us-ok 2026.1, `src/rules/us-ok-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $1,000 an OK-W-4 allowance; single 0% to $10,100, 2.5% to $11,250, 3.5% to $13,550, 4.5% above; married 0% to $20,200, then $22,500 and $27,100; divided by the pay periods and rounded to the dollar; no OK-W-4 means single | ⚠️ check |
| Oklahoma withholding deposits | Monthly by the 20th of the next month; on the federal semiweekly dates when last year's withholding was over $120,000; WTH 10001 | ⚠️ check |
| Oklahoma UI deposits | Quarterly with the OES-3 | ⚠️ check |
| Oklahoma UI (OK_UI, employer, OESC) | 1.5% default; employer enters its own rate, on the first $25,000 | ⚠️ check |
| Quarterly report | Employer's Quarterly Contribution Report (OES-3) | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to Oklahoma New Hire Reporting Center | ⚠️ check |

- ⚠️ OK-W-4 status: single, married, or married withholding at the higher single rate. Allowances are $1,000 each. ⚠️ check: with no OK-W-4 on file TrailBook uses single with no allowances; the OW-2 doesn't say.
- ⚠️ TrailBook works out the year's tax from the annual table and divides it by the paychecks; the OW-2's per-period tables round their brackets, so results can differ by a few cents before rounding to the dollar.
- ⚠️ Deposits: TrailBook shows Oklahoma withholding monthly, due the 20th of the next month, and for employers averaging $10,000 a month last year on the federal deposit dates. Employers withholding $500 or less a quarter can pay quarterly, later than shown.
- ⚠️ UI rates are per employer: enter yours from the OESC rate notice. New employers pay 1.5%. The 2026 wage base fell to $25,000.
- ⚠️ Sales tax: TrailBook doesn't work out Oklahoma sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Oklahoma Tax Commission, OW-2, 2026 Oklahoma Income Tax Withholding Tables (Table 7, annual payroll period) ($1,000 per allowance; single 0% to $10,100, 2.5% to $11,250, 3.5% to $13,550, 4.5% above; married 0% to $20,200, then $22,500 and $27,100; married at the higher single rate uses the single table; round to the whole dollar; the $1,825 semi-monthly example ($37)); Same publication, General Information (quarterly by the 20th after the quarter up to $500 a quarter; monthly by the 20th of the next month; federal semi-weekly dates from an average of $10,000 a month last fiscal year); Oklahoma Employment Security Commission, Important Numbers for 2026 ($25,000 wage base; 1.5% new-employer rate; rates 0.2% to 5.8%); 40 O.S. 197.2 (minimum wage follows federal); 40 O.S. 4-101.1 (new hire reporting); no state paid sick leave law ($7.25 minimum wage; report new hires within 20 days).

### Connecticut (us-ct 2026.1, `src/rules/us-ct-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | TPG-211 by CT-W4 code (A, B, C, D, F): the year's wages less the Table A exemption, Table B tax (2% to 6.99%), plus the Table C add-back and Table D recapture, less the Table E credit share, divided by the pay periods; no CT-W4 means 6.99% of wages | ⚠️ check |
| Connecticut withholding deposits | Monthly by the 15th of the next month; weekly (by the third business day after the week's Friday) when last year's withholding was over $10,000; CT-941 | ⚠️ check |
| Connecticut UI deposits | Quarterly with the UC-2 | ⚠️ check |
| Connecticut Paid Leave contributions deposits | Quarterly with the Paid Leave wage report | ⚠️ check |
| Connecticut Paid Leave (CT_PL, employee, CT Paid Leave Authority) | 0.5%, on the first $184,500 | ⚠️ check |
| Connecticut UI (CT_UI, employer, CT DOL) | 1.9% default; employer enters its own rate, on the first $27,000 | ⚠️ check |
| Quarterly report | Connecticut Quarterly Reconciliation of Withholding (CT-941) | ⚠️ check |
| Quarterly report | Employer Contribution Return (UC-2) | ⚠️ check |
| Quarterly report | Connecticut Paid Leave quarterly wage report | ⚠️ check |
| Minimum wage | $16.94 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | 1 hour per 30 worked, up to 40 hours a year (balance up to 40), for employers with 11 or more employees | ⚠️ check |
| New-hire report | Within 20 days to Connecticut New Hire Reporting Program | ⚠️ check |

- ⚠️ CT-W4 withholding code: A (married filing separately, or single with no dependents), B (head of household), C (married filing jointly, spouse doesn't work), D (no exemption or credit), F (single, married separately or with a working spouse, who wants more withheld: the head of household style rates at the single exemption). Code E (no withholding needed) is the exempt box.
- ⚠️ No CT-W4 on file: "Not filed", 6.99% of wages with no exemption, as IP 2026(1) says.
- ⚠️ CT-W4 line 3 (reduced withholding per paycheck) isn't supported; only extra withholding (line 2) is.
- ⚠️ Connecticut Paid Leave: 0.5% of each employee's wages up to the Social Security wage base, paid quarterly to the CT Paid Leave Authority. TrailBook shows it in W-2 box 14 as CTPL.
- ⚠️ Deposits: monthly by the 15th of the next month, or weekly (by the Wednesday after the Saturday-to-Friday week; TrailBook uses the third business day after the Friday) once last year's withholding was over $10,000. Quarterly remitters ($2,000 or less) can pay later than shown.
- ⚠️ UI rates are per employer: enter yours from the Connecticut DOL rate notice. New employers pay 1.9%. ⚠️ check: whether the 1.0% fund solvency tax is added to the new-employer rate for 2026; if it is, enter 2.9%.
- ⚠️ Paid sick leave: from 2026 employers with 11 or more employees must give 1 hour per 30 worked, up to 40 hours a year. TrailBook doesn't accrue it for employers with fewer than 11 employees. From 2027 it covers employers with 1 or more.
- ⚠️ Sales tax: TrailBook doesn't work out Connecticut sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Connecticut DRS, TPG-211, 2026 Withholding Calculation Rules (Rev. 12/25) (Tables A to E by withholding code A, B, C, D and F; steps 1 to 16); Connecticut DRS, 2026 Withholding Tables (weekly) (checks of the calculation: $807 to $817 a week is $28.56 for code A and $31.73 for code D); Connecticut DRS, IP 2026(1), Connecticut Employer's Tax Guide (Circular CT) (no CT-W4: 6.99% with no exemption; weekly remitters (over $10,000 last year) by the Wednesday after the Saturday-to-Friday week; monthly ($2,000 to $10,000) by the 15th; quarterly ($2,000 or less); CT-941 by the last day of the month after the quarter); Connecticut Department of Labor, Information on Unemployment Tax Rate for Calendar Year 2026 ($27,000 wage base; 1.9% new-employer rate; 1.0% fund solvency tax rate); Connecticut Paid Leave Authority, as reported by payroll publishers (0.5% employee contribution up to the Social Security wage base ($184,500)); Core-CT notice, minimum wage increase (January 2, 2026); Connecticut DOL Paid Sick Leave guidance (C.G.S. 31-57r) ($16.94 minimum wage from January 1, 2026; 1 hour of paid sick leave per 30 worked, up to 40 a year, for employers with 11 or more employees from 2026).

### Iowa (us-ia 2026.1, `src/rules/us-ia-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | 3.8% of the year's wages less $13,000 (other), $19,500 (head of household) or $26,000 (married, spouse not working), less $40 an IA W-4 allowance, divided by the pay periods | ⚠️ check |
| Iowa withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $120,000; quarterly withholding return | ⚠️ check |
| Iowa UI deposits | Quarterly with the quarterly contribution and payroll report | ⚠️ check |
| Iowa UI (IA_UI, employer, IWD) | 1% default; employer enters its own rate, on the first $20,400 | ⚠️ check |
| Quarterly report | Iowa Quarterly Withholding Tax Return | ⚠️ check |
| Quarterly report | Iowa Quarterly Contribution and Payroll Report | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 15 days to Iowa Centralized Employee Registry | ⚠️ check |

- ⚠️ IA W-4 marital status: "Other" (or married filing jointly with a working spouse, or not given), head of household, or married filing jointly with a spouse who has no earned income (or qualifying surviving spouse).
- ⚠️ Allowances: the 2024 and later IA W-4 asks for a dollar total allowance amount (normally $40 for each person and dependent claimed). TrailBook asks for the number of $40 allowances, so enter the IA W-4 total ÷ 40. An older (2023 or earlier) IA W-4 counts allowances directly, at $40 each, the same way. ⚠️ check: an older IA W-4's "single" uses the $13,000 deduction and "married" the $26,000 one; pick those statuses for employees who haven't refiled.
- ⚠️ No IA W-4 on file: "Other" with no allowances.
- ⚠️ Deposits: TrailBook shows Iowa withholding monthly, due the 15th of the next month, and for employers with more than $120,000 last year on the federal deposit dates. Iowa's own dates differ a little: the third month of each quarter is paid with the quarterly return at the end of the next month, and semimonthly filers pay by the 25th and the 10th. Quarterly filers (under $6,000 a year) can pay later than shown.
- ⚠️ UI rates are per employer: enter yours from the Iowa Workforce Development rate notice. New employers pay 1.0%. The 2026 wage base fell to $20,400 (it rises to $21,100 in 2027).
- ⚠️ Sales tax: TrailBook doesn't work out Iowa sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Iowa Department of Revenue, Iowa Withholding Formula, effective January 1, 2026 (released November 2025) (deductions $13,000 / $19,500 / $26,000 a year by IA W-4 marital status; 3.8% rate; allowance amount off the tax; $40 per allowance on 2023 and earlier IA W-4s; examples 1 to 3 ($59.26, $38.72, $45.15)); Iowa Department of Revenue, Iowa Withholding Tax Information and Filing Frequency and Return Due Dates pages (no IA W-4: an allowance amount of zero (701 IAC 307.3(3)"a"); quarterly under $6,000 a year; monthly $6,000 to $120,000 by the 15th for the first two months of a quarter; semimonthly over $120,000); Iowa Workforce Development 2026 rates, as reported by Bloomberg Tax ($20,400 wage base (down from $39,500); 1.0% new-employer rate); Iowa Code 91D.1 (minimum wage $7.25); Iowa Code 252G.3 (new hire reporting within 15 days); no state paid sick leave law ($7.25 minimum wage; report new hires within 15 days).

## Seventh round of states: us-ar, us-de, us-ks, us-ms, us-nd, us-mt, us-nm, us-ri, us-vt, us-wv 2026.1, released 2026-10-29

Ten of the last fourteen (thirteen states and DC). The first five are the ones whose agency sites can be read from here. All use the `annual_formula` method, which gained what they need: Arkansas's bracket adjustments (a table row can give the tax as taxable wages × rate less a fixed amount) and its $50 midpoint lookup, and Kansas's allowances, where the first one or two are personal exemptions worth more than the rest. Delaware adds Wilmington's 1.25% earned income tax (ticked for each employee) and Delaware Paid Leave (employee and employer shares the employer enters). North Dakota has no certificate of its own and follows the federal W-4 filing status. Greg approved all ten on 2026-10-29 and they are `released`, knowing the five secondary-source packs are unverified; the ⚠️ notes below stay as the known limits, and the daily rule watch should re-check every ⚠️ figure against the agency's own document once its site can be reached.

Tested against each publication's own examples: Arkansas's $2,127 monthly example ($36.50), Delaware's Employer's Guide supplemental wage examples ($774, $387 and $1,043.63 a year), Kansas's $2,000 semi-monthly married example ($41.43 against the guide's per-period $41.44) and its single wage bracket table, Mississippi's 2026 flowchart, and North Dakota's 2026 weekly wage bracket table for all three statuses. In the app, each state was added to a new company, an employee entered and a pay run previewed with no errors (the packs were set to released only for that check).

Read from the agencies' own documents on 2026-10-29: Arkansas's revised 2026 formula, employer's instructions and AR4EC; Delaware's Employer's Guide; Kansas's KW-100, percentage tables, wage bracket tables and K-4; Mississippi's 2026 computer payroll flowchart and Pub 89-700; North Dakota's 2026 withholding booklet and withholding guideline. From payroll publishers or secondary sources (the agency pages are blocked from here or don't state them): every UI wage base and new-employer rate except Kansas's (from the Legislative Research Department), and Delaware Paid Leave. Montana, New Mexico, Rhode Island, Vermont and West Virginia (after the first five below) are drafted only from secondary sources: search results quoting the agencies' 2026 tables, the USDA National Finance Center's state bulletins and payroll publishers, because their agency sites can't be reached from here. Their tests check the formulas against the few figures those sources print, not against agency examples, and every figure is ⚠️ until it is checked against the agency's own document. Still to come: Hawaii, Maine, Nebraska and DC, where the secondary sources disagree or leave out whole tables.

### Arkansas (us-ar 2026.1, `src/rules/us-ar-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less the $2,470 standard deduction, looked up at the $50 midpoint of each $100 below $100,001; 0% to $5,599, then rate less adjustment: 2% less $111.98, 3% less $223.97, 3.4% less $287.97, 3.7% less $367.16, with the adjustment falling $10 a $100 from $94,701 ($369.90) to $97,601 ($79.90); rounded to the dollar, less $29 an AR4EC exemption, divided by the pay periods; no AR4EC means no exemptions | ⚠️ check |
| Arkansas withholding deposits | Monthly by the 15th of the next month; AR941M | ⚠️ check |
| Arkansas UI deposits | Quarterly with the DWS-ARK-209B | ⚠️ check |
| Arkansas UI (AR_UI, employer, Arkansas DWS) | 2% default; employer enters its own rate, on the first $7,000 | ⚠️ check |
| Quarterly report | Employer's Quarterly Contribution Report (DWS-ARK-209B) | ⚠️ check |
| Minimum wage | $11.00 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to Arkansas New Hire Reporting Center | ⚠️ check |

- ⚠️ Arkansas cut its top rate to 3.7% back to January 1, 2026; the DFA reissued the formula in May 2026 under the same 01/01/2026 date. TrailBook uses the revised formula for the whole year.
- ⚠️ AR4EC: the total exemptions (line 3), each a $29 credit. Filing status doesn't change the formula. No AR4EC on file: no exemptions, as the form says.
- ⚠️ check: AR4EC line 5 (low-income tax rates) isn't supported yet. TrailBook withholds at the regular rates for employees who tick it, which withholds more than the low-income tables would.
- ⚠️ Deposits: TrailBook shows Arkansas withholding monthly (AR941M), due the 15th of the next month. Accounts the DFA moves to annual filing (deposits under $1,000) can pay by January 31 instead, later than shown.
- ⚠️ UI rates are per employer: enter yours from the Division of Workforce Services rate notice. ⚠️ check: the $7,000 wage base and 2.0% new-employer rate are from payroll publishers; dws.arkansas.gov isn't reachable from here.
- ⚠️ Sales tax: TrailBook doesn't work out Arkansas sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Arkansas DFA, Withholding Tax Formula Method, effective 01/01/2026 (revised May 2026) ($2,470 standard deduction; $50 midrange lookup below $100,001; 0% to $5,599, 2% less $111.98, 3% less $223.97, 3.4% less $287.97, 3.7% less $367.16 from $26,400, then the adjustment falls $10 for each $100 from $94,701 ($369.90) to $97,601 ($79.90); round the year's tax; $29 credit per AR4EC exemption; the $2,127 monthly example ($36.50)); Arkansas DFA, Withholding Tax Employer's Instructions (revised 4/27/26) and Form AR4EC (R 12/04/2025) (monthly AR941M by the 15th of the next month for all new accounts; annual AR941A by January 31 once deposits are under $1,000; AR3MAR by February 28; no AR4EC means no exemptions; low-income tax rates by election on AR4EC line 5); Payroll publishers on Arkansas Division of Workforce Services 2026 rates (dws.arkansas.gov isn't reachable from here) ($7,000 wage base; 2.0% new-employer rate including the administrative assessment); Ark. Code 11-4-210 (minimum wage $11.00); Ark. Code 11-10-904 (new hire reporting); no state paid sick leave law ($11.00 minimum wage; report new hires within 20 days).

### Delaware (us-de 2026.1, `src/rules/us-de-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $3,250 (single or married separately) or $6,500 (married jointly); 0% to $2,000, 2.2% to $5,000, 3.9% to $10,000, 4.8% to $20,000, 5.2% to $25,000, 5.55% to $60,000, 6.6% above; less $110 an exemption; divided by the pay periods; no DE W-4 means single with none | ⚠️ check |
| Lives or works in Wilmington (WILM_EIT, City of Wilmington) | 1.25% of wages | ⚠️ check |
| Delaware withholding deposits | Monthly by the 15th of the next month; weekly (by the third business day after the week's Friday) when last year's withholding was over $33,460; W-1 | ⚠️ check |
| Wilmington earned income tax deposits | Quarterly with the Wilmington W-1 | ⚠️ check |
| Delaware Paid Leave contributions deposits | Quarterly with the Paid Leave wage report | ⚠️ check |
| Delaware UI deposits | Quarterly with the UC-8 | ⚠️ check |
| Delaware Paid Leave (employee) (DE_PL_EE, employee, Delaware DOL) | 0.4% default; employer enters its own rate, on the first $184,500 | ⚠️ check |
| Delaware Paid Leave (employer) (DE_PL_ER, employer, Delaware DOL) | 0.4% default; employer enters its own rate, on the first $184,500 | ⚠️ check |
| Delaware UI (DE_UI, employer, Delaware DOL) | 1% default; employer enters its own rate, on the first $14,500 | ⚠️ check |
| Quarterly report | Employer's Quarterly Contribution Report (UC-8) | ⚠️ check |
| Quarterly report | Delaware Paid Leave quarterly wage report | ⚠️ check |
| Minimum wage | $15.00 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to Delaware New Hire Reporting | ⚠️ check |

- ⚠️ check: the 6.6% top bracket from $60,000 isn't reached by the Employer's Guide examples (the rate tables are on revenuefiles.delaware.gov, which isn't reachable from here); it matches Delaware's income tax rates.
- ⚠️ DE W-4: single (also married filing separately) or married filing jointly, and the number of exemptions, each a $110 credit off the year's tax. ⚠️ check: with no DE W-4 on file TrailBook uses single with no exemptions.
- ⚠️ Wilmington: tick it for employees who live in Wilmington or work there; TrailBook withholds 1.25% of wages and shows one quarterly payment to the City of Wilmington. ⚠️ check: Wilmington's own filing frequency.
- ⚠️ Delaware Paid Leave: 0.4% employee and 0.4% employer by default (0.8% split evenly, for 25 or more employees). Employers with 10 to 24 employees pay 0.32% (only parental leave); under 10, nothing. Enter your shares in payroll settings; an employer that pays it all enters 0% for the employee share. ⚠️ check: whether TrailBook should let the employee share follow headcount automatically.
- ⚠️ Deposits: TrailBook shows Delaware withholding monthly (W-1), due the 15th of the next month, and weekly for employers who withheld more than $33,460 in the July-June lookback. Delaware's eighth-monthly periods are due three business days after each period ends, so the weekly dates are close but not exact. Employers who withheld $6,020 or less pay quarterly (W-1Q), later than shown.
- ⚠️ UI rates are per employer: enter yours from the Delaware DOL rate notice. ⚠️ check: the $14,500 wage base and 1.0% new-employer rate are from payroll publishers.
- ⚠️ check: the Paid Leave rates and headcount tiers are from payroll publishers.
- ⚠️ Sales tax: Delaware has no sales tax.

Sources: Delaware Division of Revenue, Employer's Guide (Withholding Regulations and Employer's Duties), revenue.delaware.gov (annualized wages less $3,250 (single or married filing separately) or $6,500 (married filing jointly); the supplemental wage examples ($884 tax on $22,750, $1,153.63 on $27,750, $717 on $19,500 married) that fix the 0% / 2.2% / 3.9% / 4.8% / 5.2% / 5.55% / 6.6% brackets; $110 credit per allowance; quarterly up to $6,020 withheld in the July-June lookback, monthly by the 15th to $33,460, eighth-monthly above); Payroll publishers on Delaware DOL 2026 rates and Delaware Paid Leave (labor.delaware.gov pages read didn't state them) ($14,500 wage base; 1.0% new-employer rate; Paid Leave 0.8% for 25 or more employees (up to half from employees), 0.32% for 10 to 24, none under 10, up to the Social Security wage base); 19 Del. C. 902 (minimum wage $15.00 from January 1, 2025); Wilmington earned income tax 1.25%; no state paid sick leave law ($15.00 minimum wage; Wilmington 1.25%; report new hires within 20 days).

### Kansas (us-ks 2026.1, `src/rules/us-ks-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less the K-4 allowances ($9,160 for the first, two at the Joint rate; $2,320 for each other) and $3,605 (Single) or $8,240 (Joint); 5.2% to $23,000 ($46,000 Joint), 5.58% above; divided by the pay periods; no K-4 means Single with none | ⚠️ check |
| Kansas withholding deposits | Monthly by the 15th of the next month; KW-5 | ⚠️ check |
| Kansas UI deposits | Quarterly with the K-CNS 100 | ⚠️ check |
| Kansas UI (KS_UI, employer, Kansas DOL) | 1.75% default; employer enters its own rate, on the first $15,100 | ⚠️ check |
| Quarterly report | Employer's Quarterly Wage Report and Unemployment Tax Return (K-CNS 100) | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to Kansas New Hire Directory | ⚠️ check |

- ⚠️ K-4: the allowance rate (Single or Joint) and the total allowances on line 4. TrailBook values the first allowance at $9,160 (two at the Joint rate) and the rest at $2,320, as the KW-100 wage bracket tables do. No K-4 on file: Single with no allowances, as the K-4 says.
- ⚠️ TrailBook works out the year's tax from the annual amounts; the guide's per-period tables round the brackets, so results can differ by a cent or two. The guide allows rounding to the dollar; TrailBook keeps cents.
- ⚠️ Deposits: TrailBook shows Kansas withholding monthly (KW-5), due the 15th of the next month. The Department assigns the frequency: employers withholding over $8,000 a year pay semi-monthly or quad-monthly, earlier than shown, and those under $1,200 can pay quarterly or yearly, later.
- ⚠️ UI rates are per employer: enter yours from the Kansas Department of Labor rate notice. New employers pay 1.75% (construction 5.55%). ⚠️ check: the $15,100 wage base comes from the Legislative Research Department; www.dol.ks.gov isn't reachable from here.
- ⚠️ Sales tax: TrailBook doesn't work out Kansas sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Kansas Department of Revenue, KW-100 Withholding Tax Guide (Rev. 10-24) and Tables for Percentage Method of Kansas Withholding (wages paid on and after July 1, 2024) (allowances $9,160 (single), $18,320 (joint), $2,320 per dependent or head of household allowance; zero bracket and 5.2% / 5.58% per payroll period (annual: single $3,605 then $23,000 of 5.2%, married $8,240 then $46,000); the $2,000 semi-monthly married example ($41.44); may round to the dollar; no K-4 means Single with no allowances); Same guide, Filing Frequencies and Due Dates (annual up to $200 a year, quarterly to $1,200 (25th after the quarter), monthly to $8,000 (15th of the next month), semi-monthly to $100,000, quad-monthly above); Kansas Legislative Research Department, Kansas Unemployment Insurance Trust Fund (August 2026) ($15,100 wage base for 2026; new employers 1.75% (construction 5.55%)); K.S.A. 44-1203 (minimum wage follows the $7.25 federal rate); K.S.A. 39-7,119 (new hire reporting); no state paid sick leave law ($7.25 minimum wage; report new hires within 20 days).

### Mississippi (us-ms 2026.1, `src/rules/us-ms-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less the 89-350 exemption ($6,000 single, $9,500 head of family, $12,000 married, $1,500 a dependent) and standard deduction ($2,300 / $3,400 / $4,600); 0% on the first $10,000, 4% above; divided by the pay periods and rounded to the dollar; no 89-350 means no exemption | ⚠️ check |
| Mississippi withholding deposits | Monthly by the 15th of the next month; 89-105 | ⚠️ check |
| Mississippi UI deposits | Quarterly with the UI-2/UI-3 | ⚠️ check |
| Mississippi UI (MS_UI, employer, MDES) | 1% default; employer enters its own rate, on the first $14,000 | ⚠️ check |
| Quarterly report | Employer's Quarterly Contribution and Wage Report (UI-2/UI-3) | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 15 days to Mississippi New Hire Reporting | ⚠️ check |

- ⚠️ Form 89-350 status: single ($6,000 exemption, $2,300 standard deduction), head of family ($9,500, $3,400), married with a spouse who doesn't work ($12,000, $4,600), or married with a working spouse ($6,000 each by default, $2,300). Dependents, age and blindness are $1,500 each. ⚠️ check: the 89-350 asks for a dollar total of exemptions (line 6); TrailBook asks for the status and the number of $1,500 extras, so working spouses who split the $12,000 unevenly can't be entered exactly.
- ⚠️ No 89-350 on file: zero exemption, as Pub 89-700 says, with the $2,300 single standard deduction. ⚠️ check: the publication doesn't say which standard deduction applies then.
- ⚠️ Deposits: TrailBook shows Mississippi withholding monthly, due the 15th of the next month. The Department of Revenue assigns each employer its frequency; quarterly filers pay by the 15th of the month after the quarter, later than shown.
- ⚠️ UI rates are per employer: enter yours from the MDES rate notice. ⚠️ check: the $14,000 wage base and the 1.0% new-employer rate (1.1% in the second year, 1.2% in the third) are from payroll publishers.
- ⚠️ Sales tax: TrailBook doesn't work out Mississippi sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Mississippi DOR, Computer Payroll Accounting - For Periods In 2026 (revised 8/13/25) (standard deduction $2,300 single or married with both spouses employed, $3,400 head of family, $4,600 married with one spouse employed; taxable income less the 89-350 line 6 exemption; 0% on the first $10,000 and 4% above; round to whole dollars); Mississippi DOR, Pub 89-700-25-1 (revised January 13, 2026) (exemptions $6,000 single, $9,500 head of family, $12,000 married (divided between working spouses), $1,500 per dependent, age or blindness; no 89-350 means zero exemption; filing frequency assigned by the Department; monthly returns by the 15th of the next month, quarterly by the 15th of the month after the quarter); Payroll publishers on MDES 2026 rates (the MDES site doesn't state them) ($14,000 wage base; 1.0% new-employer rate (1.1% second year, 1.2% third)); Mississippi has no state minimum wage or paid sick leave law; Miss. Code 71-3-... new hire reporting (federal $7.25 minimum wage; report new hires within 15 days).

### North Dakota (us-nd 2026.1, `src/rules/us-nd-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | By the federal W-4 status: the year's wages, 0% to $57,625 single ($57,500 married jointly, $78,475 head of household), 1.95% to $258,450 ($168,525, $289,675), 2.5% above; divided by the pay periods and rounded to the dollar | ⚠️ check |
| North Dakota withholding deposits | Quarterly with the Form 306 | ⚠️ check |
| North Dakota UI deposits | Quarterly with the UI contribution and wage report | ⚠️ check |
| North Dakota UI (ND_UI, employer, Job Service North Dakota) | 1% default; employer enters its own rate, on the first $46,600 | ⚠️ check |
| Quarterly report | Income Tax Withholding Return (Form 306) | ⚠️ check |
| Quarterly report | Quarterly Contribution and Wage Report | ⚠️ check |
| Minimum wage | $7.25 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to North Dakota New Hire Reporting Center | ⚠️ check |

- ⚠️ North Dakota has no withholding certificate of its own; TrailBook uses the filing status on the employee's federal W-4 (Step 1(c)). Employees still on a pre-2020 W-4 should be asked for a current one: TrailBook doesn't use the booklet's Section 1 allowance tables.
- ⚠️ check: the booklet's single-filer example ($1,800 weekly, $734 a year) doesn't match its own 2026 table, which gives $701.51 a year ($13 a week); the 2026 wage bracket table agrees with the annual table, so TrailBook follows the table.
- ⚠️ Deposits: TrailBook shows North Dakota withholding quarterly with Form 306, due the last day of the month after the quarter. Employers who withheld under $1,000 last year can file once a year by January 31 instead.
- ⚠️ UI rates are per employer: enter yours from the Job Service North Dakota rate notice. ⚠️ check: the $46,600 wage base and the 1.00% new-employer rate are from Bloomberg Tax and payroll publishers.
- ⚠️ Sales tax: TrailBook doesn't work out North Dakota sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: North Dakota Office of State Tax Commissioner, 2026 Income Tax Withholding Rates and Instructions, Section 2 (Annual Percentage Method Tables and weekly wage bracket table, Forms W-4 for 2020 and after) (single 0% to $57,625, 1.95% to $258,450 ($3,916.09), 2.5% above; married filing jointly $57,500 and $168,525 ($2,164.99); head of household $78,475 and $289,675 ($4,118.40); filing status from the federal W-4 Step 1(c), single with no W-4; round to the nearest dollar); Same Office, Guideline – Income Tax Withholding and Information Returns (Form 306 quarterly by the last day of the month after the quarter; annual filing by January 31 for employers who withheld under $1,000 the year before and filed on time); Bloomberg Tax and payroll publishers on Job Service North Dakota 2026 rates ($46,600 wage base; 1.00% new-employer rate (construction 9.67%)); N.D.C.C. 34-06-22 (minimum wage follows the $7.25 federal rate); N.D.C.C. 50-09-02.2 (new hire reporting); no state paid sick leave law ($7.25 minimum wage; report new hires within 20 days).

### Montana (us-mt 2026.1, `src/rules/us-mt-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $16,100 (single), $32,200 (married jointly) or $24,150 (head of household); 4.7% on the next $47,500 ($95,000, $71,250), 5.65% above; divided by the pay periods and rounded to the dollar; no MW-4 means single | ⚠️ check |
| Montana withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $12,000; withholding payment | ⚠️ check |
| Montana UI deposits | Quarterly with the UI-5 | ⚠️ check |
| Montana UI (MT_UI, employer, Montana DLI) | 1.18% default; employer enters its own rate, on the first $47,300 | ⚠️ check |
| Quarterly report | Unemployment Insurance Quarterly Report (UI-5) | ⚠️ check |
| Minimum wage | $10.85 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to Montana New Hire Reporting | ⚠️ check |

- ⚠️ check: revenue.mt.gov isn't reachable from here, so the 2026 Employer's Guide and its tables weren't read. The brackets are the federal 2026 standard deduction ($16,100 / $32,200 / $24,150) plus HB 337's 4.7% bands, which fits the Department's description and the publishers' single table; re-check the joint and head of household tables and the rounding once the site can be read.
- ⚠️ MW-4 (2026): single (or married filing separately), married filing jointly, or head of household; no allowances. ⚠️ check: with no MW-4 on file TrailBook uses single.
- ⚠️ Deposits: TrailBook shows Montana withholding monthly, due the 15th of the next month, and on the federal deposit dates for employers who withheld more than $12,000 in the lookback year. ⚠️ check: Montana's thresholds; employers withholding under $1,200 a year can pay once a year.
- ⚠️ UI rates are per employer and by industry for new employers: enter yours from the Montana Department of Labor and Industry rate notice, including the administrative fund tax. ⚠️ check: the $47,300 wage base is from payroll publishers.
- ⚠️ Montana has no sales tax.

Sources: Montana Department of Revenue, 2026 Withholding Updates news release, as quoted in search results (not read directly) (tables, Employer's Guide and MW-4 updated December 2025; top rate 5.65% from January 1, 2026; 4.7% on income up to $95,000 joint, $71,250 head of household, $47,500 other; the method now resembles the federal one); Payroll publishers' 2026 Montana tables (getuku, nationaltaxtools) (no withholding up to $16,100 single ($24,150 head of household), 4.7% to $63,600, $2,233 plus 5.65% above; MW-4 filing status, no allowances; rounded to the dollar); Payroll publishers on Montana UI 2026 ($47,300 wage base; new-employer rates by industry, about 1.18% to 2.18% with the administrative fund tax); Montana minimum wage notice (CPI-adjusted); M.C.A. 39-51-... new hire reporting; no state paid sick leave law ($10.85 minimum wage for 2026; report new hires within 20 days).

### New Mexico (us-nm 2026.1, `src/rules/us-nm-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | By the federal W-4 status: the year's wages, 0% to $8,050 single ($16,100 married), then 1.5%, 3.2%, 4.3%, 4.7%, 4.9% and 5.9% from $218,050 ($331,100); head of household uses the single table; divided by the pay periods | ⚠️ check |
| New Mexico withholding deposits | Monthly by the 25th of the next month; CRS-1 (TRD-41414) | ⚠️ check |
| New Mexico UI deposits | Quarterly with the ES-903A | ⚠️ check |
| New Mexico UI (NM_UI, employer, NM DWS) | 1% default; employer enters its own rate, on the first $34,700 | ⚠️ check |
| Quarterly report | Employer's Quarterly Wage and Contribution Report (ES-903A) | ⚠️ check |
| Minimum wage | $12.00 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | 1 hour per 30 worked, up to 64 hours a year | ⚠️ check |
| New-hire report | Within 20 days to New Mexico New Hire Reporting Center | ⚠️ check |

- ⚠️ check: every figure comes from reproductions of the FYI-104; www.tax.newmexico.gov isn't reachable from here.
- ⚠️ New Mexico follows the federal W-4 filing status. ⚠️ check: head of household employees use the single table here, because the head of household table's upper brackets weren't found; that withholds somewhat more than New Mexico's own table.
- ⚠️ Deposits: TrailBook shows New Mexico withholding monthly with the CRS-1 (TRD-41414), due the 25th of the next month. ⚠️ check: employers averaging under $500 a month can file quarterly, later than shown.
- ⚠️ UI rates are per employer: enter yours from the Department of Workforce Solutions rate notice. ⚠️ check: payroll publishers disagree on the 2026 wage base ($30,600 to $34,800); TrailBook uses $34,700.
- ⚠️ check: New Mexico's workers' compensation fee ($4.30 a quarter per employee, part paid by the employee) isn't included yet.
- ⚠️ Sales tax: TrailBook doesn't work out New Mexico gross receipts tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: NM Taxation and Revenue Department, FYI-104 (Rev. 11/2025, for wages paid from January 1, 2026), as reproduced in the USDA NFC bulletin and payroll publishers (not read directly) (single: nothing to $8,050, 1.5% to $13,550, 3.2% to $24,550, 4.3% to $41,550, 4.7% to $74,550, 4.9% to $218,050, 5.9% above; married: $16,100, $24,100, $41,100, $66,100, $116,100, $331,100; head of household from $12,075 (1.5% to $20,075, $1,739 plus 4.7% from $62,075)); Payroll publishers on New Mexico DWS 2026 UI (wage base reported as $30,600 to $34,800 (most often $34,700); new-employer rates about 1.0% by industry); N.M. Stat. 50-4-22 (minimum wage $12.00); Healthy Workplaces Act (N.M. Stat. 50-17); new hire reporting within 20 days ($12.00 minimum wage; 1 hour of sick leave per 30 worked, up to 64 hours a year).

### Rhode Island (us-ri 2026.1, `src/rules/us-ri-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $1,000 an RI W-4 exemption (none over $290,800); 3.75% to $82,050, 4.75% to $186,450, 5.99% above; divided by the pay periods; no RI W-4 means no exemptions | ⚠️ check |
| Rhode Island withholding deposits | Monthly by the 20th of the next month; weekly (by the third business day after the week's Friday) when last year's withholding was over $50,000; RI-941 | ⚠️ check |
| Rhode Island UI and TDI deposits | Quarterly with the TX-17 | ⚠️ check |
| Rhode Island TDI (RI_TDI, employee, RI DLT) | 1.1%, on the first $100,000 | ⚠️ check |
| Rhode Island UI (RI_UI, employer, RI DLT) | 1.21% default; employer enters its own rate, on the first $30,800 | ⚠️ check |
| Quarterly report | Employer's Quarterly Tax and Wage Report (TX-17) | ⚠️ check |
| Minimum wage | $16.00 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | 1 hour per 35 worked, up to 40 hours a year (balance up to 40), for employers with 18 or more employees | ⚠️ check |
| New-hire report | Within 14 days to Rhode Island New Hire Reporting Directory | ⚠️ check |

- ⚠️ check: every figure comes from search results quoting the Division of Taxation and DLT; tax.ri.gov and dlt.ri.gov aren't reachable from here.
- ⚠️ RI W-4: the number of exemptions, $1,000 each, and none once the year's wages are over $290,800. Filing status doesn't change the table. ⚠️ check: with no RI W-4 on file TrailBook uses no exemptions.
- ⚠️ TDI: 1.1% of each employee's wages up to $100,000, all from the employee, paid with the quarterly TX-17.
- ⚠️ Deposits: TrailBook shows Rhode Island withholding monthly, due the 20th of the next month, and weekly for employers who withheld $50,000 or more last year. ⚠️ check: Rhode Island's quarterly-monthly and daily schedules and thresholds.
- ⚠️ UI rates are per employer: enter yours from the DLT rate notice, including the Job Development Assessment. New employers pay 1.21%.
- ⚠️ Sick leave: employers with fewer than 18 employees must give the time but needn't pay it; TrailBook tracks paid hours only for larger employers.
- ⚠️ Sales tax: TrailBook doesn't work out Rhode Island sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: RI Division of Taxation, 2026 Employer's Income Tax Withholding Tables (percentage method, pages 9 and 10), as quoted in search results and the USDA NFC bulletin (not read directly) ($1,000 per exemption, none when annual wages are over $290,800; 3.75% to $82,050, 4.75% to $186,450, 5.99% above; one table for all statuses); RI Department of Labor and Training, TDI / TCI for Employers, as quoted in search results (2026 TDI 1.1% employee deduction on the first $100,000); Payroll publishers on RI DLT 2026 UI ($30,800 wage base ($32,300 for the highest rate group); 1.21% new-employer rate including the 0.21% Job Development Assessment); R.I. Gen. Laws 28-12-3 (minimum wage $16.00 from January 1, 2026); Healthy and Safe Families and Workplaces Act (R.I. Gen. Laws 28-57); new hire reporting within 14 days ($16.00 minimum wage; 1 hour of sick leave per 35 worked, up to 40 hours a year, paid for employers with 18 or more employees).

### Vermont (us-vt 2026.1, `src/rules/us-vt-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $5,400 a W-4VT allowance; single 0% to $3,925, 3.35%, 6.6% from $54,675, 7.6% from $126,775, 8.75% from $260,225; married from $11,775, $96,475, $216,525, $323,825; divided by the pay periods; no W-4VT means single with none | ⚠️ check |
| Vermont withholding and Child Care Contribution deposits | Monthly by the 25th of the next month; on the federal semiweekly dates when last year's withholding was over $9,000; WHT-436 | ⚠️ check |
| Vermont UI deposits | Quarterly with the C-101 | ⚠️ check |
| Vermont Child Care Contribution (employee) (VT_CCC_EE, employee, Vermont Department of Taxes) | 0.11% default; employer enters its own rate, no wage base | ⚠️ check |
| Vermont Child Care Contribution (employer) (VT_CCC_ER, employer, Vermont Department of Taxes) | 0.33% default; employer enters its own rate, no wage base | ⚠️ check |
| Vermont UI (VT_UI, employer, Vermont DOL) | 1% default; employer enters its own rate, on the first $15,400 | ⚠️ check |
| Quarterly report | Quarterly Withholding Reconciliation (WHT-436) | ⚠️ check |
| Quarterly report | Employer's Quarterly Wage and Contribution Report (C-101) | ⚠️ check |
| Minimum wage | $14.42 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | 1 hour per 52 worked, up to 40 hours a year | ⚠️ check |
| New-hire report | Within 10 days to Vermont New Hire Reporting | ⚠️ check |

- ⚠️ check: every figure comes from search results quoting the GB-1210 and from payroll publishers; tax.vermont.gov and labor.vermont.gov aren't reachable from here.
- ⚠️ W-4VT: single (also married filing separately) or married, and allowances worth $5,400 each. No W-4VT on file: single with no allowances.
- ⚠️ Child Care Contribution: 0.33% employer and 0.11% employee by default (0.44% in all, up to a quarter of it from the employee). Enter your shares in payroll settings; an employer that pays it all enters 0% for the employee share. Paid with the WHT-436 withholding return.
- ⚠️ Deposits: TrailBook shows Vermont withholding monthly, due the 25th of the next month, and on the federal deposit dates for employers who withheld more than $9,000 last year. ⚠️ check: Vermont's thresholds; employers withholding under $2,500 a year can pay quarterly.
- ⚠️ UI rates are per employer: enter yours from the Vermont DOL rate notice. New employers pay 1.0%.
- ⚠️ Sales tax: TrailBook doesn't work out Vermont sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Vermont Department of Taxes, GB-1210 (2026) percentage method tables, as quoted in search results and the USDA NFC bulletin (not read directly) ($5,400 per allowance ($103.85 weekly), no standard deduction; single: 3.35% from $3,925, 6.6% from $54,675, 7.6% from $126,775, 8.75% from $260,225; married: $11,775, $96,475, $216,525, $323,825; no W-4VT means single with no allowances); Vermont Child Care Contribution (Act 76 of 2023), payroll publishers (0.44% of wages from July 1, 2025; employers may withhold up to 0.11% from employees); Payroll publishers on Vermont DOL 2026 UI ($15,400 wage base; 1.0% new-employer rate); 21 V.S.A. 384 (minimum wage $14.42 for 2026); 21 V.S.A. 481 to 487 (earned sick time); new hire reporting within 10 days ($14.42 minimum wage; 1 hour of earned sick time per 52 worked, up to 40 hours a year).

### West Virginia (us-wv 2026.1, `src/rules/us-wv-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $2,000 an IT-104 exemption; two-earner table 2.11% to $7,500, 2.81%, 3.16%, 4.22%, 4.58% above $45,000 (one-earner: $10,000, $25,000, $40,000, $60,000); divided by the pay periods and rounded to the dollar | ⚠️ check |
| West Virginia withholding deposits | Monthly by the 15th of the next month; IT-101V | ⚠️ check |
| West Virginia UI deposits | Quarterly with the WVUC-A-154 | ⚠️ check |
| West Virginia UI (WV_UI, employer, WorkForce West Virginia) | 2.7% default; employer enters its own rate, on the first $9,500 | ⚠️ check |
| Quarterly report | Employer's Quarterly Contribution and Wage Report (WVUC-A-154) | ⚠️ check |
| Minimum wage | $8.75 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 14 days to West Virginia New Hire Reporting Center | ⚠️ check |

- ⚠️ check: every figure comes from search results quoting the IT-100.2A; tax.wv.gov and workforcewv.org aren't reachable from here. The two-earner table's middle brackets ($18,750 and $30,000) are worked out as three quarters of the one-earner ones, matching its known $7,500 and $45,000 edges; they weren't seen in a source.
- ⚠️ IT-104: exemptions ($2,000 each) and line 5 (one earner, a lower withholding table). No IT-104 on file: the two-earner table with no exemptions.
- ⚠️ Deposits: TrailBook shows West Virginia withholding monthly, due the 15th of the next month. ⚠️ check: smaller employers may file quarterly or yearly, and December's payment is due with the annual return.
- ⚠️ check: city service fees (Charleston, Huntington and others charge a few dollars a week) aren't included yet.
- ⚠️ UI rates are per employer: enter yours from the WorkForce West Virginia rate notice. New employers pay 2.7%.
- ⚠️ Sales tax: TrailBook doesn't work out West Virginia sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: WV Tax Division, IT-100.2A Tables for Percentage Method of Withholding (March 2026), as quoted in search results and the USDA NFC bulletin (not read directly) ($2,000 per exemption; one-earner: 2.11% to $10,000, 2.81% to $25,000, 3.16% to $40,000, 4.22% to $60,000, 4.58% above; two-earner: 2.11% to $7,500 ($158.25), then 2.81%, 3.16% and 4.22%, 4.58% above $45,000; the two-earner table unless IT-104 line 5 is checked; round to the dollar); Payroll publishers on WorkForce West Virginia 2026 UI ($9,500 wage base; 2.7% new-employer rate); W. Va. Code 21-5C-2 (minimum wage $8.75); no state paid sick leave law; new hire reporting within 14 days ($8.75 minimum wage).

## Eighth round of states: us-hi, us-ne 2026.1, released 2026-10-29

Two of the last four. Both are drafted from the agencies' own booklets, read on 2026-10-29 once Greg allowed the sites: Hawaii's Booklet A (Rev. 2025) and Nebraska's 2026 Circular EN. Both use the `annual_formula` method with the table rows written as "rate less a fixed amount", so the published base amounts come out exactly. Hawaii adds TDI (the employee's share, at most $7.50 a week, paid to the employer's TDI carrier). Greg approved both on 2026-10-29 and they are `released`; the ⚠️ notes below stay as the known limits for the daily rule watch.

Tested against each publication's own examples and tables: Hawaii's $500 weekly example with three allowances ($9.58), and the single and married annual tables at their bracket edges ($859.00 and $16,782.00); Nebraska's Table 7 at its bracket edges for single ($905.15 on $30,000 with no W-4N) and married with two allowances ($2,932.22). In the app, each state was added to a new company, an employee entered and a pay run previewed with no errors (the packs were set to released only for that check).

From payroll publishers or secondary sources (the agency pages are blocked from here or don't state them): Hawaii's and Nebraska's UI wage bases and new-employer rates. Still to come: Maine and DC, whose withholding tables can't be read from here; they wait for Greg to upload the PDFs.

### Hawaii (us-hi 2026.1, `src/rules/us-hi-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | Booklet A annual percentage method: the year's wages less the $4,350 lump sum and $1,144 an HW-4 allowance; single (and married withholding at the single rate) 1.4% to $9,600, then 3.2%, 5.5%, 6.4%, 6.8%, 7.2%, 7.6% and 7.9% over $125,000 ($8,391 base); married 1.4% to $19,200, then the same rates to 7.9% over $250,000 ($16,782 base); divided by the pay periods; no HW-4 means single with no allowances | ⚠️ check |
| Hawaii withholding deposits | Monthly by the 15th of the next month; on the federal semiweekly dates when last year's withholding was over $40,000; VP-1 | ⚠️ check |
| Hawaii TDI premiums deposits | Quarterly with the carrier premium statement | ⚠️ check |
| Hawaii UI deposits | Quarterly with the UC-B6 | ⚠️ check |
| Hawaii TDI (HI_TDI, employee, TDI carrier) | 0.5%, no wage base | ⚠️ check |
| Hawaii UI (HI_UI, employer, Hawaii DLIR) | 2.41% default; employer enters its own rate, on the first $64,500 | ⚠️ check |
| Quarterly report | Withholding Tax Return (HW-14) | ⚠️ check |
| Quarterly report | Quarterly Wage, Contribution and Employment and Training Assessment Report (UC-B6) | ⚠️ check |
| Minimum wage | $16.00 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | No state law | ⚠️ check |
| New-hire report | Within 20 days to Hawaii New Hire Reporting Center | ⚠️ check |

- ⚠️ HW-4: single, married, or married but withholding at the higher single rate (also for unmarried heads of household), and the number of allowances, $1,144 each. Every employee also gets the $4,350 lump sum allowance. No HW-4 on file: single with no allowances, as the booklet says.
- ⚠️ The annual table's base amounts are rounded (for example $134 rather than $134.40), and TrailBook uses them exactly, so it matches the booklet's example ($9.58 a week).
- ⚠️ TDI: TrailBook takes 0.5% of wages from the employee, at most $7.50 a week, and pays it to your TDI carrier. ⚠️ check: if your plan's premium is less than 1% of wages, the employee's half is less too; enter your plan's rate if TrailBook should take less. Employers may also pay it all.
- ⚠️ check: Hawaii's Prepaid Health Care Act (employee share up to 1.5% of wages) isn't included.
- ⚠️ Deposits: TrailBook shows Hawaii withholding monthly (VP-1), due the 15th of the next month, and on the federal semi-weekly dates for employers who withheld over $40,000 last year. Employers withholding $5,000 or less a year can pay quarterly, later than shown.
- ⚠️ UI rates are per employer: enter yours from the DLIR rate notice, including the 0.01% Employment and Training assessment. ⚠️ check: the $64,500 wage base and 2.4% new-employer rate are from Bloomberg Tax and the DLIR table as quoted in search results.
- ⚠️ Sales tax: TrailBook doesn't work out Hawaii general excise tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Hawaii Department of Taxation, Booklet A Employer's Tax Guide (Rev. 2025), Appendix Part 1, Annualized Income Tax Withholding (effective December 5, 2025 for withholding January 1, 2026 and after) ($1,144 per HW-4 allowance; $4,350 extra lump sum allowance; annual tables single (including unmarried heads of household) 1.4% to $9,600, $134 + 3.2% to $14,400, $288 + 5.5% to $19,200, $552 + 6.4% to $24,000, $859 + 6.8% to $36,000, $1,675 + 7.2% to $48,000, $2,539 + 7.6% to $125,000, $8,391 + 7.9% above; married at twice the brackets ($269, $576, $1,104, $1,718, $3,350, $5,078, $16,782); the $500 weekly example ($9.58)); Same booklet, Sections 3 and 6 (VP-1 quarterly by the 15th after the quarter up to $5,000 a year, monthly by the 15th to $40,000, semi-weekly above or when federal deposits are semi-weekly; no HW-4 means single with no allowances; the federal W-4 can't be used); Hawaii DLIR Disability Compensation Division, 2026 Maximum Weekly Wage Base (TDI: employee share up to half the premium, at most 0.5% of weekly wages up to $1,500.21 ($7.50 a week)); Hawaii DLIR UI 2026 contribution rates, as reported by Bloomberg Tax and the DLIR table quoted in search results ($64,500 wage base; 2.4% new-employer rate; Employment and Training assessment 0.01%); HRS 387-2 (minimum wage $16.00 from January 1, 2026); no state paid sick leave law; new hire reporting within 20 days ($16.00 minimum wage).

### Nebraska (us-ne 2026.1, `src/rules/us-ne-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | Circular EN annual percentage method: the year's wages less $2,440 a W-4N allowance; single 0% to $3,430, then 2.26%, 3.22%, 4.21%, 4.35%, 4.48% and 4.6% over $75,370 ($2,922.30 base); married 0% to $8,190, then the same rates to 4.6% over $82,920 ($2,932.22 base); divided by the pay periods; no W-4N means single with no allowances | ⚠️ check |
| Nebraska withholding deposits | Monthly by the 15th of the next month; 501N / 941N | ⚠️ check |
| Nebraska UI deposits | Quarterly with the UI-11T | ⚠️ check |
| Nebraska UI (NE_UI, employer, Nebraska DOL) | 1.25% default; employer enters its own rate, on the first $9,000 | ⚠️ check |
| Quarterly report | Nebraska Income Tax Withholding Return (941N) | ⚠️ check |
| Quarterly report | Combined Tax Report (UI-11T) | ⚠️ check |
| Minimum wage | $15.00 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | 1 hour per 30 worked, up to 40 hours a year, for employers with 11 or more employees | ⚠️ check |
| New-hire report | Within 20 days to Nebraska New Hire Reporting | ⚠️ check |

- ⚠️ W-4N: single (also head of household) or married, and the number of allowances, $2,440 each. No W-4N on file: single with no allowances, as the Circular says. Employees with a federal W-4 from before 2020 who never filed a W-4N keep their federal status and allowances; enter them here.
- ⚠️ The annual table's base amounts are used exactly, so TrailBook matches Table 7.
- ⚠️ check: Nebraska's 1.5% minimum withholding rule isn't applied automatically. When TrailBook's amount is under 1.5% of wages (usually employees claiming many allowances), the Circular asks for at least half of what a single employee with one allowance (married, two) would have withheld; add the difference as extra withholding.
- ⚠️ Deposits: TrailBook shows Nebraska withholding monthly, due the 15th of the next month (Form 501N or EFT). Employers who withhold $500 or less in a month can wait for the quarterly Form 941N (the last day of the month after the quarter), so TrailBook may show a date earlier than needed.
- ⚠️ UI rates are per employer: enter yours from the Nebraska DOL rate notice. ⚠️ check: the $9,000 wage base and 1.25% new-employer rate; dol.nebraska.gov isn't reachable from here.
- ⚠️ check: paid sick time applies to employers with 11 or more employees after the 2025 amendments; Lincoln's local minimum wage rules (from July 18, 2026) aren't included.
- ⚠️ Sales tax: TrailBook doesn't work out Nebraska sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Nebraska Department of Revenue, 2026 Nebraska Circular EN (8-429-1998 Rev. 11-2025), Percentage Method and Table 7 (annual payroll period) ($2,440 per W-4N allowance; single (including head of household) nothing to $3,430, 2.26% to $6,710, $74.13 + 3.22% to $21,810, $560.35 + 4.21% to $31,610, $972.93 + 4.35% to $40,130, $1,343.55 + 4.48% to $75,370, $2,922.30 + 4.6% above; married (including surviving spouse) $8,190, $13,010 ($108.93), $32,400 ($733.29), $50,400 ($1,491.09), $62,530 ($2,018.75), $82,920 ($2,932.22); withholding below 1.5% of wages must be raised to at least half of what a single employee with one allowance (married, two) would have withheld; no W-4N means single with no allowances); Same Circular, Filing and Deposit Requirements (monthly deposits (Form 501N or EFT) by the 15th once more than $500 is withheld in the first or second month of a quarter; Form 941N by the last day of the month after the quarter; annual filers by January 31; W-3N by January 31); Nebraska DOL 2026 UI (dol.nebraska.gov isn't reachable from here) ($9,000 wage base ($24,000 for employers at the highest rate); 1.25% new-employer rate); Neb. Rev. Stat. 48-1203 (minimum wage $15.00 from January 1, 2026); Paid Sick Time Act (Initiative 436, effective October 1, 2025, as amended in 2025); new hire reporting within 20 days ($15.00 minimum wage; 1 hour of paid sick time per 30 worked, up to 40 hours a year for employers with 11 or more employees).

## Ninth round: us-me, us-dc 2026.1, released 2026-10-29

The last two, from documents Greg uploaded on 2026-10-29 because both agencies' sites block access from here. Maine is built from Maine Revenue Services' own 2026 withholding tables booklet (revised August 2026 for the larger standard deduction and the new 2% surcharge). DC's rate schedule is from OTR's own rates page, but its withholding method (the year's wages less $4,150 a D-4 allowance) comes from a payroll publisher's 2026 page, so it is ⚠️ until OTR's own withholding instructions can be read. Both use the `annual_formula` method; Maine's shrinking standard deduction uses the existing phase-out option and its surcharge is a top table row. Greg approved both on 2026-10-29 and they are `released`; the ⚠️ notes below stay as the known limits, and the daily rule watch should recheck DC's withholding method against OTR's own 2026 withholding instructions once they can be read. With these two, every state and DC has a pack.

Tested against the Maine booklet's three examples ($0, $32 and $256 a week, the last with the shrinking married deduction), Maine's surcharge, and DC's schedule at two points. In the app, each was added to a new company, an employee entered and a pay run previewed with no errors (the packs were set to released only for that check).

From payroll publishers or secondary sources: both UI wage bases and new-employer rates, Maine Paid Family and Medical Leave, DC Universal Paid Leave, DC sick leave tiers and DC's withholding method.

### Maine (us-me 2026.1, `src/rules/us-me-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | Percentage method: the year's wages less $5,300 a W-4ME allowance and the withholding standard deduction ($12,850 single to $102,250 of wages, $28,550 married to $204,550, shrinking to nothing at $177,250 / $354,550); single 5.8% to $27,400, $1,589 + 6.75% to $64,850, $4,117 + 7.15% above; married $54,850 ($3,181) and $129,750 ($8,237); plus 2% over $1,000,000 ($1,500,000 married); divided by the pay periods and rounded to the dollar; no W-4ME means single with no allowances | ⚠️ check |
| Maine withholding deposits | On the federal deposit dates when last year's average quarter was over $4,500, otherwise quarterly; 941ME | ⚠️ check |
| Maine UI deposits | Quarterly with the ME UC-1 | ⚠️ check |
| Maine PFML contributions deposits | Quarterly with the PFML quarterly return | ⚠️ check |
| Maine UI (ME_UI, employer, Maine DOL) | 2.54% default; employer enters its own rate, on the first $12,000 | ⚠️ check |
| Maine PFML (employee) (ME_PFML_EE, employee, Maine PFML) | 0.5%, on the first $184,500 | ⚠️ check |
| Maine PFML (employer) (ME_PFML_ER, employer, Maine PFML) | 0% default; employer enters its own rate, on the first $184,500 | ⚠️ check |
| Quarterly report | Employer's Return of Maine Income Tax Withheld (941ME) | ⚠️ check |
| Quarterly report | Unemployment Contributions Report (ME UC-1) | ⚠️ check |
| Quarterly report | Maine PFML Quarterly Contribution Return | ⚠️ check |
| Minimum wage | $15.10 | ⚠️ check |
| Exempt salary floor (a year) | $45,300 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | 1 hour per 40 worked, up to 40 hours a year, for employers with 11 or more employees | ⚠️ check |
| New-hire report | Within 7 days to Maine New Hire Reporting (Maine DHHS) | ⚠️ check |

- ⚠️ W-4ME: single (also head of household), married, or married but withholding at the higher single rate, and the number of allowances, $5,300 each. No W-4ME on file: single with no allowances, as the booklet says.
- ⚠️ The rate schedule's base amounts are used exactly, so TrailBook matches the booklet's three examples ($0, $32 and $256 a week).
- ⚠️ The standard deduction phase-out is worked out as a rate of wages over the threshold ($12,850 ÷ $75,000 single, $28,550 ÷ $150,000 married), which gives the booklet's formula to within a fraction of a cent.
- ⚠️ Deposits: TrailBook shows Maine withholding on the federal deposit dates when last year's average quarter was over $4,500 (the booklet's $18,000 lookback test) and quarterly with the 941ME otherwise. ⚠️ check: Maine's semiweekly schedule applies whatever the federal schedule is, so an employer who deposits federal tax monthly but withheld $18,000 or more for Maine still pays Maine semiweekly.
- ⚠️ UI rates are per employer: enter yours from the Maine DOL rate notice, including the CSSF and UPAF parts. ⚠️ check: the $12,000 wage base and 2.54% new-employer rate are from Bloomberg Tax and payroll publishers; maine.gov isn't reachable from here.
- ⚠️ check: Paid Family and Medical Leave: TrailBook takes 0.5% from the employee. Employers with 15 or more employees enter the 0.5% employer share; smaller employers leave it blank. Figures are from NFIB and payroll publishers.
- ⚠️ check: city minimum wages (Portland $16.75 and Rockland $16.00 in 2026, as reported by NFIB) aren't included yet.
- ⚠️ Sales tax: TrailBook doesn't work out Maine sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: Maine Revenue Services, 2026 Withholding Tables for Individual Income Tax (revised August 2026), Maine Income Tax Withholding — Percentage Method — 2026 ($5,300 per W-4ME allowance; withholding standard deduction $12,850 single to $102,250 of annual wages and $28,550 married to $204,550, then $12,850 × ($177,250 − wages) / $75,000 and $28,550 × ($354,550 − wages) / $150,000, nothing above; single 5.8% to $27,400, $1,589 + 6.75% to $64,850, $4,117 + 7.15% above; married $54,850 ($3,181) and $129,750 ($8,237); 2% surcharge on annualized income over $1,000,000 single or $1,500,000 married; round to the dollar; Examples 1 to 3 ($0, $32 and $256 a week)); Same booklet, items 4 to 7 (married uses the married schedule; married but withholding at the higher single rate and single or head of household use the single schedule; no valid W-4ME means single with no allowances; supplemental wages paid separately may be withheld at 5%; Form 941ME quarterly by the last day of the month after the quarter; semiweekly payments when the July 2024 to June 2025 withholding was $18,000 or more (Wednesday to Friday paydays by the next Wednesday, Saturday to Tuesday by the next Friday), otherwise with the quarterly return); Maine DOL 2026 UI, as reported by Bloomberg Tax and payroll publishers (maine.gov isn't reachable from here) ($12,000 wage base; Schedule A; 2.54% new-employer rate (2.23% UC, 0.14% CSSF, 0.17% UPAF)); Maine Paid Family and Medical Leave, as reported by NFIB and payroll publishers (1% of wages up to the Social Security wage base ($184,500); employers with 15 or more employees may deduct up to half from employees; smaller employers pay only the employee half (0.5%), which they may deduct); 26 M.R.S. 664 and 663(3)(K) (minimum wage $15.10 from January 1, 2026; exempt salary over 3,000 times the minimum wage a year); 26 M.R.S. 637 (earned paid leave); new hire reporting within 7 days ($15.10 minimum wage; $45,300 exempt salary; 1 hour of earned paid leave per 40 worked, up to 40 hours a year, for employers with more than 10 employees).

### District of Columbia (us-dc 2026.1, `src/rules/us-dc-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| State income tax on wages | The year's wages less $4,150 a D-4 allowance; 4% to $10,000, $400 + 6% to $40,000, $2,200 + 6.5% to $60,000, $3,500 + 8.5% to $250,000, $19,650 + 9.25% to $500,000, $42,775 + 9.75% to $1,000,000, $91,525 + 10.75% above; one schedule for every filing status; divided by the pay periods | ⚠️ check |
| DC withholding deposits | Monthly by the 20th of the next month; FR-900M | ⚠️ check |
| DC UI deposits | Quarterly with the UC-30 | ⚠️ check |
| DC Universal Paid Leave deposits | Quarterly with the Paid Family Leave quarterly report | ⚠️ check |
| DC UI (DC_UI, employer, DC DOES) | 2.7% default; employer enters its own rate, on the first $9,000 | ⚠️ check |
| DC Administrative Funding Assessment (DC_AFA, employer, DC DOES) | 0.2%, on the first $9,000 | ⚠️ check |
| DC Universal Paid Leave (DC_UPL, employer, DC DOES) | 0.75%, no wage base | ⚠️ check |
| Quarterly report | Employer's Quarterly Contribution and Wage Report (UC-30) | ⚠️ check |
| Quarterly report | DC Paid Family Leave Quarterly Report | ⚠️ check |
| Minimum wage | $17.95 | ⚠️ check |
| Exempt salary floor (a year) | $35,568 | ⚠️ check |
| Overtime | After 40 hours a week | ⚠️ check |
| Paid sick leave | 1 hour per 37 worked, up to 40 hours a year, for employers with 25 or more employees | ⚠️ check |
| New-hire report | Within 20 days to DC New Hire Registry | ⚠️ check |

- ⚠️ check: the withholding method (annual wages less $4,150 a D-4 allowance, no separate standard deduction) comes from a payroll publisher, not OTR's own withholding instructions, which can't be reached from here. The rates themselves are OTR's. Recheck against OTR's 2026 Income Tax Withholding Instructions and Tables when they can be read.
- ⚠️ D-4: filing status and the number of allowances, $4,150 each. Every status uses the same table. ⚠️ check: no D-4 on file is treated as single with no allowances.
- ⚠️ Deposits: TrailBook shows DC withholding monthly (FR-900M), due the 20th of the next month. ⚠️ check: OTR may assign small employers quarterly (FR-900Q) or annual (FR-900A) filing, which would make the real due dates later than shown.
- ⚠️ UI rates are per employer: enter yours from the DOES rate notice. New employers pay 2.7%, plus the 0.2% Administrative Funding Assessment. ⚠️ check: these and the $9,000 wage base are from payroll publishers; does.dc.gov isn't reachable from here.
- ⚠️ check: Universal Paid Leave is 0.75% of all wages, paid by the employer and never deducted from employees. One payroll publisher still lists the older 0.26% rate.
- ⚠️ check: sick leave: TrailBook uses the middle tier (1 hour per 37 worked, up to 40 hours, for 25 to 99 employees). Employers with 100 or more give up to 56 hours; those with 24 or fewer give 1 hour per 87, up to 24 hours, which TrailBook shows only as the lower cap.
- ⚠️ Sales tax: TrailBook doesn't work out DC sales tax yet; invoices carry none unless an owner or accountant sets the rate by hand.

Sources: DC Office of Tax and Revenue, DC Individual and Fiduciary Income Tax Rates (tax years beginning after 12/31/2021), otr.cfo.dc.gov, as uploaded (4% to $10,000; $400 + 6% to $40,000; $2,200 + 6.5% to $60,000; $3,500 + 8.5% to $250,000; $19,650 + 9.25% to $500,000; $42,775 + 9.75% to $1,000,000; $91,525 + 10.75% above); Halfpricesoft, District of Columbia 2026 Income Tax Withholding (last updated December 17, 2025), as uploaded; follows the National Finance Center's method (OTR's withholding instructions aren't reachable from here) ($4,150 per D-4 allowance subtracted from annual wages; one table for all filing statuses (the same rates as OTR's)); DC DOES 2026 UI and Paid Family Leave, as reported by payroll publishers (Netchex, Warp, OnPay) (UI $9,000 wage base, 2.7% new-employer rate, 0.2% Administrative Funding Assessment; Universal Paid Leave 0.75% employer-only, no wage base); DOES 2026 Minimum Wage Increase Notice; Accrued Sick and Safe Leave Act (D.C. Code 32-531.01 and following); new hire reporting within 20 days (minimum wage $17.95, $18.40 from July 1, 2026; 1 hour of sick leave per 37 worked, up to 40 hours a year (employers with 25 to 99 employees)).

## Canada, first part: rules core (`src/rules/canada`, `src/payroll/canada.ts`), released 2026-10-29

**Sign-off, 2026-10-29.** Greg approved every Canada pack as it stands, ⚠️ items included, and they are now `released`. Canada stays "coming soon" in the country picker until the payroll part below is built, because entity setup and pay runs don't use these packs yet. The ⚠️ items are rechecked when the January T4127 edition is read.

Canada has its own pack kinds next to the US ones: one federal pack (`ca-federal`: CPP, QPP, EI, QPIP and federal income tax) and one pack per province or territory (`ca-province`: provincial income tax). The calculator follows CRA's T4127 option 1 (annualized) formula for every province and territory but Quebec, and Revenu Québec's TP-1015.F-V section 2.1.1 for Quebec income tax. Packs cover July 1 to December 31, 2026, the span of T4127's 123rd edition, which is when Canadian pay runs can first happen. Canada stays "planned" in the country picker: nothing here reaches a pay run until the payroll part (TD1 forms, CAD pay runs, remittances, T4, RL-1, ROE) is built.

Sources: CRA T4127 123rd edition (July 2026) and Revenu Québec TP-1015.F-V (2026-01), both uploaded by Greg on 2026-10-29 because canada.ca and revenuquebec.ca refuse automated downloads; Quebec Finance's 2026 parameters document (downloaded). Formulas the July T4127 doesn't reprint were checked against the January (122nd) edition, uploaded by Greg the same day (version 2026.3). That check corrected Alberta's supplemental credit to CRA's formula, made CPP/EI credits use the year's maximums once reached, based the Canada employment amount on employment income and phased Manitoba's basic amount on net income (A + HD). Greg approved these in advance ("approve, publish, merge, and continue").

Tested against Revenu Québec's worked examples (Appendix 1: $444.51, $421.46, $481.76, $489.36; Appendix 3: QPP $95.94 and QPP2 $56, $160, $40), T4127 Table 8.1 constants, BC's reduction cutoff, PEI's prorated top rate and NL's mid-year claim.

### Federal (ca-federal 2026.3, `src/rules/canada/federal-2026.ts`)

| Item | Figure | Status |
|---|---|---|
| Federal rates and constants | 14% / 20.5% / 26% / 29% / 33% over $58,523 / $117,045 / $181,440 / $258,482; K $0 / $3,804 / $10,241 / $15,685 / $26,024 | ✅ T4127 Table 8.1 |
| Basic personal amount (BPAF) | $16,452, falling evenly to $14,829 between $181,440 and $258,482 of net income | ✅ T4127 January, chapter 2 |
| Canada employment amount | $1,501 | ✅ Table 8.2 |
| CPP | 5.95% (4.95% base) on $3,500 to $74,600, maximum $4,230.45 (base $3,519.45); exemption per period truncated to the cent | ✅ T4127 January, chapters 1 and 6 |
| CPP2 | 4% from $74,600 to $85,000, maximum $416 | ✅ T4127 January, chapter 6 |
| EI | 1.63% (1.30% in Quebec) to $68,900, maximum $1,123.07 ($895.70 in Quebec); employer 1.4 times | ✅ T4127 January, chapter 4 |
| QPP, QPP2 | 6.30% (5.30% base), 4% to $85,000; maximums $4,479.30 and $416 | ✅ TP-1015.F-V |
| QPIP | 0.430% employee, 0.602% employer, to $103,000 | ✅ TP-1015.F-V |
| Quebec abatement | 16.5% of basic federal tax | ✅ Table 8.2 |

### Provinces and territories (`src/rules/canada/provinces-2026.ts`)

| Pack | Rates and amounts | Status |
|---|---|---|
| ca-ab Alberta | 8% to $61,200 up to 15% over $370,220; BPA $22,769; supplemental credit (K5P) 25% of K1P + K2P over $4,896 | ✅ (corrected from the January edition) |
| ca-bc British Columbia | Prorated 6.14% to $50,363, then 7.7% to 20.5%; BPA $13,216; reduction $805 less 3.56% over $25,570, none over $44,952 | ✅ T4127 July (Budget 2026 change) |
| ca-mb Manitoba | 10.8% / 12.75% / 17.4%; BPA $15,780 phased out from $200,000 to $400,000 of net income (A + HD) | ✅ |
| ca-nb New Brunswick | 9.4% to $52,333, 14%, 16%, 19.5% over $193,861; BPA $13,664 | ✅ |
| ca-nl Newfoundland and Labrador | 8.7% to 21.8% (eight brackets); BPA prorated $15,000 (2026: $13,094); an old $11,188 TD1NL claim reads as $15,000 | ✅ |
| ca-ns Nova Scotia | 8.79% to 21% over $157,124; BPA $11,932 (income-based BPANS formula removed for 2026) | ✅ |
| ca-on Ontario | 5.05% to 13.16%; BPA $12,989; surtax 20% over $5,818, 36% over $7,446; tax reduction $300 (+ $554 per dependant); Health Premium up to $900 | ✅ |
| ca-pe Prince Edward Island | 9.5% to 19%, new top bracket over $200,000 at prorated 21% (20% for the year); BPA $15,000 | ✅ T4127 July |
| ca-qc Quebec | 14% / 19% / 24% / 25.75% over $54,345 / $108,680 / $132,245, constants $2,717 / $8,151 / $10,465; BPA $18,952 (rounded TP-1015.3 amount × 14%); deduction for workers 6% up to $1,450; labour-fund share credit 15% | ✅ TP-1015.F-V |
| ca-sk Saskatchewan | 10.5% / 12.5% / 14.5%; BPA $20,381 | ✅ |
| ca-nt Northwest Territories | 5.9% to 14.05%; BPA $18,198 | ✅ |
| ca-nu Nunavut | 4% to 11.5%; BPA $19,659 | ✅ |
| ca-yt Yukon | 6.4% to 15% over $500,000; BPA follows the federal amount (BPAYT = BPAF); Canada employment amount credit | ✅ |

Not yet built (next parts): TD1 and TP-1015.3 forms on employees, CAD pay runs and pay stubs, bonus and retroactive pay methods, CRA and Revenu Québec remittance schedules, T4, RL-1 and ROE, Quebec's health services fund and other employer taxes (Ontario EHT, BC EHT, Manitoba HE levy, NL HAPSET, CNESST and provincial workers' compensation), provincial employment standards (minimum wage, overtime, vacation pay, statutory holidays) and GST/HST/PST/QST.

Privacy, for Greg's legal review: PIPEDA for employee data of Canadian customers; Quebec's Law 25 (privacy officer, privacy impact assessment before personal information leaves Quebec, since TrailBook's servers are in the US; confidentiality incident reporting); CASL for any marketing email to Canadians.

## Canada, second part: payroll (`src/rules/canada/provinces-payroll-2026.ts`), released 2026-10-30

**Sign-off, 2026-10-30.** Greg approved this part as it stands, ⚠️ items included ("approve, merge and publish"), and the 13 province payroll packs are now `released`. Canada is live in the country picker (all ten provinces and three territories): a Canadian business can set up, add employees and run payroll. The ⚠️ items below are for the daily rule watch to confirm against the boards and labour ministries.

What it adds:

- **Company setup.** Entity types for a Canadian sole proprietor (T2125), partnership (T5013) and corporation (T2); ASPE, CAD, six-year retention; a `ca-service` chart of accounts with GIFI codes (`src/rules/coa/ca-service.ts`); the CRA business number where a US business keeps its EIN; Canadian postal codes (A1A 1A1) in every address.
- **Employees.** The SIN (Luhn-checked, sealed like an SSN), the TD1 and provincial TD1 (Quebec: TP-1015.3) claim amounts, extra tax, Ontario dependants, northern residents deduction, and CPP/QPP, EI and QPIP exemptions; RRSP and registered pension deductions at source; earlier-this-year figures read as federal tax, provincial tax, CPP/QPP, EI and QPIP.
- **Pay runs.** CPP or QPP (and the second contributions), EI, QPIP and federal and provincial income tax from the released rules core, plus each province's employer charges below. Liabilities go to "CRA source deductions payable" (2340) or "Revenu Québec source deductions payable" (2345), workers' compensation (2350), health taxes (2355) and territorial payroll tax (2360).

| Pack | Employer and employee charges | Minimum wage | Overtime | Status |
|---|---|---|---|---|
| ca-ab-payroll Alberta | WCB, employer rate required, to $110,900 | $15.00 | 8 a day, 44 a week | ⚠️ secondary |
| ca-bc-payroll British Columbia | WorkSafeBC to $127,500; Employer Health Tax rate entered by the employer (0 under the $1M exemption) | $18.25 | 8 a day, double after 12; 40 a week | ⚠️ secondary |
| ca-mb-payroll Manitoba | WCB to $171,500; Health and Post-Secondary Education levy entered by the employer | $16.00, $16.40 from Oct 1 | 8 a day, 40 a week | ⚠️ secondary |
| ca-nb-payroll New Brunswick | WorkSafeNB to $85,800 | $15.90 | 44 a week | ⚠️ secondary |
| ca-nl-payroll Newfoundland and Labrador | WorkplaceNL to $80,935; HAPSET entered by the employer | $16.35 | 40 a week | ⚠️ secondary |
| ca-ns-payroll Nova Scotia | WCB to $79,900 | $16.50, $17.00 from Oct 1 | 48 a week | ⚠️ secondary |
| ca-on-payroll Ontario | WSIB to $121,700; Employer Health Tax entered by the employer (0 under the $1M exemption) | $17.60, $17.95 from Oct 1 | 44 a week | ⚠️ secondary |
| ca-pe-payroll Prince Edward Island | WCB to $89,300 | $16.50, $17.30 from Oct 1 | 48 a week | ⚠️ secondary |
| ca-qc-payroll Quebec | CNESST to $103,000; health services fund 1.65% (rate entered from the employer's payroll size); CNT 0.06% to $103,000; WSDRF (0 under $2M of payroll) | $16.60 | 40 a week | ⚠️ secondary |
| ca-sk-payroll Saskatchewan | WCB to $108,223 | $15.35, $15.70 from Oct 1 | 8 a day, 40 a week | ⚠️ secondary |
| ca-nt-payroll Northwest Territories | WSCC to $116,000; 2% payroll tax (employee) | $16.95, $17.20 from Sep 1 | 8 a day, 40 a week | ⚠️ secondary |
| ca-nu-payroll Nunavut | WSCC to $117,300; 2% payroll tax (employee) | $19.75, $20.17 from Sep 1 | 8 a day, 40 a week | ⚠️ secondary |
| ca-yt-payroll Yukon | WCB to $107,599 | $18.51 | 8 a day, 40 a week | ⚠️ secondary |

⚠️ Minimum wages and workers' compensation ceilings come from secondary publishers (CFIB, payroll firms, news) because the provincial sites refuse automated downloads; the daily rule watch should check them against each board and labour ministry. GIFI codes in the Canadian chart of accounts are from working knowledge of CRA guide RC4088 and need checking. Health taxes are a flat rate on all wages, without the annual exemption worked out; the employer enters 0 below the threshold.

**Not in this part (next):** CRA and Revenu Québec remittance due dates and reminders, the T4, RL-1 and ROE, direct deposit files for Canadian banks (CPA 005), vacation pay and statutory holiday pay, and GST/HST/PST/QST. Billing still takes US addresses only (Stripe in USD), so a Canadian business can set up and trial but not subscribe yet.

**Gaps for Greg's legal review before Canadian customers:** the Terms of Service and Privacy Policy name only US law; Canada needs PIPEDA language, Quebec's Law 25 (privacy officer, impact assessment before Quebec employee data goes to US servers, incident reporting) and CASL for marketing email. TrailBook selling to Canadian businesses may also need GST/HST registration under the non-resident digital services rules.

## Canada, third part: remittances, T4, RL-1 and ROE (`src/payroll/canada-remittances.ts`, `src/payroll/canada-forms.ts`), draft

**Status: draft, awaiting Greg's review.** No rule packs change in this part; it schedules and reports what the released packs already calculate.

What it adds:

- **Remittances** (CRA guide T4001 chapter 8; Revenu Québec TP-1015.G-V). Each business picks its remitter type on the Payroll page (CRA, and Revenu Québec for Quebec): quarterly (by the 15th after the quarter), regular/monthly (by the 15th of the next month), accelerated threshold 1 (pay dates 1st to 15th by the 25th; 16th to the end by the 10th of the next month) and threshold 2 (1st to 7th, 8th to 14th, 15th to 21st, 22nd to the end, each by the third working day after it closes). A weekend or holiday due date moves to the next business day. CRA gets income tax (federal, and provincial outside Quebec), CPP and EI; Revenu Québec gets Quebec tax, QPP, QPIP, the health services fund and CNESST; the CNT and WSDRF are due once a year with the RL-1 summary, on the last day of February. Payments are recorded and reminders sent through the existing deposits pipeline (`ca_cra_remit`, `qc_rq_remit`, `qc_rlz1s`).
- **T4 slips and T4 Summary**: boxes 10, 14, 16, 16A, 17, 17A, 18, 20, 22, 24, 26, 28, 45, 55, 56; summary lines 88, 14, 20, 16, 16A, 27, 27A, 18, 19, 22, 80, 82 (remittances recorded), 84/86. Box 45 (dental benefits code 1 to 5) is a payroll setting. Due the last day of February.
- **RL-1 slips and RLZ-1.S totals** (Quebec only): boxes A, B, B.A, C, D, E, G, H, I, and the summary's QPP, QPIP, Quebec tax, health services fund, CNT, WSDRF and CNESST, less Revenu Québec remittances recorded.
- **Record of Employment**, one for each employee with a last day: blocks 5, 6, 8 to 12, 15A (insurable hours) and 15C (insurable earnings) over the last 53/27/25/13 pay periods (weekly/biweekly/semi-monthly/monthly), with the period-by-period detail. Due five calendar days after the end of the final pay period. Block 16 (reason) and Block 17 (vacation pay and other money on separation) are entered in ROE Web.
- **Holidays**: `canadaHolidays` (Canada Labour Code: New Year's Day, Good Friday, Victoria Day, Canada Day, Labour Day, National Day for Truth and Reconciliation, Thanksgiving, Remembrance Day, Christmas, Boxing Day) for CRA dates and `quebecHolidays` (New Year's Day, Good Friday, National Patriots' Day, June 24, Canada Day, Labour Day, Thanksgiving, Christmas) for Revenu Québec dates.

⚠️ Items to check:

- Whether CRA treats every Canada Labour Code holiday as a non-business day for remittances (CRA's own list is "public holidays"); Easter Monday and the provincial civic holidays are not included.
- T4 box 26 caps pensionable earnings at the YMPE; earnings between the YMPE and YAMPE (CPP2) aren't separately reported. Box 24 caps at the EI maximum insurable earnings; box 56 at the QPIP maximum.
- Box 20 / RL-1 box D takes the "registered retirement" deduction, which TrailBook doesn't split between RPP and RRSP; a warning says to leave it blank for RRSP.
- RL-1 box B.A label and the RLZ-1.S line names are from working knowledge, not the current guide (RL-1.G-V).
- ROE Block 15A counts 40 hours a week for salaried employees without usual hours; Block 15C isn't capped at the yearly maximum insurable earnings.
- Health services fund on the RL-1 summary uses the rate in payroll settings; Revenu Québec's summary recalculates it from total payroll.

**Not scheduled yet:** workers' compensation outside Quebec, provincial health taxes (ON/BC EHT, MB levy, NL HAPSET) and NT/NU payroll tax have their own schedules and returns; the Payroll page says so. Still to come: CPA 005 direct deposit, vacation and statutory holiday pay, GST/HST/PST/QST.

## Canadian direct deposit (`src/payroll/cpa005.ts`), draft

**Status: draft, awaiting Greg's review.** A Canadian business downloads a Payments Canada Standard 005 ("CPA 005") file for each approved pay run and uploads it to its bank, as a US business does with its NACHA file.

- Employees give their institution (3 digits), transit (5 digits) and account (5 to 12 digits) numbers. They're stored as `0` + institution + transit in the same sealed bank columns US employees use, and a Canadian business can't save a US routing number (or the other way round).
- The business enters its bank's originator ID, processing (destination data) centre, a short name for statements, its long name, and its own account for returned payments (sealed).
- The file has an "A" header, "C" records with up to six 240-character payroll credits (transaction code 200) each, and a "Z" trailer, all 1,464 characters long with CRLF line endings. The due date is the pay date, written 0YYDDD. Each download takes the next file creation number (1 to 9999, then back to 1), so the bank never sees a duplicate.

⚠️ To check with each bank: banks vary on line endings, blank versus zero filler in unused segments, and whether they want a different transaction code or currency field. RBC, TD, BMO, Scotiabank, CIBC and Desjardins each publish their own CPA 005 guide, and the first real file should be sent as a test.

## Canadian vacation pay and statutory holiday pay (`src/rules/canada/employment-standards-2026.ts`, `src/payroll/employment-standards.ts`), draft

**Status: draft, awaiting Greg's review.** Each province and territory's employment standards for hourly employees. Federally regulated businesses (Canada Labour Code) aren't covered. Salaried employees keep their salary over holidays and vacation, so they get no extra lines.

- **Vacation pay.** Each employee is either paid it with every pay ("each_pay") or earns it into a balance owed ("accrue", the default). A balance is paid out by entering an amount on the pay run line, and all of it is paid on the last pay automatically. The rate steps up with completed years of service; an employer may set a higher percentage. It is worked on the period's earnings, without discretionary bonuses and vacation pay itself, and without overtime or holiday pay where the region says so. The ROE shows a Block 17A note for vacation paid on the last pay, and warns when a balance is still owed.
- **Holiday pay.** For each statutory holiday in the period, unless the line is ticked "holiday wasn't a usual work day" (Alberta's rule). Wages before the holiday come from posted runs, each counted by the share of its days that falls in the window, plus this period's regular pay for the days before the holiday. With less than the full window in TrailBook the paycheck carries a warning, and with no earlier pay at all, a regular day's pay is used and flagged.
- **Working the holiday.** Hours entered as "hours worked on a statutory holiday" are paid at the region's premium (1.5 times; Quebec and Newfoundland and Labrador straight time) on top of the holiday pay. In Newfoundland and Labrador that equals the double rate for a full day. Holidays falling on a weekend are paid on their own date; substitute days aren't moved.

| Region | Vacation | Holiday pay | Qualifying | Worked |
|---|---|---|---|---|
| AB | 4%, 6% after 5 years; no overtime or holiday pay | wages (incl. vacation pay, no overtime) in 28 days over days worked | 30 days | 1.5× + holiday pay |
| BC | 4%, 6% after 5 | wages (no overtime) in 30 days over days worked | 30 days (15 of 30 days not checked) | 1.5× + holiday pay |
| MB | 4%, 6% after 5, 8% after 10; no overtime | 5% of wages (no overtime) in 28 days | none | 1.5× + holiday pay |
| NB | 4%, 6% after 8 | regular day | 90 days | 1.5× + holiday pay |
| NL | 4%, 6% after 15 | regular day | 30 days | straight time + holiday pay |
| NS | 4%, 6% after 8 | wages (no overtime) in 30 days over days worked | 15 of 30 days not checked | 1.5× + holiday pay |
| NT, NU | 4%, 6% after 6 | regular day | 30 days | 1.5× + holiday pay |
| ON | 4%, 6% after 5 | regular wages and vacation pay in 28 days, over 20 | none | 1.5× + holiday pay |
| PE | 4%, 6% after 8 | wages (no overtime) in 30 days over days worked | 30 days (15 of 30 days not checked) | 1.5× + holiday pay |
| QC | 4%, 6% after 3 | 1/20 of wages (no overtime) in 28 days | none | straight time + indemnity |
| SK | 3/52, 4/52 after 10 | 5% of wages (no overtime, incl. vacation pay) in 28 days | none | 1.5× + holiday pay |
| YT | 4% | regular day | 30 days | 1.5× + holiday pay |

"Days worked" isn't recorded, so it's estimated as hours worked over the usual daily hours (usual hours each pay period over its workdays, or 8). A regular day is the hourly rate times those daily hours.

Holidays (2026 dates from each region's rules; Easter-based and Monday holidays are computed each year): AB 9, BC 11 (adds BC Day and September 30), MB 9 (Louis Riel Day, September 30 since Dec 7, 2023; Remembrance Day is under a separate act), NB 8 (no Victoria Day; NB Day), NL 6, NS 6 (Heritage Day; Remembrance Day under a separate act), NT 11 (June 21, Civic Holiday, September 30), NU 12 (Nunavut Day July 9, Civic Holiday, Boxing Day), ON 9 (Boxing Day; no Civic Holiday), PE 8 (Islander Day, September 30), QC 8 (National Patriots' Day, June 24), SK 10 (Saskatchewan Day), YT 11 (June 21, Discovery Day, September 30; Heritage Day isn't statutory).

⚠️ To check against each act (working knowledge, with secondary sources for Manitoba's September 30, Nunavut Day, Yukon's Heritage Day and Newfoundland and Labrador's double rate): the vacation service steps (especially NL 15 years, NT/NU 6, YT none, QC 3), which wages count for vacation pay and holiday pay in each region, the qualifying periods, Nunavut's Boxing Day (guides disagree; kept in so no one is underpaid), and Quebec's window (counted as 28 days before the holiday, not the four complete weeks before its week). The released 2026.1 payroll packs' note that vacation and holidays "aren't worked out yet" is left as is until Greg approves changing a released pack.

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

Tax-line codes for Schedule C, 1065, 1120S and 1120 (and the GIFI codes in `src/rules/coa/ca-service.ts`) are from working knowledge and need checking against the current forms and against each Intuit product's trial-balance import layout.

## Adding a state

Each state is one file in `src/rules` with a `StateRulePack`, added to the registry in `src/rules/index.ts` and to `LIVE` in `src/rules/jurisdictions.ts`. New packs start as `draft`: a business can be set up there and preview payroll, but saved pay runs are refused until Greg reviews the figures here and the pack is `released`. Each new state gets its own section in this file, and its agencies are added to the daily rule watch below.

## Monitoring

A scheduled task runs every morning. It checks the IRS, SSA, EDD, DIR, CDTFA, FTB and city minimum wage ordinances, and for the other state packs: the Texas Workforce Commission, Florida Department of Revenue (reemployment tax), Nevada DETR and Labor Commissioner, Tennessee Department of Labor and Workforce Development, South Dakota Department of Labor and Regulation, Wyoming Department of Workforce Services, New Hampshire Employment Security, Alaska Department of Labor and Workforce Development, Washington ESD (UI, Paid Family and Medical Leave, WA Cares) and Labor and Industries (minimum wage, exempt salary), the Arizona Department of Revenue (A-4 rates, A1-QRT), Arizona DES (UI and job training tax) and the Industrial Commission of Arizona (minimum wage, earned paid sick time), the Oregon Department of Revenue (withholding formulas 150-206-436, statewide transit tax, TriMet and Lane transit taxes), the Oregon Employment Department (UI, Paid Leave Oregon), DCBS (Workers' Benefit Fund) and BOLI (minimum wage), the New York Department of Taxation and Finance (NYS-50-T-NYS tables, NYS-50), the New York Department of Labor (UI, minimum wage, exempt salary) and DFS / the Workers' Compensation Board (Paid Family Leave and disability contributions), the Illinois Department of Revenue (IL-700-T, IL-941) and IDES (UI), the Colorado Department of Revenue (DR 1098, DR 0004), CDLE (UI, minimum wage, COMPS Order) and the FAMLI Division, the North Carolina Department of Revenue (NC-30) and DES, the Georgia Department of Revenue (Employer's Tax Guide) and Department of Labor, the Utah State Tax Commission (Publication 14) and Department of Workforce Services, the Idaho State Tax Commission (EPB00744 and EPB00745) and Department of Labor, Michigan Treasury (Form 446, calendar-year withholding figures), UIA and LEO (minimum wage, Earned Sick Time Act), Virginia Tax (Employer Withholding Instructions), the VEC and DOLI (minimum wage), Massachusetts DOR (Circular M, M-941), DUA (UI, EMAC, Workforce Training Fund) and DFML (PFML rates), the New Jersey Division of Taxation (NJ-WT and rate tables) and NJDOL (UI, disability, family leave, WF/SWF rates each July, minimum wage), the Pennsylvania Department of Revenue (employer withholding rate and deposit tiers), L&I (UC tax highlights), DCED (Act 32 earned income tax) and the City of Philadelphia (wage tax rates, which change each July 1), the Ohio Department of Taxation (optional computer formula, employer and school district withholding guidelines) and ODJFS (UI), and the Ohio minimum wage notice, the Indiana Department of Revenue (Departmental Notice #1 county rates) and DWD, the Comptroller of Maryland (withholding guide, percentage tables and county rates) and the Maryland Department of Labor (UI, minimum wage, FAMLI start), the Missouri Department of Revenue (Form 4282) and DOLIR, Kansas City and St. Louis earnings tax, the Wisconsin Department of Revenue (Publication W-166) and DWD, the Minnesota Department of Revenue (withholding booklet), UI Minnesota (UI, Paid Leave premiums) and DLI (minimum wage, earned sick and safe time), Minneapolis and St. Paul minimum wages, SCDOR (WH-1603F and the Act 110 withholding tables) and SC DEW, the Alabama Department of Revenue (withholding booklet) and Department of Workforce, the Louisiana Department of Revenue (R-1306) and Workforce Commission, the Kentucky Department of Revenue (withholding formula) and Office of Unemployment Insurance, the Oklahoma Tax Commission (OW-2) and OESC, Connecticut DRS (TPG-211, withholding tables, IP 2026(1)), the Connecticut Department of Labor (UI, minimum wage, paid sick leave) and the CT Paid Leave Authority, the Iowa Department of Revenue (withholding formula) and Iowa Workforce Development, the Arkansas DFA (withholding formula, low-income tables, AR4EC) and Division of Workforce Services, the Delaware Division of Revenue (Employer's Guide, rate tables), Delaware DOL (UI, Paid Leave) and the City of Wilmington, the Kansas Department of Revenue (KW-100, K-4) and Department of Labor, the Mississippi Department of Revenue (Pub 89-700, computer payroll flowchart) and MDES, the North Dakota Office of State Tax Commissioner (withholding rates booklet) and Job Service North Dakota, the Montana Department of Revenue (withholding tables, MW-4) and Department of Labor and Industry, the New Mexico Taxation and Revenue Department (FYI-104) and Department of Workforce Solutions, the Rhode Island Division of Taxation (withholding tables) and DLT (UI, TDI, sick leave), the Vermont Department of Taxes (GB-1210, Child Care Contribution) and Department of Labor, the West Virginia Tax Division (IT-100.2A) and WorkForce West Virginia, the Hawaii Department of Taxation (Booklet A, HW-4) and DLIR (UI, TDI maximum weekly wage base, minimum wage), the Nebraska Department of Revenue (Circular EN, W-4N) and Department of Labor (UI, minimum wage, paid sick time), Maine Revenue Services (withholding tables booklet, W-4ME), the Maine Department of Labor (UI, minimum wage, earned paid leave) and Maine PFML, the DC Office of Tax and Revenue (withholding instructions and tables, D-4, rates) and DOES (UI, Universal Paid Leave, minimum wage each July 1), the Chicago and Cook County minimum wage notices, CRA (T4127 editions each January and July, CPP and EI rates) and Revenu Québec (TP-1015.F-V, QPP and QPIP) and the Quebec Ministère des Finances parameters, each province's and territory's employment standards (vacation pay, statutory holidays and holiday pay), and Denver, Edgewater and Boulder minimum wages, plus each state's new-hire reporting rules and minimum wage notices, for new or changed figures that these packs use (and new-year figures), and when something changes it opens a pull request that updates the pack, its sources and this checklist, and tells Greg. Rule changes are not merged without Greg's review, because they change paychecks and tax.
