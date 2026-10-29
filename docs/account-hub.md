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
| `comp_until`, `comp_reason` | Set while a complimentary period lasts |

Practice organisations are never sent. The status never includes email addresses, employees, pay, bank or card details.

## Hub → TrailBook: `GET /api/hub/status`

For the hub's nightly check. Signed as above.

- `GET /api/hub/status` → `{ "generated_at": "…", "orgs": [ <status>, … ] }`
- `GET /api/hub/status?org=<trailbook_org_id>` → `{ "org": <status> }`, or 404

## Hub → TrailBook: `POST /api/hub/comp`

Sets or ends a complimentary period, for example when The Install includes TrailBook. Signed as above.

```json
{ "trailbook_org_id": "uuid", "comp_until": "2027-10-31", "reason": "The Install", "plan_key": "trailbook_books_payroll" }
```

`comp_until: null` ends a complimentary period today. The answer is `{ "org": <status> }`, and the new status is also pushed.

While it lasts, everything on the plan is open and nothing is charged, people paid included. It replaces any trial still running. The day after it ends, the card on file is charged as for a trial that ended; with no card, the books go read-only until one is added. The Billing page shows "Complimentary" with the end date and reason.

Refused (409) while the organisation has a charge that isn't settled, so a comp never hides money owed; settle or waive that charge first. Also refused for TrailBook's own books. The end date must be after today and at most 3 years away. Each change is in the organisation's audit chain as `billing.comp_set` or `billing.comp_ended`, by `app:account-hub`.

Not done here: a $0 invoice for a comp. A free subscription has no sales price, so none is issued; revisit if that changes.
