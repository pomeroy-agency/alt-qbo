-- TrailBook's own subscriptions for businesses billed in Canada.
--
--   * A subscription is billed in US dollars, or in Canadian dollars when its
--     billing address is in Canada. The currency is set from the address
--     until the first payment, and fixed after that.
--   * A Canadian-dollar charge is made by card first. The card processor
--     converts it into US dollars, and the seller's books (kept in US
--     dollars) then get an invoice and payment for the US-dollar amount
--     that actually came in, with the Canadian amount and the rate on it.
--     If that booking fails, the charge stays paid (the customer did pay)
--     and the booking is tried again on the next billing run.

ALTER TABLE subscriptions ADD COLUMN currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CAD'));
ALTER TABLE subscriptions ADD COLUMN address_country text NOT NULL DEFAULT 'US' CHECK (address_country IN ('US', 'CA'));

ALTER TABLE billing_charges ADD COLUMN currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'CAD'));
-- What the card processor paid out for the charge, in the seller's currency, and its rate.
ALTER TABLE billing_charges ADD COLUMN settled_minor bigint CHECK (settled_minor >= 0);
ALTER TABLE billing_charges ADD COLUMN fx_rate numeric(18, 8) CHECK (fx_rate > 0);
-- Why the seller's books don't have this charge yet, while it is being tried again.
ALTER TABLE billing_charges ADD COLUMN book_failure text;
