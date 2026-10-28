-- Who accepted which version of the terms of service, for which organisation.
-- The person who creates an organisation accepts for it at sign-up; when the
-- terms change, an owner or admin accepts the new version. Rows are never
-- changed or removed, so the record shows what was agreed and when.
CREATE TABLE terms_acceptances (
  org_id       uuid NOT NULL REFERENCES organizations(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  version      text NOT NULL CHECK (version ~ '^\d{4}-\d{2}-\d{2}$'),
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, version, user_id)
);

CREATE OR REPLACE FUNCTION terms_acceptances_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE: terms acceptances are a permanent record' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER terms_acceptances_immutable BEFORE UPDATE OR DELETE ON terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION terms_acceptances_immutable();
