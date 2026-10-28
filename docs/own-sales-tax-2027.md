# TrailBook's own sales tax from 2027

From January 1, 2027, California taxes prewritten software, including SaaS (SB 122, Rev. & Tax. Code §6016.1). TrailBook's subscription fees to California customers become taxable then. This page covers what the business selling TrailBook has to do, and how to bill and report through TrailBook itself.

TrailBook has no subscription billing of its own. The plan is for the selling business to use TrailBook's invoicing like any other client. The invoicing already taxes software by the customer's billing address and access period (PR #22). This change adds the seller's permit, filing frequency and the return worksheet.

## Steps for Greg

1. **Decide which legal entity sells TrailBook.** The permit, the returns and the liability belong to whoever contracts with customers. If that business already holds a California seller's permit, no new permit is needed. Add the new activity and update the expected sales with the CDTFA instead.
2. **Apply for a seller's permit before the first taxable invoice.** Apply through CDTFA online services, under registering a new business or activity. There is no fee, but the CDTFA can ask for a security deposit. Timing matters. TrailBook taxes software by the access period, so a December 2026 invoice for January 2027 access already charges tax. The permit therefore has to be in place before December's invoices go out, not by January 1. Rev. & Tax. Code §6066 requires the permit before making taxable sales.
3. **Note the filing frequency the CDTFA assigns.** It comes with the permit and depends on the taxable sales you estimate in the application (monthly, quarterly, quarterly with prepayments, or yearly). You can ask the CDTFA to change it later.
4. **Record both in TrailBook.** In the selling business, open **Sales tax** (under Accountant tools) and enter the permit number and frequency.
5. **Set up the product.** Under **Products and services**, add the subscription with the kind of sale "Software or app access". Each customer needs a billing address. Without one, TrailBook won't issue a taxed software line.
6. **Invoice with access dates.** Every subscription line carries the first and last day of access. The tax follows those dates, not the invoice date.
7. **File and pay each period.** Open the period on the Sales tax page, read the warnings, and copy the figures into CDTFA online services by the due date shown. Then record the payment in the books by debiting Sales tax payable (2200) and crediting the bank, or match it on the Bank page.

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

- **Sales tax page** (Accountant tools). It records the seller's permit number and filing frequency, and lists each return period with its due date, plus prepayment dates on quarterly prepay accounts.
- **Return worksheet.** For each period it shows total sales, every deduction (resale, interstate, nontaxable services, SB 122 direct-pay and multiple-points-of-use software), taxable sales, state and local tax at 7.25%, district tax by place (Schedule A), and the total. It compares that total with the tax charged on invoices.
- **Warnings.** The worksheet warns when no permit or frequency is recorded, when tax charged is more than the return computes (which must be paid over, §6901.5), when a rate was set by hand, and when an invoice from an earlier period was voided.
- **Invoices.** An invoice that charges tax while no seller's permit is recorded shows a warning. It is still issued.
- **Reminders.** Once a filing frequency is recorded, owners, admins and accountants get an email up to 5 days before each return or prepayment is due, with the estimated tax and a link to the worksheet.

## Terms of Service

The approved Terms (version 2026-10-27) are published at `/terms.html`, with the Privacy Policy at `/privacy.html`. The company name on both comes from the billing seller (`BILLING_SELLER_ENTITY_ID`). New sign-ups must tick a box agreeing to them. Owners and admins of existing organisations see a banner until one of them accepts. Each acceptance is kept permanently with the user, organisation, version and time. When the Terms change, raise `TERMS_VERSION` in `src/app/terms.ts` and every organisation is asked again.
