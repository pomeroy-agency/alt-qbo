# TrailBook's own sales tax from 2027

From January 1, 2027, California taxes prewritten software, including SaaS (SB 122, Rev. & Tax. Code §6016.1). TrailBook's subscription fees to California customers become taxable then. This page covers what the business selling TrailBook has to do, and how to bill and report through TrailBook itself.

TrailBook has no subscription billing of its own. The plan is for the selling business to use TrailBook's invoicing like any other client. The invoicing already taxes software by the customer's billing address and access period (PR #22). This change adds the seller's permit, filing frequency and the return worksheet.

## Steps for Greg

1. **Decide which legal entity sells TrailBook.** The permit, the returns and the liability belong to whoever contracts with customers. If that business already holds a California seller's permit, no new permit is needed. Add the new activity and update the expected sales with the CDTFA instead.
2. **Apply for a seller's permit before the first taxable invoice.** Apply through CDTFA online services, under registering a new business or activity. There is no fee, but the CDTFA can ask for a security deposit. Timing matters. TrailBook taxes software by the access period, so a December 2026 invoice for January 2027 access already charges tax. The permit therefore has to be in place before December's invoices go out, not by January 1. Rev. & Tax. Code §6066 requires the permit before making taxable sales.
3. **Note the filing frequency the CDTFA assigns.** It depends on the taxable sales you estimate in the application (monthly, quarterly, quarterly with prepayments, yearly or fiscal yearly). The registration packet doesn't show it; it's on the account in CDTFA online services. You can ask the CDTFA to change it later.
4. **Record them in TrailBook.** In the selling business, open **Sales tax** (under Accountant tools) and enter the seller's permit number, the CDTFA account number, the date the permit takes effect, and the filing frequency. The period list and the due-date reminders start with the period the permit takes effect in.
5. **Set up the product.** Under **Products and services**, add the subscription with the kind of sale "Software or app access". Each customer needs a billing address. Without one, TrailBook won't issue a taxed software line.
6. **Invoice with access dates.** Every subscription line carries the first and last day of access. The tax follows those dates, not the invoice date.
7. **File and pay each period.** Open the period on the Sales tax page, read the warnings, and copy the figures into CDTFA online services by the due date shown. Then record the payment in the books by debiting Sales tax payable (2200) and crediting the bank, or match it on the Bank page.

## Status (2026-10-28)

The CDTFA approved the registration for Harmony in the Wild, LLC (DBA Pomeroy Agency) on 2026-10-28. Seller's permit 208-440288 (location 00001), CDTFA account 138-237232, effective 2026-12-01. The filing frequency still has to be read from the account in online services. With a quarterly frequency, the first return covers December 1 to December 31, 2026 (Q4 2026) and is due February 1, 2027, because January 31 is a Sunday.

## Checked against the CDTFA's own guidance (2026-10-28)

Read from the CDTFA pages Greg linked: Filing Dates for Sales & Use Tax Returns, the Tax Guide for New Permit and License Holders (Filing and Payments), and Publication 44, District Taxes (revision June 2026).

- **Due dates match.** Monthly, quarterly and yearly returns are due the last day of the month after the period; fiscal yearly on July 31. Prepayments are due the 24th, and the second quarter's second prepayment covers May 1 to June 15. A due date on a weekend or state holiday moves to the next business day. TrailBook already did all of this.
- **A return is due every period, even with no sales.** The reminders now say so, and the period list starts from the permit's effective date instead of January.
- **Payment cutoffs.** A payment made on the due date must be finished before midnight Pacific time, or 3 p.m. on an EFT account. The worksheet and reminders now say so. EFT becomes mandatory once average monthly payments reach $10,000.
- **Account number.** The CDTFA asks for the account number when you file, so TrailBook now records it next to the permit number.
- **Charging tax before the permit starts.** An invoice dated before the effective date that charges tax now warns, like an invoice with no permit recorded.
- **District tax.** A retailer under the $500,000 California sales threshold is engaged in business, and must collect district use tax, only in districts where it has a physical presence. TrailBook charges the full rate at the customer's address everywhere. Pub. 44 allows this as courtesy collection, provided the tax is stated separately on the invoice and reported on the return. TrailBook does both (the tax line, and Schedule A by place), so no change is needed. Any tax collected beyond what's due is still paid over (Reg. 1700, Rev. & Tax. Code §6901.5), and the worksheet already warns about it.

## Decisions (approved by Greg 2026-10-27)

Greg approved every decision below, and the Terms of Service, as written on 2026-10-27. The full reasoning, the Terms of Service and the partner firm addendum are in the [Terms of service and 2027 sales tax decisions](https://claude.ai/artifact/DrN5xh3U7RnPHrF2HKwxHa) doc.

- **Seller:** Greg's existing California LLC (taxed as an S corp), not the BC company. File a fictitious business name statement once the product is named. (Changed 2026-10-25 from a new LLC.)
- **Pricing:** every price excludes tax. The Terms of Service (section 6, published at `/terms.html`) has the customer agree to pay California sales tax reimbursement (Civ. Code §1656.1). Invoices show the tax as its own line.
- **Accounting and HR firms:** no resale. The client business is always the customer of record, billed and taxed at its own billing address. A firm may pay as the client's agent under the partner firm addendum. A firm's own seats are taxed at the firm's address. Partner pricing is a discount on the client's invoice or a referral fee, never a wholesale price.
- **Services:** onboarding, conversion and training are separate optional lines (kind of sale "Professional or creative service"). There are no bundled prices.
- **Basis and frequency:** reporting is on an accrual basis, at whatever frequency the CDTFA assigns (most likely quarterly).
- **Use tax:** vendors that don't charge California tax are marked so their bills accrue use tax. That use tax flows into the worksheet's "purchases subject to use tax" line.
- **Customers:** at launch, only California-based businesses.

## What the app does

- **Sales tax page** (Accountant tools). It records the seller's permit number, CDTFA account number, the permit's effective date and the filing frequency, and lists each return period from the effective date on, with its due date, plus prepayment dates on quarterly prepay accounts.
- **Return worksheet.** For each period it shows total sales, every deduction (resale, interstate, nontaxable services, SB 122 direct-pay and multiple-points-of-use software), taxable sales, state and local tax at 7.25%, district tax by place (Schedule A), and the total. It compares that total with the tax charged on invoices.
- **Warnings.** The worksheet warns when no permit or frequency is recorded, when tax charged is more than the return computes (which must be paid over, §6901.5), when a rate was set by hand, and when an invoice from an earlier period was voided.
- **Invoices.** An invoice that charges tax while no seller's permit is recorded shows a warning. It is still issued.
- **Reminders.** Once a filing frequency is recorded, owners, admins and accountants get an email up to 5 days before each return or prepayment is due, with the estimated tax and a link to the worksheet.

## Terms of Service

The approved Terms (version 2026-10-27) are published at `/terms.html`, with the Privacy Policy at `/privacy.html`. The company name on both comes from the billing seller (`BILLING_SELLER_ENTITY_ID`). New sign-ups must tick a box agreeing to them. Owners and admins of existing organisations see a banner until one of them accepts. Each acceptance is kept permanently with the user, organisation, version and time. When the Terms change, raise `TERMS_VERSION` in `src/app/terms.ts` and every organisation is asked again.
