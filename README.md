# TrailBook

Accounting platform for small businesses, built as an alternative to QuickBooks Online.
This repository holds **Phase 0**: the core every module builds on.

| Piece | Where | What it guarantees |
|---|---|---|
| Ledger core | `src/core/ledger.ts`, `netlify/database/migrations/` | Double entry, balanced per currency; posted entries never change (corrections are reversals); gapless entry numbers; idempotency keys so a replay never double-posts |
| Periods | same | Monthly periods per entity: open, soft-closed (accountants only), locked (nobody). Reopening needs an owner or accountant and a reason, and is flagged in the audit log |
| Multi-tenancy | `src/core/tenancy.ts`, `src/db/pool.ts` | Organisations own entities; Postgres row-level security hides every other tenant's rows |
| Team | `src/app/team.ts`, `netlify/database/migrations/20261025000004_invitations.sql` | Invite by email with a role; the person joins by signing up or signing in with that email through a one-time link, so nobody sets passwords for anyone else. Change roles, remove members, leave. Admins can't touch owners, and an organisation always keeps an owner |
| Email | `src/app/mail.ts`, `src/app/email-auth.ts`, `netlify/database/migrations/20261025000006_email.sql` | Sent over SMTP through Brevo or a Gmail mailbox ([setup](docs/email-setup.md)): sign-in links, password reset (signs out every other session), email confirmation, and team invitations. Links are one-time, short-lived, stored only as hashes, limited to five per person per hour, and point at the configured site address. Forms never reveal whether an account exists |
| Audit log | `src/core/audit.ts` | Append-only, one SHA-256 hash chain per organisation, written in the same transaction as the change; `verifyAuditChain` detects edits and deletions |
| Jurisdiction engine | `src/rules/` | Versioned, effective-dated, frozen rule packs: US federal 2026 and California 2026. The principal place of business sets framework, currency, chart of accounts, retention |
| Chart of accounts | `src/rules/coa/us-service.ts`, `src/core/accounts.ts` | Service-business template; every account mapped to a statement line, a cash-flow class and tax-line codes for Schedule C, 1065, 1120S and 1120. Add accounts by kind, rename, remap tax lines (only codes the template uses for the entity's return), deactivate at a zero balance. The database keeps statement lines matched to type, codes and kinds fixed, system accounts on, and nothing posting to an inactive account |
| Payroll (calculate only) | `src/payroll/` | California workweek overtime, gross-to-net (FIT, FICA, Additional Medicare, FUTA, CA PIT Method B, SDI, UI, ETT), sick-leave accrual, minimum-wage and exempt-salary blockers, two-person approval, posting to the ledger |
| Invoices and bills | `src/core/documents.ts`, `netlify/database/migrations/20261025000001_receivables_payables.sql` | Customers and vendors (with addresses and resale certificates); invoices and bills, each posted to receivables or payables when issued; partial payments; void by reversal; aging. The database checks line math, totals, the posting entry, and refuses edits and overpayments |
| Getting paid | `src/core/invoicing.ts`, `netlify/functions/invoice-automation.mts`, `web/view.html`, `netlify/database/migrations/20261112000001_invoicing.sql` | Estimates (never posted; accepting one issues the invoice, taxed on its own date). Recurring invoices and bills, issued each morning on their schedule with one idempotency key per template and date, catching up when behind; a failure stays on the schedule and is emailed to the business once. Invoices emailed from the business's name at TrailBook's address, replies to the business, with a no-sign-in view link (only the token's hash is stored). Optional automatic reminders 3 days before the due date and 1, 7, 14 and 30 days after, each once per invoice. Every customer email is logged. TrailBook never collects the money |
| Sales tax (California) | `src/core/sales-tax.ts`, `src/rules/sales-tax/us-ca-2026.ts`, `src/app/cdtfa.ts`, `netlify/database/migrations/20261025000007_sales_tax.sql` | Worked out automatically on each invoice. Products and services carry a kind of sale (professional service, physical goods, printed materials and so on) that decides whether California taxes it; the rate for the customer's address (or the business's own) comes from the CDTFA's rate lookup. Resale certificates and out-of-state delivery are exempt. An owner or accountant can set a rate by hand, with a reason, when the lookup can't be used. The rate, where it came from and the address are frozen on the invoice. Sales tax report with the CDTFA return figures and a breakdown by tax area; prepares only, never files or pays |
| Bank feed | `src/core/bank.ts`, `netlify/database/migrations/20261025000002_bank_feed.sql` | CSV statement import (one Amount column or separate withdrawal and deposit columns), duplicate skipping, suggested matches to open invoices and bills or a past category; each line is matched, categorised or excluded. The database refuses re-imports, edits to imported lines, and recording a line twice or for the wrong amount |
| Bank rules | `src/core/bank-rules.ts` | "Description contains" rules, optionally by direction, amount range and bank account, that suggest a category or record matching lines on import (skipped when the month is closed). The oldest matching rule wins; open invoices and bills with the same amount are suggested first. Rules are switched off, never deleted |
| Receipts and files | `src/core/attachments.ts`, `netlify/database/migrations/20261112000002_bank_rules_receipts.sql` | PDFs and photos (up to 4 MB, type checked from the bytes) on invoices, bills, bank lines and journal entries, kept in their own Netlify Blobs store with a SHA-256 checked on every download. Served sandboxed, never as a page. Removal keeps the record and the audit trail |
| Reconciliation | `src/core/reconcile.ts`, `netlify/database/migrations/20261025000003_reconciliation.sql` | Tick ledger lines on a bank account against a statement; completes only at zero difference, starting from the previous statement's ending balance. Each line clears once, and completed reconciliations never change |
| Financial reports | `src/core/statements.ts` | Profit and loss (gross, operating and net income), statement of cash flows (indirect method, by each account's cash flow class, tied out to the cash accounts), balance sheet (with prior and current years' earnings in equity, flagged if it doesn't balance), general ledger with running balances for one account or all of them, receivables and payables aging; date presets (this month, last quarter, this fiscal year and so on); each downloads as CSV |
| Overview | `src/core/overview.ts` | The entity's first screen: cash, what customers owe, what you owe vendors, profit this fiscal year and sales tax held, a to-do list (bank lines to review, overdue invoices, bills due within a week, pay runs to approve, also shown as menu badges) and recent activity |
| Books health | `src/core/statements.ts` (`booksHealth`) | On the Overview: trial balance and balance sheet in balance, bank lines reviewed, bank accounts reconciled within 45 days, overdue invoices, past months closed, EIN on file. Bookkeeping checks, not a compliance determination |
| Close the books | `src/core/overview.ts` (`closeBooksThrough`) | One "closed through" date: locks (or soft-closes) every month ending on or before it, oldest first, each through the normal period rules. Month-by-month control stays available |
| Example business | `src/app/example.ts` | A made-up California design studio with a year of invoices, bills, payments and a bank statement to review, created in its own organisation so it never mixes with real books |
| Backup | `src/core/backup.ts` | "Download a backup" on the Overview (owners, admins, accountants): one JSON file with every row behind the books and the organisation's audit chain, a checksum that catches edits, and no passwords, session or email-link tokens, or connection credentials. Each download is in the audit log |
| Two-factor sign-in | `src/app/mfa.ts`, `netlify/database/migrations/20261029000001_two_factor.sql` | Authenticator-app codes (TOTP) after the password or an emailed link, each code used once, five tries per sign-in, ten one-time recovery codes; the secret is sealed with PII_KEY. Owners can require it for everyone |
| Nightly backups | `src/core/nightly-backups.ts`, `netlify/functions/nightly-backups.mts` | Each night, every business's backup is encrypted (BACKUP_KEY), stored in Netlify Blobs apart from the database, read back and checked (checksum, audit chain, every entry balanced, every account matching the live books) and kept 30 days. Restore points on the Overview; failures email OPS_EMAIL |
| Billing | `src/billing/`, `netlify/functions/billing-run.mts`, `netlify/database/migrations/20261029000003_billing.sql` | TrailBook's own subscriptions: 30-day trial, Books and Books + Payroll monthly or yearly, extra businesses, people paid, founding price lock, partner discount. Each charge is an invoice in the seller's own books, then the card saved on Stripe's page is charged. Unpaid organisations become read-only, never deleted. Setup: [docs/launch-setup.md](docs/launch-setup.md) |
| Public pages | `web/pricing.html`, `web/promises.html`, `web/security.html`, `web/status.html` | Prices, promises, how the books are protected, and live service status |
| Tax export | `src/core/reports.ts` | Trial balance by tax line as CSV for Intuit tax software; an unmapped account blocks the export, not the books |

Payroll **never moves money or files returns**. It calculates and prepares; the client or their accountant pays and files.

## Running it

Needs Node 22 and PostgreSQL 16.

```sh
npm install
npm test                       # creates a throwaway database on postgres://postgres@localhost:5432
DATABASE_URL=postgres://... npm run migrate
DATABASE_URL=postgres://... npm run demo
```

Set `TEST_DATABASE_ADMIN_URL` if your test server is elsewhere. `DEV_MAIL=log npm run dev` prints emails to the console instead of sending them, and `DEV_TAX_RATES=sample` uses stand-in sales tax rates instead of asking the CDTFA.

## Rule packs

The 2026 federal, California payroll and California sales tax packs are `released` (Greg's sign-off, 2026-10-27). Saved pay runs calculate with `live: true`, so they refuse any pack that is still `draft`; a new year's pack has to be reviewed and released before its first pay date. The 2027 sales tax pack is a draft until CDTFA's SB 122 regulations are approved. Each pack lists its sources and review items in `reviewNotes`. See [docs/rule-pack-review.md](docs/rule-pack-review.md).

## Design notes

See [docs/architecture.md](docs/architecture.md).
