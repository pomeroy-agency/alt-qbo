-- Bank rules and receipts.
--
--   * A bank rule matches new bank lines by words in the description (and,
--     optionally, direction, amount range and bank account) and either
--     suggests a category or records the line on import. Rules are switched
--     off, never deleted, so the audit log can still name them.
--   * A receipt (or any supporting file) is stored apart from the database;
--     this table holds what it is, who added it and its SHA-256, so a changed
--     file can be spotted. Removing one keeps the row.

CREATE TABLE bank_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  entity_id        uuid NOT NULL,
  -- Words the description must contain, compared without case.
  match_text       text NOT NULL CHECK (length(trim(match_text)) BETWEEN 2 AND 100),
  direction        text NOT NULL DEFAULT 'any' CHECK (direction IN ('any', 'in', 'out')),
  min_minor        bigint CHECK (min_minor IS NULL OR min_minor >= 0),
  max_minor        bigint CHECK (max_minor IS NULL OR max_minor >= 0),
  bank_account_id  uuid,
  account_id       uuid NOT NULL,
  -- Record matching lines on import instead of only suggesting.
  auto_record      boolean NOT NULL DEFAULT false,
  memo             text,
  active           boolean NOT NULL DEFAULT true,
  applied_count    integer NOT NULL DEFAULT 0,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (min_minor IS NULL OR max_minor IS NULL OR max_minor >= min_minor),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id),
  FOREIGN KEY (org_id, entity_id, account_id) REFERENCES accounts(org_id, entity_id, id),
  FOREIGN KEY (org_id, entity_id, bank_account_id) REFERENCES accounts(org_id, entity_id, id)
);
CREATE INDEX bank_rules_entity ON bank_rules (entity_id) WHERE active;
CREATE TRIGGER bank_rules_no_delete BEFORE DELETE ON bank_rules FOR EACH ROW EXECUTE FUNCTION reject_mutation();


CREATE TABLE attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  entity_id     uuid NOT NULL,
  object_type   text NOT NULL CHECK (object_type IN ('document', 'bank_line', 'journal_entry')),
  object_id     uuid NOT NULL,
  file_name     text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  content_type  text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif')),
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by   text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  removed_by    text,
  removed_at    timestamptz,
  CHECK ((removed_at IS NULL) = (removed_by IS NULL)),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);
CREATE INDEX attachments_object ON attachments (object_type, object_id);

-- Only removal changes a row, once.
CREATE OR REPLACE FUNCTION attachments_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['removed_by', 'removed_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['removed_by', 'removed_at'])
     OR OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'IMMUTABLE: an attachment can only be removed, once' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER attachments_guard_update BEFORE UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION attachments_guard_update();
CREATE TRIGGER attachments_no_delete BEFORE DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION reject_mutation();

ALTER TABLE bank_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON bank_rules  TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
CREATE POLICY tenant ON attachments TO altqbo_app USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
GRANT SELECT, INSERT, UPDATE ON bank_rules, attachments TO altqbo_app;
