# Firm referral program

The website promises accounting and HR firms: "Clients you bring get 20% off
for as long as they stay, or your firm can take a 20% referral fee for their
first 12 months instead." This is how TrailBook keeps that promise.

## Firms

- **Referrals** page (owners and admins; shown in the menu for firms already
  in the program and for anyone who looks after more than one organisation):
  the firm accepts the [program terms](../web/referral-terms.html), picks a
  reward, and gets a code and a sign-up link (`/?ref=CODE#/signup`).
- Reward choice: `client_discount` (20% off every charge, for as long as the
  client stays) or `firm_fee` (20% of what the client pays, before tax, for
  billing periods starting within 12 months of its first paid period). A
  change applies only to clients linked after it.
- The page lists each referred client (name, status, reward, fee window,
  owed and paid) and every payout. It never shows the client's books.
- Payout email and a "how you'd like to be paid" note. Anything that looks
  like an account number is refused: bank details are never stored.

## Clients

- The code is entered at sign-up (filled in from the link) or on the Billing
  page, until the first payment. After that only the operator can change it.
- The Billing page discloses the firm and its reward, including that the firm
  is paid a fee, as AICPA ET 1.520 and many state boards expect.
- A firm's own owners or admins can't collect a fee on a business they own.

## Fees

- `accrueReferralFees` turns each paid charge of a `firm_fee` client inside
  the 12-month window into one `referral_fees` row (20% of `subtotal_minor`,
  rounded half up, in the charge's currency). It runs every morning in
  `billing-run` and whenever the operator opens the Referral fees page; it is
  idempotent (one fee per charge).
- Refunds and chargebacks: the operator cancels the owed fee with a reason.

## Paying firms (operator)

- **Referral fees** page, in the seller organisation (`BILLING_SELLER_ORG_ID`)
  for owners and admins. Recording a payout needs two-factor sign-in.
- On the 1st of each month `OPS_EMAIL` gets the firms owed $25 or more.
- Pay each firm outside TrailBook (ACH, Interac e-Transfer, cheque), then
  record it: all owed fees in that currency are marked paid, the firm is
  emailed, and the seller's books get a bill from the firm (vendor created
  on first payout), paid the same day from `BILLING_BANK_ACCOUNT`. The
  expense account defaults to 6000 Advertising; add a "Commissions and fees"
  account (Schedule C line 10) and use its code if preferred. A CAD payout
  asks for its USD cost from the bank statement.
- US firms: mark the W-9 received before paying. Fees paid to a US firm that
  isn't a corporation go on its 1099-NEC (2026 threshold $2,000); enter the
  vendor's tax form details in the seller's Contacts so Contractor forms
  picks it up.

Not built: automatic payouts (for example Stripe Connect transfers). Payouts
stay manual and recorded.
