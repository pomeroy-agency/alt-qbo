# Pomeroy account hub

TrailBook's side of the Pomeroy account plan (v2.1, Oct 29, 2026): one Pomeroy account and one list of what each business has paid for, kept by the hub at `account.pomeroyagency.com`. These are the TrailBook items the plan marks "before phase 2". In phase 2 the hub only reads and records; nothing in TrailBook reads from the hub yet.

TrailBook stays its own billing engine (founding prices, people charges, extra businesses, partner discounts, invoices and sales tax in the seller's books). So instead of the hub reading TrailBook from Stripe, TrailBook tells the hub where each organisation stands.

Everything is off until `ACCOUNT_HUB_URL` and `ACCOUNT_HUB_SECRET` are set on Netlify (see `docs/launch-setup.md`).

## Signing

Every request in either direction carries:

```
x-pomeroy-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<payload>" with ACCOUNT_HUB_SECRET>
```

The payload is the raw JSON body for a POST, and `GET <path and query>` for a GET (for example `GET /api/hub/status?org=…`). A signature more than 5 minutes from the receiver's clock is refused, so a captured request can't be replayed later. The secret is at least 32 characters.

## TrailBook → hub: `POST {ACCOUNT_HUB_URL}/api/trailbook/status`

Sent when an owner or admin changes the plan, cancels, restarts or saves a card, and from the daily `billing-run` (16:00 UTC) for every organisation whose status changed since the hub last accepted one. The daily run is what catches changes that happen by date, such as a trial or grace period ending. A status the hub didn't accept (no answer, or not 2xx) is sent again by the next run. The hub should answer 2xx once it has stored the status.

```json
{
  "trailbook_org_id": "uuid",
  "name": "Sunset Design Studio",
  "kind": "business",
  "business_names": ["Sunset Design Studio LLC"],
  "businesses": 1,
  "plan_key": "trailbook_books",
  "status": "trialing",
  "access": "full",
  "trial_ends_on": "2026-11-28",
  "period_end": null,
  "comped": false,
  "comp_until": null,
  "comp_reason": null,
  "people": 0,
  "country": "US",
  "region_code": "CA",
  "reported_at": "2026-10-29T16:00:04.000Z"
}
```

| Field | Meaning |
| --- | --- |
| `plan_key` | `trailbook_books` or `trailbook_books_payroll` |
| `status` | TrailBook's own: `trialing`, `active`, `past_due`, `canceled`; `not_started` for an organisation that hasn't made a change yet (its trial starts then); `free` for TrailBook's own books |
| `access` | `full`; `grace` (a payment failed, inside the 14 days); `read_only` (trial or comp ended unpaid, 14 days overdue, or ended; books stay readable and downloadable); `ended` (more than 7 years after the last paid day) |
| `businesses` | Includes the first business, so the extra-business add-on quantity is `businesses - 1` |
| `people` | Different people paid in posted pay runs so far this calendar month |
| `country`, `region_code` | Where the first business is based |
| `comped` | Whether a complimentary period covers today |
| `comp_until`, `comp_reason` | Set while comped. `comp_until` is the last day it covers, or null for an open-ended one (the agency plans) |

Practice organisations are never sent. The status never includes email addresses, employees, pay, bank or card details.

## Hub → TrailBook: `GET /api/hub/status`

For the hub's nightly check. Signed as above.

- `GET /api/hub/status` → `{ "generated_at": "…", "orgs": [ <status>, … ] }`
- `GET /api/hub/status?org=<trailbook_org_id>` → `{ "org": <status> }`, or 404

## Hub → TrailBook: `POST /api/hub/comp`

Sets or ends a complimentary period. Signed as above.

```json
{ "trailbook_org_id": "uuid", "comped": true, "comp_until": "2027-10-31", "reason": "The Install", "plan_key": "trailbook_books_payroll" }
```

- **Dated** (The Install, 12 months): `comp_until` is the last day it covers, at most 3 years away.
- **Open-ended** (the agency plans): `comp_until: null`. It lasts until the hub ends it, when the agency plan ends.
- **End now:** `{ "trailbook_org_id": "uuid", "comped": false }`. Today is its last day.

The answer is `{ "org": <status> }`, and the new status is also pushed.

Approved Oct 29, 2026: Keep It Running includes Books (`trailbook_books`); Systems + Marketing, Full Engine and The Install include Books + Payroll (`trailbook_books_payroll`). The $4-per-person charge is comped in every case, since nothing is charged during a complimentary period.

While it lasts, everything on the plan is open and nothing is charged, people paid included. It replaces any trial still running. The day after it ends, the card on file is charged as for a trial that ended; with no card, the books go read-only until one is added. The Billing page shows "Complimentary" with the end date and reason.

Refused (409) while the organisation has a charge that isn't settled, so a comp never hides money owed; settle or waive that charge first. Also refused for TrailBook's own books. A dated end must be after today and at most 3 years away. Each change is in the organisation's audit chain as `billing.comp_set` or `billing.comp_ended`, by `app:account-hub`.

Not done here: a $0 invoice for a comp. A free subscription has no sales price, so none is issued; revisit if that changes.

## Hub → TrailBook: `POST /api/hub/entitlements-changed`

Sent when what an organisation holds at the hub changes. Signed as above.

```json
{ "type": "entitlements.changed", "trailbook_org_id": "uuid", "org_id": "<hub organisation id>", "ent_version": 7 }
```

TrailBook records the hub's organisation id and `ent_version` (a whole number from 1). A notice older than the last one it kept is ignored, so arriving out of order is harmless. The answer is `{ "ok": true, "org": <status> }`: TrailBook's own view, for the hub to compare. TrailBook's memberships, roles and billing still decide access on every request; nothing in TrailBook reads the hub's entitlements yet. 404 for an unknown organisation, 400 for a missing or bad `ent_version`.

## Hub → TrailBook: `POST /api/hub/signout`

The back-channel sign-out. Signed as above.

```json
{ "trailbook_user_id": "uuid" }
```

or, before a person's accounts are linked, `{ "email": "person@example.com" }` (any case). Every TrailBook session that person has ends at once. The answer is `{ "ok": true, "sessions_ended": 2 }`; 0 when there's no such TrailBook person. 400 when neither is sent.

## TrailBook sign-in rules

- A session ends after **12 hours without use**, and **7 days after sign-in** at most.
- Anyone who has two-factor on enters their code at **every new sign-in**, by password or emailed link. An organisation can require two-factor for everyone (Security page).
- **Payroll, bank details and tax filings need a session that passed the second factor**, whatever the organisation's setting: saving employees, payroll and direct deposit settings, creating and approving pay runs, recording tax deposit payments, sales tax settings, and downloading the direct deposit file, prepared payroll forms and the sales tax return. Reading payroll pages and previews stays open. Someone without two-factor is asked to turn it on (403, `code: "second_factor_required"`); turning it on counts for the session they're in. The example business is left out.
- A hub sign-in starts a session that hasn't passed TrailBook's second factor; anyone with two-factor on enters their code before the session starts.

## Signing in with a Pomeroy Account (phase 6)

TrailBook is a `kind: "jwt"` app in the hub's `HUB_CLIENTS`:

```json
{ "id": "<ACCOUNT_HUB_CLIENT_ID>", "name": "TrailBook", "kind": "jwt", "product": "trailbook",
  "secret_sha256": "<sha256 of ACCOUNT_HUB_CLIENT_SECRET>",
  "redirect_uris": ["https://app.pomeroyagency.com/api/auth/hub/callback"],
  "home_url": "https://app.pomeroyagency.com",
  "signout_url": "https://app.pomeroyagency.com/api/hub/signout" }
```

TrailBook needs `ACCOUNT_HUB_CLIENT_ID` and `ACCOUNT_HUB_CLIENT_SECRET` on top of `ACCOUNT_HUB_URL`. Without them the button doesn't show.

1. **Start:** "Sign in with Pomeroy Account" opens `GET /api/auth/hub/start`. TrailBook keeps a one-time state (hashed) and a PKCE verifier for 10 minutes, puts the state in an HttpOnly cookie on `/api/auth/hub`, and sends the person to the hub's `/authorize` with S256.
2. **Back from the hub:** `GET /api/auth/hub/callback?code=…&state=…`. The state must match the cookie and works once. TrailBook posts the code, the verifier and its client id and secret to the hub's `/token`, then checks the ES256 token: the key from `/.well-known/jwks.json` (by `kid`, cached 10 minutes, fetched again for a new `kid`), `iss` is `ACCOUNT_HUB_URL`, `aud` is TrailBook's client id, and `exp` and `nbf` hold, allowing a minute either way.
3. **Who it is:** the token's `sub` is matched to the TrailBook person connected to it.
   - **Connected:** TrailBook's own session starts (its own HttpOnly cookie). Someone with two-factor on enters their code first.
   - **Not connected, and a TrailBook login has the token's email:** TrailBook emails that address a one-time link (`#/hub-link/<token>`, 30 minutes) that connects the two and signs in. Reaching the inbox is the proof; an email match alone never connects anything.
   - **No TrailBook login with that email:** the person signs in with their TrailBook email and password and connects from **Your account**, which runs the same flow while signed in and connects to that login.
   - One Pomeroy Account connects to one TrailBook login, and the other way round.
4. Every outcome lands on an app page, `#/hub/<what happened>`: `check-email`, `connected`, `no-account`, `taken`, `cancelled`, `expired`, `unavailable`, `bad_token`, `refused`, `unreachable`, or `code/<ticket>` for the second factor.

The back-channel sign-out matches the hub's `user_id` to the connected login first, then `trailbook_user_id`, then the email.

TrailBook's own password, emailed sign-in links and reset keep working until the cutover date.

## Linking a MilePost workspace to a TrailBook organisation

The `company_id` MilePost stores from the OAuth callback and token response is a TrailBook **business** (entity) id, not the organisation id. One TrailBook organisation can hold several businesses. `GET /api/v1/company` now also returns `org_id`, the organisation that holds that business and pays for TrailBook. That is the id to seed the hub's `app_links.trailbook_org_id` with, and it matches `trailbook_org_id` in the status push.

## For whoever builds the hub

The hub is built from the pa-crm repository, where the lowercase product name is a Netlify secret value and fails the build. Nothing in this contract needs it: every field and plan key above starts with `trailbook` or is generic. Keep the hub's endpoint path (`/api/trailbook/status`) and table names (`trailbook_status`) as they are.
