-- Open-ended complimentary periods (plan v2.2, approved Oct 29, 2026): the
-- agency plans include TrailBook for as long as the plan lasts, so a comp
-- can have no end date until the hub ends it. comp_reason marks a
-- subscription that is (or was last) comped; comp_until is its last day, or
-- empty while an open-ended one lasts. Both are kept after it ends.

ALTER TABLE subscriptions
  DROP CONSTRAINT subscriptions_comp_complete,
  ADD CONSTRAINT subscriptions_comp_reason CHECK (comp_until IS NULL OR comp_reason IS NOT NULL);
