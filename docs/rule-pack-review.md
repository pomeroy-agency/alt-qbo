# Rule pack review checklist (2026 packs)

Before a pack's `status` changes from `draft` to `released`, each item below needs Greg's sign-off. Every figure was checked against current sources on 2026-10-25; the **Check** column says how. A daily scheduled check watches the sources for changes (see "Monitoring" at the end).

## us-federal 2026.1 (`src/rules/us-federal-2026.ts`)

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

## us-ca 2026.1 (`src/rules/us-ca-2026.ts`)

| Figure | Value | Source | Check |
|---|---|---|---|
| PIT Method B tables 1-7 (annual) | as in file | EDD 26methb.pdf | ✅ single and head-of-household thresholds and rates match the USDA payroll bulletin that reproduces the EDD tables; married thresholds are exactly twice single below $1M; every base amount is consistent. ⚠️ The EDD site is blocked from our build machines, so the $1,000 estimated-deduction allowance is confirmed only by third-party summaries |
| Low-income exemption, standard deduction, allowance credit | $18,896 / $37,791; $5,706 / $11,412; $168.30 | EDD 26methb.pdf | ✅ matches (third-party summaries of the PDF) |
| Supplemental PIT rates | 6.6%; 10.23% bonuses and stock options | EDD | ✅ matches |
| SDI | 1.3%, no wage limit | EDD rates page; SCO letter 25-019 | ✅ matches |
| UI | $7,000 base; schedule F+ (1.5% to 6.2%); 3.4% new employer | EDD | ✅ matches |
| ETT | 0.1% on first $7,000 | EDD | ✅ matches |
| Minimum wage | $16.90 statewide | Dept. of Finance; Labor Code 1182.12 | ✅ matches. ⚠️ About 40 cities and counties are higher (Los Angeles city $18.42, LA County unincorporated $18.47, San Francisco $19.61 from July 1, 2026). Not modelled yet |
| Exempt salary floor | $70,304 | Labor Code 515(a): 2 × $16.90 × 2,080 | ✅ matches |
| Sick leave | 1 hour per 30 worked; 40-hour use cap; 80-hour accrual cap | Labor Code 246 (SB 616) | ✅ matches; unchanged for 2026. Some cities are more generous |
| PIT and SDI deposits | under $350 quarterly; $350 to $400 monthly by the 15th; over $400 on the federal semiweekly or next-day timing | EDD Payroll Tax Deposits page (2026) | ⚠️ from search results (EDD site blocked here). The 2025 DE 44 used $500 where 2026 uses $400; confirm against the 2026 DE 44 table |
| UI and ETT deposits | quarterly with the DE 9; 2026 dates Apr 30, Jul 31, Nov 2, Feb 1 2027 | EDD Required Filings and Due Dates | ✅ the computed dates match the EDD's list |
| Remote-seller threshold | $500,000 | R&TC 6203 (AB 147) | ✅ matches |
| Franchise tax minimum | $800 | R&TC 17941, 23153 | ✅ matches; the first-year LLC exemption (AB 85) ended with 2023 |

### Already announced for 2027 (a 2027 pack is needed before the first 2027 pay date)

| Figure | 2027 value | Status |
|---|---|---|
| Social Security wage base | $192,300 | final (SSA, Oct 14, 2026) |
| California minimum wage | $17.40 | final (certified Jul 31, 2026) |
| Exempt salary floor | $72,384 | follows from the minimum wage |
| UI and ETT wage base, ETT rate | $7,000; 0.1% | final (EDD) |
| SDI rate | 1.4% forecast | final rate due in December |
| Federal brackets, Pub 15-T, EDD Method B | not yet published | expected Oct to Dec 2026 |

## us-ca-sales-tax 2026.1 (`src/rules/sales-tax/us-ca-2026.ts`)

| Kind of sale | Taxable | Basis |
|---|---|---|
| Professional or creative service | no | Rev. & Tax. Code §6051; Reg. 1501 |
| Delivered electronically | no | Reg. 1502(f)(1)(D) |
| Repair or installation labor (billed apart from parts) | no | Reg. 1546 |
| Shipping by carrier, separately stated | no | Reg. 1628(b) |
| Physical goods | yes | §6051 |
| Printed materials, including their design charges | yes | Regs. 1540, 1541 |
| Making something for the customer | yes | Reg. 1526 |
| Equipment rental | yes (usually) | Reg. 1660 |

Also to confirm:
- **Which address sets the rate.** The customer's address is used, or the business's own address if the customer has none. Confirm this default for service businesses that rarely ship (Regs. 1802/1823).
- **Out of state.** A sale is exempt as interstate only when the customer's address is outside California (Reg. 1620).
- **Resale.** A sale is exempt only when the customer's seller's permit is on file. The number is recorded but not checked with the CDTFA (Reg. 1668).
- **Own-vehicle delivery.** Delivery in the seller's own vehicle can be taxable, so consider a separate kind of sale for it (Reg. 1628).
- **Rate lookup.** The rate comes from the CDTFA's tax rate API. It was spot-checked for four cities on 2026-10-25, and the live site returned 10.25% for Los Angeles City Hall the same day. Addresses on district boundaries still need checking.
- **Design charges.** CDTFA annotations (430.0194, 100.0103, 100.0159, 100.0162, still in the 2026 law guide) say finished or sketched designs handed over in physical form are taxable, while preliminary art billed separately is not. Designs delivered only electronically are not tangible, which is why "professional or creative service" defaults to not taxable.

### us-ca-sales-tax 2027.1 (same file, draft; rule watch and legal review 2026-10-25)

Legal review: https://claude.ai/artifact/KNyqBmPyM1axk2JoiLD44n. ca.gov was blocked from the build machines, so the statute and CDTFA text were read through search extracts; check the citations against the chaptered SB 122 and the adopted regulations before release.

| Change | 2027 value | Source | Check |
|---|---|---|---|
| Prewritten software, including downloads and SaaS ("Software or app access") | taxable for access from 2027-01-01; not taxable in the 2026 pack (on a disk, use "Physical goods") | Rev. & Tax. Code §§6016.1, 6016.2 (SB 122, Stats. 2026, ch. 23); draft Reg. 1600 | ⚠️ confirm against the chaptered text |
| "Prewritten" test in the help text | offered to customers generally, even if first built custom | §6010.9 ("held or existing for general or repeated sale or lease"); Reg. 1502 | ⚠️ same |
| Custom software (new choice, both packs) | not taxable | §6010.9; Reg. 1502 (moving to proposed Reg. 1502.2) | ⚠️ same |
| Digital works and digital infrastructure ("Delivered electronically") | not taxable | §6016.1(b) | ⚠️ same |
| Services delivered through software ("Professional or creative service") | not taxable when the customer pays for a person's work done after they asked | §6372.1; draft Reg. 1600(g)(3) | ⚠️ CDTFA hasn't settled the line |
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
- **When.** A bill accrues use tax when the person ticks "The vendor didn't charge California sales tax", which defaults to on for vendors marked that way. Alt-QBO doesn't decide whether the vendor should have charged tax.
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

## Prepared payroll forms (`src/payroll/forms.ts`)

The forms are worksheets with each line's figure, for copying into the filing site. Alt-QBO doesn't file them.

| Form | What to check | Source | Check |
|---|---|---|---|
| 941 | Line numbers and labels 1-16; line 7 fractions of cents; Schedule B over $50,000 or semiweekly | 2026 Form 941 and instructions (Rev. Mar 2026) | ✅ line numbers match the IRS PDF. Lines 5b, 5f, 8, 9 and 11 (tips, sick-pay and credit adjustments) aren't used by Alt-QBO and are left out |
| 940 | Lines 1a-15a; line 4 exempt payments (section 125); line 9/10 not used; quarterly liability when over $500 | 2025 Form 940 and Schedule A (the 2026 form comes out in December) | ⚠️ checked against the 2025 form; recheck against the 2026 form when published. Line 11 waits for California's 2026 credit reduction |
| DE 9 | Item letters C (total subject wages), D (UI, ETT, SDI wages, rates and contributions), E (UI and ETT), F (SDI), G, H (PIT withheld), I (deposits), J (balance due) | DE 9 form and instructions | ⚠️ from memory of the form; the EDD and DIR sites are blocked here. Confirm each item letter against the current DE 9 |
| DE 9C | A1-A3 employee counts for the pay period including the 12th of each month; per employee SSN, name, total subject wages, PIT wages, PIT withheld | DE 9C form and instructions | ⚠️ same as DE 9 |
| W-2 / W-3 | Boxes 1-6, 12 code D (401(k)), 14 CASDI, 15-17 with the 8-digit EDD account number; W-3 b and c | 2026 General Instructions for Forms W-2 and W-3 | ✅ matches. Box 12 DD (employer health coverage cost) isn't filled in; employers filing fewer than 250 W-2s are exempt |
| Due dates | 941 and DE 9: last day of the month after the quarter, moved to the next business day; 940 and W-2: Jan 31 (moved past weekends) | Pub 15 (2026); EDD | ✅ |

## Sales and use tax return worksheet (`src/core/sales-tax-return.ts`)

A worksheet for the business's own CDTFA-401, built on the sales tax report. Alt-QBO doesn't file or pay it.

| Item | What Alt-QBO does | Source | Check |
|---|---|---|---|
| Due dates | Last day of the month after the period (monthly, quarterly, yearly; fiscal year July to June), moved past weekends and California holidays | CDTFA filing due dates | ⚠️ from working knowledge; ca.gov is blocked here. Confirm the weekend and holiday rule |
| Prepayments | Quarterly prepay accounts: due the 24th of the month after each of the first two months of the quarter; in Q2 the second covers May 1 to June 15 (due June 24). Each line shows the tax charged and the accepted shares: 90% of the month, or a third of the same quarter last year; Q2's second: 90% of May plus 90% of June 1-15, 135% of May, or half of last year's Q2 | CDTFA-367-SUT and 367-EFT (via search extracts) | ⚠️ confirm against the current CDTFA forms; the sources disagree on the order of the Q2 options |
| Accrual basis | Sales count in the period of the invoice date. An invoice voided after its period ends stays in that period, with a warning to amend | Accrual is the CDTFA default; cash basis needs the CDTFA's approval | ⚠️ confirm Greg wants accrual, and the authority for the default |
| Line labels | Labeled by what the line is, not by line number, because the online return numbers its lines differently from the paper CDTFA-401 | CDTFA-401 | ⚠️ match each to the 2027 online return. SB 122 direct-pay and multiple-points-of-use software go under "other deductions" with a description; confirm CDTFA doesn't add its own lines |
| State and district tax | State and local at 7.25% of taxable sales; district tax per place on Schedule A at the looked-up rate less 7.25% | CDTFA-401 Schedule A | ⚠️ Schedule A asks for district codes; Alt-QBO shows the place name from the rate lookup |
| Excess tax collected | When invoices charged more than the return computes, a warning says to pay the extra | Rev. & Tax. Code §6901.5 | ✅ |
| No permit | An invoice charging tax with no seller's permit recorded shows a warning (it isn't stopped) | Rev. & Tax. Code §§6066, 6071 | ✅ |

## Chart of accounts tax lines (`src/rules/coa/us-service.ts`)

Tax-line codes for Schedule C, 1065, 1120S and 1120 are from working knowledge and need checking against the current forms and against each Intuit product's trial-balance import layout.

## Monitoring

A scheduled task runs every morning. It checks the IRS, SSA, EDD, DIR, CDTFA and FTB for new or changed figures that these packs use (and new-year figures), and when something changes it opens a pull request that updates the pack, its sources and this checklist, and tells Greg. Rule changes are not merged without Greg's review, because they change paychecks and tax.
