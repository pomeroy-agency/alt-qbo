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

## Money

Amounts are `bigint` minor units with a currency everywhere outside the tax math. Rates and per-period tax math use `decimal.js` (40 digits), rounding half-up to cents only at the end of each tax. Postgres `int8` parses as `BigInt`. No floats touch money.

## Audit chain

Each event's hash is SHA-256 over the canonical JSON (sorted keys) of its fields plus the previous hash. The first event chains from `sha256("alt-qbo:audit-genesis:" + orgId)`. `verifyAuditChain` recomputes the chain and checks the head, so it catches edits made by anyone who disabled the triggers, and deleted events, including the last one. A later step is anchoring the head hash externally (for example, a daily signed checkpoint) so a full rewrite of chain and head is also detectable.

## Not in Phase 0 yet

- Multi-currency functional amounts and revaluation (lines carry a currency and balance per currency today).
- Persisted employees, pay runs, NACHA files, deposit schedules and prepared forms (941, 940, DE 9, DE 9C, W-2, DE 34).
- HTTP API, authentication, MFA; roles are passed in by the caller.
- City minimum wages, regular-rate overtime for bonuses, supplemental-rate withholding.
