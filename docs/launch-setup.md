# Switching on paid accounts

What has to be set up before Alt-QBO charges anyone, and what each piece does. Prices and promises were approved on 2026-10-25 ([pricing doc](https://claude.ai/artifact/H5LJ9pvNnn8aQabuA8Un94)); the matching terms of service changes (sections 4.2, 4.3, 5.2 and 10) are in the [terms of service doc](https://claude.ai/artifact/DrN5xh3U7RnPHrF2HKwxHa).

Until these are set, nothing changes for anyone: every organisation keeps full use, and nobody is charged.

## Environment variables (Netlify, Site configuration, Environment variables)

| Variable | What it does | How to make it |
| --- | --- | --- |
| `BACKUP_KEY` | Encrypts the nightly backups. Without it the nightly backup function skips and logs why. Keep a copy somewhere safe outside Netlify: without the key the copies can't be opened. | `openssl rand -base64 32` |
| `OPS_EMAIL` | Gets an email when a nightly backup fails its check, or a charge needs a person. | Your address |
| `STRIPE_SECRET_KEY` | Card payments. Use the test key (`sk_test_…`) first, then the live key. | Stripe dashboard, Developers, API keys |
| `BILLING_SELLER_ORG_ID`, `BILLING_SELLER_ENTITY_ID` | The Alt-QBO organisation and business whose books get each subscription invoice and payment: your California LLC. That organisation is never charged. | Open the business in Alt-QBO; the address bar shows `#/e/<entity id>/…`. The organisation id is in `GET /api/me`. |
| `BILLING_BANK_ACCOUNT` | Optional. The bank account code card payments are recorded to, such as a "Stripe" clearing account you add under Chart of accounts. Default: the operating account. | Chart of accounts |
| `BILLING_ENFORCE` | `true` pauses changes (never reading or downloading) for an organisation whose trial ended unpaid, whose payment is 14 days overdue, or whose subscription ended. It also keeps payroll changes to Books + Payroll. Leave it off until card payments work end to end. | `true` |

`PII_KEY` (already set) now also seals the two-factor secrets.

## Order of steps

1. Set `BACKUP_KEY` and `OPS_EMAIL`. The next night, the Overview of each business shows "Last nightly backup … read back and matched the books", and `/status.html` shows the night's count.
2. In your own books (the selling LLC): check the seller's permit is recorded on the Sales tax page, and add a bank account for Stripe payouts if you want one.
3. Set `STRIPE_SECRET_KEY` (test key), `BILLING_SELLER_ORG_ID` and `BILLING_SELLER_ENTITY_ID`. Redeploy.
4. With a test organisation: Billing, save details, Add a card (Stripe's test card 4242 4242 4242 4242), then let the trial end (or move `trial_ends_on` back in the database) and wait for the 8 a.m. run. The invoice appears in your own books, paid.
5. Switch to the live Stripe key and set `BILLING_ENFORCE=true`.

## What runs on a schedule

| Function | When (UTC) | What it does |
| --- | --- | --- |
| `nightly-backups` | 10:00 (2 to 3 a.m. Pacific) | Encrypted copy of every business except practice examples, stored in Netlify Blobs (store `backups`), read back and checked, kept 30 days |
| `billing-run` | 16:00 (8 to 9 a.m. Pacific) | Renewals, people billed monthly on yearly payroll plans, retries every 3 days, receipts and failure emails |
| `deposit-reminders` | 15:00 | Unchanged |

## Things done by hand for now

- **Refunds** for a yearly plan cancelled within 60 days: refund the unused whole months in the Stripe dashboard, then record a credit or refund in your books.
- **Partner firms.** For a client a firm brought in with the 20% discount, set it once: `UPDATE subscriptions SET partner_org_id = '<firm org id>', partner_discount_pct = 20 WHERE org_id = '<client org id>';` Referral fees are paid outside the app.
- **Price changes** for existing customers: every subscription keeps the price list it started with, so a change in `src/billing/plans.ts` only affects new sign-ups. Moving existing customers is a deliberate update after the 60-day notice, at most once a year and at most 10%.
- **Held charges** (an invoice that couldn't be made, or Stripe didn't answer): `OPS_EMAIL` gets a list. Check the Stripe dashboard before charging again.
- **Security contact.** `web/security.html` says "to be added before launch" where the address for reporting a security problem goes.

## Two-factor sign-in

Anyone can turn it on under Your account. An owner can require it for everyone on the Team page. Losing the phone: one of the ten recovery codes works once. Locked out entirely: there's no self-service reset yet, so an operator clears `totp_secret` and `totp_enabled_at` for that user after checking who they are.
