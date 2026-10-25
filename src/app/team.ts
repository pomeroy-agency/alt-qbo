import { createHash, randomBytes } from "node:crypto";
import type { Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { LedgerError, translateDbError } from "../core/errors.js";
import type { Actor, Role } from "../core/ledger.js";

// Team membership: invitations by email (ported from Ledgerline), role
// changes, removal and leaving. All of it runs on the system connection,
// because users, memberships and invitations sit outside the tenant boundary.

export type MemberRole = Exclude<Role, "system">;
export const MEMBER_ROLES: MemberRole[] = ["owner", "admin", "bookkeeper", "approver", "accountant", "read_only"];
export type InviteRole = Exclude<MemberRole, "owner">;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Owners manage everyone; admins manage everyone except owners and can't hand out owner. */
function mayManage(actor: Actor, targetRole: MemberRole, newRole?: MemberRole) {
  if (actor.role === "owner") return;
  if (actor.role === "admin" && targetRole !== "owner" && newRole !== "owner") return;
  throw new LedgerError("FORBIDDEN", actor.role === "admin" ? "only an owner can change an owner or make someone an owner" : `role ${actor.role} cannot manage the team`);
}

/** Runs deferred checks now so a broken rule surfaces as a LedgerError, not a failed COMMIT. */
async function checkNow(tx: Tx) {
  try {
    await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
  } catch (err) {
    translateDbError(err);
  }
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: MemberRole;
  createdAt: string;
}

export async function listMembers(tx: Tx, orgId: string): Promise<Member[]> {
  const { rows } = await tx.query(
    `SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1 ORDER BY m.created_at`,
    [orgId],
  );
  return rows.map((r) => ({ userId: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at.toISOString() }));
}

export interface Invitation {
  id: string;
  email: string;
  role: InviteRole;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
}

export async function listInvitations(tx: Tx, orgId: string): Promise<Invitation[]> {
  const { rows } = await tx.query(
    `SELECT id, email, role, invited_by, created_at, expires_at FROM invitations
      WHERE org_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at`,
    [orgId],
  );
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, invitedBy: r.invited_by, createdAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString() }));
}

/** Invites an email with a role. Returns the one-time token for the invite link; only its hash is stored. */
export async function invite(tx: Tx, input: { orgId: string; email: string; role: InviteRole; actor: Actor }): Promise<{ id: string; token: string }> {
  mayManage(input.actor, input.role, input.role);
  if (!MEMBER_ROLES.includes(input.role) || (input.role as MemberRole) === "owner") throw new LedgerError("INVALID", "pick a role other than owner");
  const member = await tx.query("SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND u.email = $2", [input.orgId, input.email]);
  if (member.rows[0]) throw new LedgerError("INVALID", `${input.email} is already on the team`);
  // A new invite replaces any live one, so a lost link can be re-sent.
  await tx.query(
    "UPDATE invitations SET revoked_at = now() WHERE org_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL",
    [input.orgId, input.email],
  );
  const token = randomBytes(24).toString("base64url");
  const { rows } = await tx.query(
    "INSERT INTO invitations (org_id, email, role, token_hash, invited_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [input.orgId, input.email, input.role, hash(token), input.actor.id],
  );
  await appendAudit(tx, {
    orgId: input.orgId, actor: input.actor.id, action: "member.invited", objectType: "invitation", objectId: rows[0].id,
    after: { email: input.email, role: input.role }, context: { role: input.actor.role },
  });
  return { id: rows[0].id, token };
}

export async function revokeInvitation(tx: Tx, input: { orgId: string; invitationId: string; actor: Actor }): Promise<void> {
  const inv = (await tx.query(
    "SELECT email, role FROM invitations WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL",
    [input.invitationId, input.orgId],
  )).rows[0];
  if (!inv) throw new LedgerError("INVALID", "that invitation isn't pending");
  mayManage(input.actor, inv.role);
  await tx.query("UPDATE invitations SET revoked_at = now() WHERE id = $1", [input.invitationId]);
  await appendAudit(tx, {
    orgId: input.orgId, actor: input.actor.id, action: "invitation.revoked", objectType: "invitation", objectId: input.invitationId,
    before: { email: inv.email, role: inv.role }, context: { role: input.actor.role },
  });
}

export interface InvitationPreview {
  orgName: string;
  email: string;
  role: InviteRole;
  status: "pending" | "accepted" | "revoked" | "expired";
}

/** What the invite link shows before anyone signs in. */
export async function previewInvitation(tx: Tx, token: string): Promise<InvitationPreview | null> {
  const { rows } = await tx.query(
    `SELECT o.name, i.email, i.role, i.accepted_at, i.revoked_at, i.expires_at < now() AS expired
       FROM invitations i JOIN organizations o ON o.id = i.org_id WHERE i.token_hash = $1`,
    [hash(token)],
  );
  const r = rows[0];
  if (!r) return null;
  return { orgName: r.name, email: r.email, role: r.role, status: r.accepted_at ? "accepted" : r.revoked_at ? "revoked" : r.expired ? "expired" : "pending" };
}

/** Accepts an invitation for a signed-in user whose email matches it. Returns the organisation joined. */
export async function acceptInvitation(tx: Tx, input: { token: string; userId: string }): Promise<{ orgId: string; role: InviteRole }> {
  const inv = (await tx.query(
    `SELECT i.id, i.org_id, i.email, i.role, i.accepted_at, i.revoked_at, i.expires_at < now() AS expired
       FROM invitations i WHERE i.token_hash = $1 FOR UPDATE`,
    [hash(input.token)],
  )).rows[0];
  if (!inv || inv.revoked_at) throw new LedgerError("INVALID", "this invitation link isn't valid; ask for a new one");
  if (inv.accepted_at) throw new LedgerError("INVALID", "this invitation has already been used");
  if (inv.expired) throw new LedgerError("INVALID", "this invitation has expired; ask for a new one");
  const user = (await tx.query("SELECT email FROM users WHERE id = $1", [input.userId])).rows[0];
  if (user?.email !== inv.email) throw new LedgerError("FORBIDDEN", `this invitation is for ${inv.email}; sign in with that email`);
  try {
    await tx.query("UPDATE invitations SET accepted_at = now(), accepted_user_id = $2 WHERE id = $1", [inv.id, input.userId]);
    await tx.query(
      "INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, $3) ON CONFLICT (user_id, org_id) DO NOTHING",
      [input.userId, inv.org_id, inv.role],
    );
  } catch (err) {
    translateDbError(err);
  }
  await appendAudit(tx, {
    orgId: inv.org_id, actor: `user:${inv.email}`, action: "member.joined", objectType: "user", objectId: inv.email,
    after: { email: inv.email, role: inv.role }, context: { invitation: inv.id },
  });
  return { orgId: inv.org_id, role: inv.role };
}

async function memberOf(tx: Tx, orgId: string, userId: string) {
  const m = (await tx.query(
    "SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.user_id = $2 FOR UPDATE OF m",
    [orgId, userId],
  )).rows[0];
  if (!m) throw new LedgerError("INVALID", "that person isn't on the team");
  return m as { email: string; role: MemberRole };
}

export async function changeRole(tx: Tx, input: { orgId: string; userId: string; role: MemberRole; actor: Actor }): Promise<void> {
  if (!MEMBER_ROLES.includes(input.role)) throw new LedgerError("INVALID", "unknown role");
  const m = await memberOf(tx, input.orgId, input.userId);
  mayManage(input.actor, m.role, input.role);
  if (m.role === input.role) return;
  await tx.query("UPDATE memberships SET role = $3 WHERE org_id = $1 AND user_id = $2", [input.orgId, input.userId, input.role]);
  await checkNow(tx);
  await appendAudit(tx, {
    orgId: input.orgId, actor: input.actor.id, action: "member.role_changed", objectType: "user", objectId: m.email,
    before: { role: m.role }, after: { role: input.role }, context: { role: input.actor.role },
  });
}

export async function removeMember(tx: Tx, input: { orgId: string; userId: string; actor: Actor; self?: boolean }): Promise<void> {
  const m = await memberOf(tx, input.orgId, input.userId);
  if (!input.self) mayManage(input.actor, m.role);
  await tx.query("DELETE FROM memberships WHERE org_id = $1 AND user_id = $2", [input.orgId, input.userId]);
  await checkNow(tx);
  await appendAudit(tx, {
    orgId: input.orgId, actor: input.actor.id, action: input.self ? "member.left" : "member.removed", objectType: "user", objectId: m.email,
    before: { email: m.email, role: m.role }, context: { role: input.actor.role },
  });
}
