# Alt-QBO

Accounting platform for small businesses, built as an alternative to QuickBooks Online.
This repository holds **Phase 0**: the core every module builds on.

| Piece | Where | What it guarantees |
|---|---|---|
| Ledger core | `src/core/ledger.ts`, `netlify/database/migrations/` | Double entry, balanced per currency; posted entries never change (corrections are reversals); gapless entry numbers; idempotency keys so a replay never double-posts |
| Periods | same | Monthly periods per entity: open, soft-closed (accountants only), locked (nobody). Reopening needs an owner or accountant and a reason, and is flagged in the audit log |
| Multi-tenancy | `src/core/tenancy.ts`, `src/db/pool.ts` | Organisations own entities; Postgres row-level security hides every other tenant's rows |
| Audit log | `src/core/audit.ts` | Append-only, one SHA-256 hash chain per organisation, written in the same transaction as the change; `verifyAuditChain` detects edits and deletions |
| Jurisdiction engine | `src/rules/` | Versioned, effective-dated, frozen rule packs: US federal 2026 and California 2026. The principal place of business sets framework, currency, chart of accounts, retention |
| Chart of accounts | `src/rules/coa/us-service.ts` | Service-business template; every account mapped to a statement line, a cash-flow class and tax-line codes for Schedule C, 1065, 1120S and 1120 |
| Payroll (calculate only) | `src/payroll/` | California workweek overtime, gross-to-net (FIT, FICA, Additional Medicare, FUTA, CA PIT Method B, SDI, UI, ETT), sick-leave accrual, minimum-wage and exempt-salary blockers, two-person approval, posting to the ledger |
| Invoices and bills | `src/core/documents.ts`, `netlify/database/migrations/20261025000001_receivables_payables.sql` | Customers and vendors; invoices with user-entered sales tax and bills, each posted to receivables or payables when issued; partial payments; void by reversal; aging. The database checks line math, totals, the posting entry, and refuses edits and overpayments |
| Bank feed | `src/core/bank.ts`, `netlify/database/migrations/20261025000002_bank_feed.sql` | CSV statement import (one Amount column or separate withdrawal and deposit columns), duplicate skipping, suggested matches to open invoices and bills or a past category; each line is matched, categorised or excluded. The database refuses re-imports, edits to imported lines, and recording a line twice or for the wrong amount |
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
