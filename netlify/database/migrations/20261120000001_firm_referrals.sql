-- The referral program for accounting and HR firms.
--
--   * A firm joins from its Referrals page and gets a code. It picks what
--     the clients it brings get: 20% off for as long as they stay
--     (client_discount), or a 20% referral fee paid to the firm on what the
--     client pays for their first 12 months (firm_fee).
--   * A client enters the code (at sign-up, or on its Billing page before
--     its first payment). The firm's choice is copied onto the client's
--     subscription then, so a later change only affects new clients.
--   * Each paid charge of a firm_fee client inside its first 12 months
--     earns one referral_fees row: 20% of the charge before tax, in the
--     charge's currency. The operator pays firms outside the app (bank
--     transfer, e-Transfer, cheque) and records the payout, which marks the
--     fees paid and books a paid bill in the seller's books.
--
-- Like subscriptions, these rows sit outside the tenant boundary: only the
-- system connection touches them.

CREATE TABLE referral_partners (
  org_id                  uuid PRIMARY KEY REFERENCES organizations(id),
  code                    text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6,12}$'),
  reward                  text NOT NULL DEFAULT 'client_discount' CHECK (reward IN ('client_discount', 'firm_fee')),
  -- Where payout notices go, and how the firm wants to be paid. Never bank account numbers.
  payout_email            text,
  payout_note             text,
  -- US firms: a Form W-9 is needed before a payout (for the 1099-NEC).
  w9_received             boolean NOT NULL DEFAULT false,
  -- The program terms the firm accepted, and when.
  terms_version           text NOT NULL,
  terms_accepted_at       timestamptz NOT NULL DEFAULT now(),
  terms_accepted_by       uuid REFERENCES users(id),
  -- The vendor record for this firm in the seller's books.
  seller_vendor_id        uuid,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- The reward this client's firm chose when the client was linked.
ALTER TABLE subscriptions ADD COLUMN partner_reward text CHECK (partner_reward IN ('client_discount', 'firm_fee'));
ALTER TABLE subscriptions ADD COLUMN partner_linked_at timestamptz;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_partner_reward
  CHECK ((partner_org_id IS NULL) = (partner_reward IS NULL));

CREATE TABLE referral_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_org_id  uuid NOT NULL REFERENCES referral_partners(org_id),
  currency        text NOT NULL CHECK (currency IN ('USD', 'CAD')),
  total_minor     bigint NOT NULL CHECK (total_minor > 0),
  -- What it cost in the seller's books' currency, when the payout was in another.
  booked_minor    bigint NOT NULL CHECK (booked_minor > 0),
  paid_on         date NOT NULL,
  method          text NOT NULL,
  reference       text,
  bill_id         uuid,
  bill_number     text,
  recorded_by     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE referral_fees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_org_id  uuid NOT NULL REFERENCES referral_partners(org_id),
  client_org_id   uuid NOT NULL REFERENCES subscriptions(org_id),
  charge_id       uuid NOT NULL UNIQUE REFERENCES billing_charges(id),
  currency        text NOT NULL CHECK (currency IN ('USD', 'CAD')),
  -- The charge before tax, the rate, and the fee.
  base_minor      bigint NOT NULL CHECK (base_minor >= 0),
  rate_pct        int NOT NULL CHECK (rate_pct BETWEEN 0 AND 50),
  fee_minor       bigint NOT NULL CHECK (fee_minor >= 0),
  earned_on       date NOT NULL,
  status          text NOT NULL DEFAULT 'owed' CHECK (status IN ('owed', 'paid', 'void')),
  void_reason     text,
  payout_id       uuid REFERENCES referral_payouts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'paid') = (payout_id IS NOT NULL)),
  CHECK (status <> 'void' OR void_reason IS NOT NULL)
);
CREATE INDEX referral_fees_partner ON referral_fees (partner_org_id, status);
