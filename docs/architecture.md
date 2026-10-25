# Architecture (Phase 0)

## Layers

1. **Database (PostgreSQL 16).** The last line of defence. Rules that must hold no matter what the application does live here as constraints and triggers:
   - `journal_entry_balanced`: deferred constraint trigger; at commit every entry has two or more lines and debits equal credits in each currency.
   - `reject_mutation`: `UPDATE`, `DELETE` and `TRUNCATE` on `journal_entries`, `journal_lines` and `audit_events` raise `IMMUTABLE`. Periods can change status but never their dates, and can't be deleted.
   - `journal_lines_same_tx`: lines can only be added in the transaction that created the entry.
   - `journal_entries_check_period`: the entry date must fall inside its period; locked periods refuse everything; soft-closed periods need the session flag `app.allow_soft_closed`.
   - Composite foreign keys tie every line's account and entry to the same organisation and entity.
   - Row-level security on every table, keyed on `app.org_id`. The application connects as the owner but each tenant transaction runs `SET LOCAL ROLE altqbo_app`, which has no `BYPASSRLS`.
   - `audit_heads_forward_only`: the chain head can only advance by one, to the newest event.

2. **Services (`src/core`).** `postJournal` is the only writer to the ledger. It resolves accounts by code or system key, checks roles, enforces idempotency (same key + same content returns the original; same key + different content is refused), assigns the next gapless number, and appends the audit event in the same transaction.

3. **Rules (`src/rules`).** Plain data, deep-frozen at load, hashed. `resolveRules(place, date)` returns the federal and state packs in force; every pay run records `id@version#hash` for the packs it used.

4. **Payroll (`src/payroll`).** Pure functions: hours split, federal Worksheet 1A, California Method B, gross-to-net. `approveAndPostPayRun` adds the two-person rule, freezes the figures in the audit log, and posts one entry per run.

5. **Invoices and bills (`src/core/documents.ts`).** Ported from the Ledgerline prototype, where these rules ran only in the browser. Triggers on `documents`, `document_lines` and `document_payments` enforce: line amount = quantity x price and tax = rate on taxable lines (rounded half-up); totals = sum of lines; at commit, a document must have a posting entry that carries its total to receivables or payables; an issued document only changes by voiding, which must point at the reversal of its entry and is refused once payments exist; a payment can't exceed the amount due and must be backed by its own entry. Invoice and bill numbers are gapless per entity.

6. **Bank feed (`src/core/bank.ts`).** Statement lines are imported into `bank_lines` with a dedupe key per bank account (date, amount, description and which repeat it is in the file), so overlapping statements import safely and the database refuses the same line twice. Imported lines never change. A recorded line must point at an entry that moves exactly its amount through that bank account; a categorised line returns to review only after its entry is reversed, and a line that paid an invoice or bill stays recorded. The journal's reverse action refuses entries owned by invoices, bills, payments and bank lines, so those records can't drift from the ledger.

7. **Reconciliation (`src/core/reconcile.ts`).** A completed reconciliation records the statement date and balance, the beginning balance and the cleared journal lines. The database requires each one to start from the previous statement's ending balance, to be dated after it, and (at commit) for beginning + cleared lines = statement balance. A journal line can be cleared only once, only on its own bank account and only if dated on or before the statement. Reconciliations are append-only.

8. **Reports and books health (`src/core/statements.ts`).** Every report is a query over posted journal lines grouped by each account's statement line, so reports can't disagree with the trial balance. The balance sheet doesn't depend on a closing entry: income before the fiscal year start shows as prior years' earnings and income since as current year earnings. The health check reads the same data and only reports; it never changes the books.

9. **Team (`src/app/team.ts`).** An invitation stores the email, role and a SHA-256 hash of a random link token; it expires after 14 days. Accepting needs the token and a signed-in user with the invited email, so a forwarded link is useless to anyone else. The database lets an invitation settle once (accepted or revoked, never edited or deleted), refuses acceptance by a different email or after expiry, and checks at commit that every organisation still has an owner. Invitations, role changes, removals and leaving are in the audit chain.

10. **Chart of accounts (`src/core/accounts.ts`).** New accounts are added by kind (bank account, credit card, expense and so on), which fixes the type, subtype, statement line and cash-flow class; receivables, payables and payroll control accounts stay system-only. Tax lines can only be codes the entity's template already uses for its return and account type. A trigger on `accounts` refuses a statement line that doesn't suit the type, any change to code, type, subtype or system key, deleting, and deactivating a system account or one with a balance. A trigger on `journal_lines` refuses posting to an inactive account and takes a share lock on the account, so a deactivation and a posting can't cross.

## Money

Amounts are `bigint` minor units with a currency everywhere outside the tax math. Rates and per-period tax math use `decimal.js` (40 digits), rounding half-up to cents only at the end of each tax. Postgres `int8` parses as `BigInt`. No floats touch money.

## Audit chain

Each event's hash is SHA-256 over the canonical JSON (sorted keys) of its fields plus the previous hash. The first event chains from `sha256("alt-qbo:audit-genesis:" + orgId)`. `verifyAuditChain` recomputes the chain and checks the head, so it catches edits made by anyone who disabled the triggers, and deleted events, including the last one. A later step is anchoring the head hash externally (for example, a daily signed checkpoint) so a full rewrite of chain and head is also detectable.

11. **Overview and closing (`src/core/overview.ts`).** The money figures are read from posted lines and open documents on the same basis as the reports, and the menu badges come from one counting query run on every screen. Closing the books through a date is a loop over `setPeriodStatus`, so it obeys the same role checks and audit events as closing one month, plus one `books.closed_through` event; it never reopens anything. The example business is built with the ordinary services (`issueDocument`, `recordPayment`, `importBankCsv`) in a separate organisation, one per person.

## Not in Phase 0 yet

- Multi-currency functional amounts and revaluation (lines carry a currency and balance per currency today).
- Persisted employees, pay runs, NACHA files, deposit schedules and prepared forms (941, 940, DE 9, DE 9C, W-2, DE 34).
- HTTP API, authentication, MFA; roles are passed in by the caller.
- City minimum wages, regular-rate overtime for bonuses, supplemental-rate withholding.
