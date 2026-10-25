# Alt-QBO's own sales tax from 2027

From January 1, 2027, California taxes prewritten software, including SaaS (SB 122, Rev. & Tax. Code §6016.1). Alt-QBO's subscription fees to California customers become taxable then. This page covers what the business selling Alt-QBO has to do, and how to bill and report through Alt-QBO itself.

Alt-QBO has no subscription billing of its own. The plan is for the selling business to use Alt-QBO's invoicing like any other client. The invoicing already taxes software by the customer's billing address and access period (PR #22). This change adds the seller's permit, filing frequency and the return worksheet.

## Steps for Greg

1. **Decide which legal entity sells Alt-QBO.** The permit, the returns and the liability belong to whoever contracts with customers. If that business already holds a California seller's permit, no new permit is needed. Add the new activity and update the expected sales with the CDTFA instead.
2. **Apply for a seller's permit before the first taxable invoice.** Apply through CDTFA online services, under registering a new business or activity. There is no fee, but the CDTFA can ask for a security deposit. Timing matters. Alt-QBO taxes software by the access period, so a December 2026 invoice for January 2027 access already charges tax. The permit therefore has to be in place before December's invoices go out, not by January 1. Rev. & Tax. Code §6066 requires the permit before making taxable sales.
3. **Note the filing frequency the CDTFA assigns.** It comes with the permit and depends on the taxable sales you estimate in the application (monthly, quarterly, quarterly with prepayments, or yearly). You can ask the CDTFA to change it later.
4. **Record both in Alt-QBO.** In the selling business, open **Sales tax** (under Accountant tools) and enter the permit number and frequency.
5. **Set up the product.** Under **Products and services**, add the subscription with the kind of sale "Software or app access". Each customer needs a billing address. Without one, Alt-QBO won't issue a taxed software line.
6. **Invoice with access dates.** Every subscription line carries the first and last day of access. The tax follows those dates, not the invoice date.
7. **File and pay each period.** Open the period on the Sales tax page, read the warnings, and copy the figures into CDTFA online services by the due date shown. Then record the payment in the books by debiting Sales tax payable (2200) and crediting the bank, or match it on the Bank page.

## For Greg's legal review

- **Tax-exclusive pricing and reimbursement.** The terms of service should say that prices exclude sales tax and that the customer pays California sales tax reimbursement where it applies. That way the Civil Code §1656.1 presumption works in Alt-QBO's favor. Invoices already show the tax as its own line.
- **Accounting and HR firm channel.** A firm that buys seats and resells them to its clients can give a resale certificate (CDTFA-230), and then those sales aren't taxed. A firm that buys for its own use, or that only refers clients, can't. How the reseller agreements are written decides which case applies.
- **Bundled services.** Setup, training or bookkeeping sold with the subscription should be priced and invoiced as separate lines, with the kind of sale "Professional or creative service". Whether a bundled single price is wholly taxable under the final Regulation 1600 is still open.
- **Customers outside California.** Software billed to an address outside California carries no California tax, and Alt-QBO deducts it on the return. Other states tax SaaS under their own rules and economic-nexus thresholds, which is out of scope here.
- **Large customers.** A customer buying over $5,000,000 of software a year from one seller reports the tax itself under a use tax direct payment permit. This is unlikely to come up for Alt-QBO, but the customer settings support it.
- **Use tax on Alt-QBO's own purchases.** From 2027, SaaS the business buys for use in California from a seller that doesn't charge California tax owes use tax. That amount goes on the same return under "purchases subject to use tax". Alt-QBO doesn't compute this line yet.
- **Unverified here.** ca.gov is blocked from the build environment, so these come from working knowledge and search extracts and need checking: the due-date and prepayment rules in `docs/rule-pack-review.md` (Sales and use tax return worksheet), and the final regulation text once the OAL approves it.

## What the app does

- **Sales tax page** (Accountant tools). It records the seller's permit number and filing frequency, and lists each return period with its due date, plus prepayment dates on quarterly prepay accounts.
- **Return worksheet.** For each period it shows total sales, every deduction (resale, interstate, nontaxable services, SB 122 direct-pay and multiple-points-of-use software), taxable sales, state and local tax at 7.25%, district tax by place (Schedule A), and the total. It compares that total with the tax charged on invoices.
- **Warnings.** The worksheet warns when no permit or frequency is recorded, when tax charged is more than the return computes (which must be paid over, §6901.5), when a rate was set by hand, and when an invoice from an earlier period was voided.
- **Invoices.** An invoice that charges tax while no seller's permit is recorded shows a warning. It is still issued.
