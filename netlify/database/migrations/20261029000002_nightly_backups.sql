-- A record of each nightly backup: where the encrypted copy is kept, and
-- whether it was read back and checked. The copies themselves live in blob
-- storage apart from the database. Members can see their own businesses'
-- restore points; only the system connection writes them.

CREATE TABLE backup_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  entity_id    uuid NOT NULL,
  backup_date  date NOT NULL,
  blob_key     text NOT NULL,
  bytes        bigint NOT NULL DEFAULT 0,
  checksum     text,
  verified     boolean NOT NULL,
  problem      text,
  -- Set once the copy passes the keeping period and is removed from storage.
  expired      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, backup_date),
  CHECK (verified = (problem IS NULL)),
  FOREIGN KEY (org_id, entity_id) REFERENCES entities(org_id, id)
);

ALTER TABLE backup_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant ON backup_runs TO altqbo_app USING (org_id = app_org_id());
GRANT SELECT ON backup_runs TO altqbo_app;
