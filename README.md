# Alt-QBO

Accounting platform for small businesses, built as an alternative to QuickBooks Online.
This repository holds **Phase 0**: the core every module builds on.

| Piece | Where | What it guarantees |
|---|---|---|
| Ledger core | `src/core/ledger.ts`, `netlify/database/migrations/` | Double entry, balanced per currency; posted entries never change (corrections are reversals); gapless entry numbers; idempotency keys so a replay never double-posts |
| Periods | same | Monthly periods per entity: open, soft-closed (accountants only), locked (nobody). Reopening needs an owner or accountant and a reason, and is flagged in the audit log |
| Multi-tenancy | `src/core/tenancy.ts`, `src/db/pool.ts` | Organisations own entities; Postgres row-level security hides every other tenant's rows |
| Team | `src/app/team.ts`, `netlify/database/migrations/20261025000004_invitations.sql` | Invite by email with a role; the person joins by signing up or signing in with that email through a one-time link, so nobody sets passwords for anyone else. Change roles, remove members, leave. Admins can't touch owners, and an organisation always keeps an owner |
| Audit log | `src/core/audit.ts` | Append-only, one SHA-256 hash chain per organisation, written in the same transaction as the change; `verifyAuditChain` detects edits and deletions |
| Jurisdiction engine | `src/rules/` | Versioned, effective-dated, frozen rule packs: US federal 2026 and California 2026. The principal place of business sets framework, currency, chart of accounts, retention |
| Chart of accounts | `src/rules/coa/us-service.ts`, `src/core/accounts.ts` | Service-business template; every account mapped to a statement line, a cash-flow class and tax-line codes for Schedule C, 1065, 1120S and 1120. Add accounts by kind, rename, remap tax lines (only codes the template uses for the entity's return), deactivate at a zero balance. The database keeps statement lines matched to type, codes and kinds fixed, system accounts on, and nothing posting to an inactive account |
| Payroll (calculate only) | `src/payroll/` | California workweek overtime, gross-to-net (FIT, FICA, Additional Medicare, FUTA, CA PIT Method B, SDI, UI, ETT), sick-leave accrual, minimum-wage and exempt-salary blockers, two-person approval, posting to the ledger |
| Invoices and bills | `src/core/documents.ts`, `netlify/database/migrations/20261025000001_receivables_payables.sql` | Customers and vendors; invoices with user-entered sales tax and bills, each posted to receivables or payables when issued; partial payments; void by reversal; aging. The database checks line math, totals, the posting entry, and refuses edits and overpayments |
| Bank feed | `src/core/bank.ts`, `netlify/database/migrations/20261025000002_bank_feed.sql` | CSV statement import (one Amount column or separate withdrawal and deposit columns), duplicate skipping, suggested matches to open invoices and bills or a past category; each line is matched, categorised or excluded. The database refuses re-imports, edits to imported lines, and recording a line twice or for the wrong amount |
| Reconciliation | `src/core/reconcile.ts`, `netlify/database/migrations/20261025000003_reconciliation.sql` | Tick ledger lines on a bank account against a statement; completes only at zero difference, starting from the previous statement's ending balance. Each line clears once, and completed reconciliations never change |
| Financial reports | `src/core/statements.ts` | Profit and loss (gross, operating and net income), balance sheet (with prior and current years' earnings in equity, flagged if it doesn't balance), general ledger with running balances for one account or all of them, receivables and payables aging; date presets (this month, last quarter, this fiscal year and so on); each downloads as CSV |
| Overview | `src/core/overview.ts` | The entity's first screen: cash, what customers owe, what you owe vendors, profit this fiscal year and sales tax held, a to-do list (bank lines to review, overdue invoices, bills due within a week, pay runs to approve, also shown as menu badges) and recent activity |
| Books health | `src/core/statements.ts` (`booksHealth`) | On the Overview: trial balance and balance sheet in balance, bank lines reviewed, bank accounts reconciled within 45 days, overdue invoices, past months closed, EIN on file. Bookkeeping checks, not a compliance determination |
| Close the books | `src/core/overview.ts` (`closeBooksThrough`) | One "closed through" date: locks (or soft-closes) every month ending on or before it, oldest first, each through the normal period rules. Month-by-month control stays available |
| Example business | `src/app/example.ts` | A made-up California design studio with a year of invoices, bills, payments and a bank statement to review, created in its own organisation so it never mixes with real books |
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

Set `TEST_DATABASE_ADMIN_URL` if your test server is elsewhere.

## Rule packs are drafts

Both 2026 packs have `status: "draft"`. Previews work; a live pay run (`live: true`) refuses to run until a pack is reviewed and marked `released`. Each pack lists its sources and the items that need review in `reviewNotes`. See [docs/rule-pack-review.md](docs/rule-pack-review.md).

## Design notes

See [docs/architecture.md](docs/architecture.md).
