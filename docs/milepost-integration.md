# MilePost integration

TrailBook's side of the MilePost ↔ TrailBook link, built to the integration spec dated 28 Oct 2026 (Part A). MilePost (`pomeroy-agency/pa-crm`, live at https://crm.pomeroyagency.com) builds its own side: the TrailBook tile under Accounting & payroll, the OAuth client, and the TrailBook tab in its sidebar.

## How it works

Every link covers one business (a TrailBook entity), never the whole organisation.

1. **MilePost → TrailBook (OAuth 2.0).** An admin clicks Connect on MilePost's TrailBook tile. MilePost sends them to TrailBook's consent page, where they sign in (with two-factor if it's on), choose the business, read what MilePost will be able to do, and click Allow. Only an owner or admin can allow it. MilePost gets a code, swaps it for tokens, and from then on adds customers, issues invoices for won deals and reads back what's paid.
2. **TrailBook → MilePost (API key).** For the MilePost tab inside TrailBook, an owner or admin pastes a MilePost API key under Integrations, step 2. TrailBook checks it against MilePost's `/me`, seals it with `PII_KEY`, and uses it only on the server. The tab lists MilePost contacts and can add one as a TrailBook customer.

**Tabs.** TrailBook shows a MilePost tab while either link is live (and, once MilePost's `/me` reports a subscription, while that subscription is active). MilePost shows its TrailBook tab while `GET /api/v1/company` says `subscription.active` is true.

**Only MilePost creates invoices from won deals.** TrailBook doesn't subscribe to MilePost's `deal.won`.

## What data moves

| Data | Direction | Notes |
| --- | --- | --- |
| Customers: name, email, phone, MilePost contact id | MilePost → TrailBook | Matched on the MilePost id first, then email; never duplicated. A vendor with the same email becomes "customer and vendor". |
| Invoices for won deals | MilePost → TrailBook | Posted to receivables at once, like any invoice. Sales tax is worked out by TrailBook. |
| Invoice status: total, paid, balance, open/partial/overdue/paid/void | TrailBook → MilePost | Only invoices MilePost created. |
| Business name, currency, subscription status | TrailBook → MilePost | |
| CRM contacts: name, email, phone, job title, stage | MilePost → TrailBook (read on demand) | Shown on the MilePost tab; nothing is copied unless someone clicks "Add as customer". |

Never shared: Social Security numbers, bank and card numbers, payroll, employee records, the ledger itself, other businesses.

## Security

- Codes (10 minutes, one use), access tokens (1 hour) and refresh tokens (90 days, rotated on each use) are random 32-byte values; only SHA-256 hashes are stored.
- A refresh token or code used twice revokes the whole connection, since it means a token was copied.
- A connection works only while the person who approved it is still an owner or admin, and has two-factor on if the organisation requires it.
- Writes stop with `402 subscription_inactive` when the business's subscription has lapsed.
- MilePost acts with the bookkeeper's permissions: it can't use soft-closed periods, set a customer's tax status, or touch payroll.
- Connecting, disconnecting, settings changes and every customer and invoice MilePost makes are in the audit chain, with the actor `app:milepost`.
- The MilePost API key is sealed with AES-256-GCM under `PII_KEY`; the browser only ever sees its last four characters.

## For MilePost: endpoints

Base URL: `https://app.pomeroyagency.com` (production). Deploy previews use their own Netlify address.

### OAuth

| Item | Value |
| --- | --- |
| Authorize | `GET /oauth/authorize?client_id=…&redirect_uri=…&response_type=code&scope=…&state=…` |
| Token | `POST /oauth/token`, form-encoded, HTTP Basic `client_id:client_secret`. `grant_type=authorization_code` (with `code`, `redirect_uri`) or `refresh_token` (with `refresh_token`). |
| Token response | `{ access_token, refresh_token, expires_in: 3600, token_type: "Bearer", scope, company_id }` |
| Callback | `redirect_uri?code=…&state=…&company_id=<entity id>`; on Cancel, `error=access_denied` |
| Redirect URI allowed | `https://crm.pomeroyagency.com/api/integrations/trailbook/callback` (exact match) |
| Scopes | `customers:write invoices:write invoices:read company:read` |
| Revoke | `POST /oauth/revoke` with `token=<refresh token>`, same Basic auth. Always 200. |

Store the new refresh token after every refresh: the old one stops working, and presenting it again disconnects. Refresh from one place at a time (for example, under a lock), so the sync and a page view never spend the same refresh token twice.

### REST (Bearer access token, JSON)

Errors are a non-2xx status with `{ "error": { "code", "message" } }`. Amounts are strings with two decimals.

- `GET /api/v1/company` → `{ id, name, currency, subscription: { active, status, plan, renews_at } }`. `status` is `trialing`, `active`, `past_due`, `canceled` or `free`.
- `GET /api/v1/customers?email=` → `[{ id, display_name, email, phone, external_ref }]`
- `POST /api/v1/customers` with `{ display_name, given_name, family_name, email, phone, company_name, external_ref }` → 201 when created, 200 when it found the customer (by `external_ref`, then email) and updated it.
- `POST /api/v1/invoices` with `{ customer_id, currency?, due_date?, memo?, external_ref, lines: [{ description, quantity, unit_price, tax_category?, item_id? }] }` → 201 `{ id, number, total, balance, status, … }`; the same `external_ref` again returns the first invoice (200). The invoice is dated today (Pacific time) and due on `due_date`, or on receipt. A line without `tax_category` uses the kind of sale the business chose for MilePost on TrailBook's Integrations page (default: professional or creative service, not taxable in California).
- `GET /api/v1/invoices/:id` → `{ id, number, customer_id, total, paid, balance, status: "open" | "partial" | "overdue" | "paid" | "void", external_ref, updated_at, … }`
- `GET /api/v1/invoices?updated_since=ISO` → the invoices MilePost created that were issued, paid or voided since then, oldest change first, up to 200.

### Not built yet

Webhooks from TrailBook (`invoice.paid`, `invoice.voided`, `subscription.changed`) are left for later; MilePost's 10-minute poll of `/invoices?updated_since` and `/company` covers paid status and the tab.

## What the MilePost tab in TrailBook would use next (Part B gaps)

In order of use:

1. A subscription flag on `GET /me` (`subscription: { active }`), so TrailBook hides its MilePost tab when MilePost lapses. TrailBook already reads it if present.
2. `GET /deals` filtered by contact, to show open and won deals next to each customer.
3. OAuth for MilePost itself, to replace pasting an API key.

`GET /contacts/:id` with the timeline and `GET /companies` aren't needed yet.

## Setup

On TrailBook's Netlify site:

| Variable | Value |
| --- | --- |
| `MILEPOST_OAUTH_CLIENT_ID` | `milepost` |
| `MILEPOST_OAUTH_CLIENT_SECRET` | Make one with `openssl rand -base64 32` and paste the same value into MilePost's `TRAILBOOK_CLIENT_SECRET`. Never in chat or email. |
| `MILEPOST_URL` | Optional; default `https://crm.pomeroyagency.com` |
| `MILEPOST_OAUTH_REDIRECT_URIS` | Optional, comma-separated; default `<MILEPOST_URL>/api/integrations/trailbook/callback` |

On MilePost's Netlify site: `TRAILBOOK_CLIENT_ID=milepost`, `TRAILBOOK_CLIENT_SECRET` (the same secret), `TRAILBOOK_API_BASE=https://app.pomeroyagency.com`.
