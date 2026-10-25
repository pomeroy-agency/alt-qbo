-- Team invitations, ported from Ledgerline: an owner or admin invites an
-- email address with a role, and that person joins by signing up or signing
-- in with the same email through the invite link. Nobody sets a password for
-- anyone else.
--
-- Like memberships, invitations are read before an organisation is chosen,
-- so only the system connection touches them. Only a hash of the link's
-- token is stored.

CREATE TABLE invitations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id),
  email             text NOT NULL CHECK (email = lower(email) AND email LIKE '%_@_%'),
  role              text NOT NULL CHECK (role IN ('admin', 'bookkeeper', 'approver', 'accountant', 'read_only')),
  token_hash        text NOT NULL UNIQUE,
  invited_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at       timestamptz,
  accepted_user_id  uuid REFERENCES users(id),
  revoked_at        timestamptz,
  CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CHECK ((accepted_at IS NULL) = (accepted_user_id IS NULL))
);

-- One live invitation per person per organisation.
CREATE UNIQUE INDEX invitations_one_pending ON invitations (org_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- An invitation is settled once: accepted or revoked, never reopened or edited.
CREATE FUNCTION invitations_settle_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE: invitations are kept; revoke instead' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'IMMUTABLE: this invitation is already settled' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.org_id, NEW.email, NEW.role, NEW.token_hash, NEW.invited_by, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM (OLD.org_id, OLD.email, OLD.role, OLD.token_hash, OLD.invited_by, OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'IMMUTABLE: only acceptance or revocation can change an invitation' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.accepted_at IS NOT NULL THEN
    IF OLD.expires_at < now() THEN
      RAISE EXCEPTION 'INVALID: this invitation has expired' USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT email FROM users WHERE id = NEW.accepted_user_id) IS DISTINCT FROM NEW.email THEN
      RAISE EXCEPTION 'FORBIDDEN: the invitation is for a different email' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER invitations_settle_once BEFORE UPDATE OR DELETE ON invitations
  FOR EACH ROW EXECUTE FUNCTION invitations_settle_once();

-- Every organisation keeps at least one owner, checked at commit so an
-- ownership hand-over can happen inside one transaction.
CREATE FUNCTION memberships_keep_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id)
     AND NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = OLD.org_id AND role = 'owner') THEN
    RAISE EXCEPTION 'INVALID: an organisation needs at least one owner' USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER memberships_keep_owner AFTER UPDATE OR DELETE ON memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION memberships_keep_owner();
