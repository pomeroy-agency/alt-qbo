-- Alt-QBO's own subscriptions: each organisation's plan, trial, billing
-- details and saved card, and each charge made for it. Card numbers never
-- reach Alt-QBO; only the card processor's references and the brand, last
-- four digits and expiry are kept. Each charge is backed by an invoice in
-- the seller's own Alt-QBO books, where its sales tax is worked out.
--
-- These rows sit outside the tenant boundary, like users and sessions:
-- only the system connection touches them.

CREATE TABLE subscriptions (
  org_id                 uuid PRIMARY KEY REFERENCES organizations(id),
  plan                   text NOT NULL DEFAULT 'books' CHECK (plan IN ('books', 'books_payroll')),
  interval               text NOT NULL DEFAULT 'month' CHECK (interval IN ('month', 'year')),
  -- Takes effect at the next renewal: moving to a smaller plan or another interval.
  next_plan              text CHECK (next_plan IN ('books', 'books_payroll')),
  next_interval          text CHECK (next_interval IN ('month', 'year')),
  status                 text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_on          date NOT NULL,
  -- The paid period: first and last day.
  period_start           date,
  period_end             date,
  -- Annual plans bill people paid monthly; the last day already billed.
  people_billed_through  date,
  -- The first day a payment failed and is still unpaid; the grace period counts from here.
  past_due_since         date,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  canceled_at            timestamptz,
  -- The price list this subscription pays, copied when it started.
  prices                 jsonb NOT NULL,
  founding               boolean NOT NULL DEFAULT false,
  price_locked_until     date,
  activated_at           timestamptz,
  billing_name           text,
  billing_email          text,
  address_line1          text,
  address_city           text,
  address_state          text,
  address_zip            text,
  processor_customer     text,
  processor_card         text,
  card_brand             text,
  card_last4             text CHECK (card_last4 ~ '^\d{4}$'),
  card_exp               text,
  -- An accounting or HR firm that brought this client in. With a discount
  -- set, every charge is that percent lower; firms that chose a referral fee
  -- instead are paid outside the app, and the discount stays 0.
  partner_org_id         uuid REFERENCES organizations(id),
  partner_discount_pct   int NOT NULL DEFAULT 0 CHECK (partner_discount_pct BETWEEN 0 AND 50),
  -- The customer record for this organisation in the seller's books.
  seller_contact_id      uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((period_start IS NULL) = (period_end IS NULL)),
  CHECK (period_end IS NULL OR period_end >= period_start)
);

CREATE TABLE billing_charges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES subscriptions(org_id),
  kind             text NOT NULL CHECK (kind IN ('renewal', 'people', 'upgrade')),
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  plan             text NOT NULL,
  interval         text NOT NULL,
  lines            jsonb NOT NULL,
  subtotal_minor   bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor        bigint,
  total_minor      bigint,
  invoice_id       uuid,
  invoice_number   text,
  -- 'processing' while the card processor is asked; a charge left there by a crash is held for a person to check, never retried blind.
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'held', 'waived')),
  processor_charge text,
  failure          text,
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_on  date,
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, kind, period_start),
  CHECK (period_end >= period_start)
);
CREATE INDEX billing_charges_due ON billing_charges (status, next_attempt_on);
