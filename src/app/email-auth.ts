import { createHash, randomBytes } from "node:crypto";
import type { Tx } from "../db/pool.js";
import { AuthError } from "./auth.js";

// One-time links sent by email: sign in without a password, reset a
// password, confirm an email address, connect a Pomeroy Account. Only a hash of each token is kept,
// and the database lets a token be used once, before it expires.

export type EmailPurpose = "sign_in" | "reset" | "verify" | "hub_link";

const LIFETIME_MINUTES: Record<EmailPurpose, number> = { sign_in: 15, reset: 60, verify: 60 * 24 * 3, hub_link: 30 };
/** Links per person and purpose per hour, so nobody can flood an inbox through the forms. */
const HOURLY_LIMIT = 5;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * A fresh link token for this user, or null when they've asked for too many
 * this hour. A hub_link token carries the Pomeroy Account it will connect.
 */
export async function issueEmailToken(tx: Tx, user: { id: string; email: string }, purpose: EmailPurpose, hubUserId?: string): Promise<string | null> {
  const recent = (await tx.query(
    "SELECT count(*)::int AS n FROM email_tokens WHERE user_id = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'",
    [user.id, purpose],
  )).rows[0].n;
  if (recent >= HOURLY_LIMIT) return null;
  const token = randomBytes(32).toString("base64url");
  await tx.query(
    `INSERT INTO email_tokens (token_hash, user_id, purpose, email, expires_at, hub_user_id)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5), $6)`,
    [hash(token), user.id, purpose, user.email, LIFETIME_MINUTES[purpose], purpose === "hub_link" ? hubUserId : null],
  );
  return token;
}

/**
 * Spends a link token and returns its user. Reaching the inbox proves the
 * address, so every purpose also marks the email confirmed.
 */
export async function useEmailToken(tx: Tx, token: string, purpose: EmailPurpose): Promise<{ id: string; email: string; name: string; hubUserId: string | null }> {
  const row = (await tx.query(
    `SELECT t.token_hash, t.used_at, t.expires_at <= now() AS expired, t.email = u.email AS same_email, t.hub_user_id, u.id, u.email, u.name
       FROM email_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = $2 FOR UPDATE OF t`,
    [hash(token), purpose],
  )).rows[0];
  if (!row) throw new AuthError("this link isn't valid; ask for a new one", 400);
  if (row.used_at) throw new AuthError("this link has already been used; ask for a new one", 400);
  if (row.expired || !row.same_email) throw new AuthError("this link has expired; ask for a new one", 400);
  await tx.query("UPDATE email_tokens SET used_at = now() WHERE token_hash = $1", [row.token_hash]);
  await tx.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [row.id]);
  return { id: row.id, email: row.email, name: row.name, hubUserId: row.hub_user_id };
}

export const emailText = {
  sign_in: (name: string, link: string) => ({
    subject: "Your TrailBook sign-in link",
    text: `Hi ${name},\n\nUse this link to sign in to TrailBook. It works once, for the next 15 minutes:\n\n${link}\n\nIf you didn't ask for it, ignore this email; nobody can sign in without it.\n`,
  }),
  reset: (name: string, link: string) => ({
    subject: "Reset your TrailBook password",
    text: `Hi ${name},\n\nUse this link to choose a new TrailBook password. It works once, for the next hour:\n\n${link}\n\nIf you didn't ask for it, ignore this email; your password stays as it is.\n`,
  }),
  verify: (name: string, link: string) => ({
    subject: "Confirm your email for TrailBook",
    text: `Hi ${name},\n\nConfirm this is your email address for TrailBook:\n\n${link}\n\nThe link works for three days.\n`,
  }),
  hub_link: (name: string, link: string) => ({
    subject: "Connect your Pomeroy Account to TrailBook",
    text: `Hi ${name},\n\nSomeone just signed in with a Pomeroy Account that isn't connected to your TrailBook login yet. If that was you, use this link to connect them. It works once, for the next 30 minutes:\n\n${link}\n\nAfter that, "Sign in with Pomeroy Account" opens your books. Your TrailBook password keeps working until the switch-over date we'll email you about.\n\nIf it wasn't you, ignore this email; nothing is connected without it.\n`,
  }),
  mfa_on: (name: string) => ({
    subject: "Two-factor sign-in is on for your TrailBook account",
    text: `Hi ${name},\n\nTwo-factor sign-in was just turned on for your TrailBook account. From now on, signing in also needs a code from your authenticator app.\n\nKeep your recovery codes somewhere safe. If you didn't do this, reset your password right away.\n`,
  }),
  mfa_off: (name: string) => ({
    subject: "Two-factor sign-in is off for your TrailBook account",
    text: `Hi ${name},\n\nTwo-factor sign-in was just turned off for your TrailBook account. Signing in now needs only your password.\n\nIf you didn't do this, reset your password and turn two-factor back on right away.\n`,
  }),
  invite: (orgName: string, role: string, inviter: string, link: string) => ({
    subject: `${inviter} invited you to ${orgName} on TrailBook`,
    text: `${inviter} invited you to join ${orgName} on TrailBook as ${role}.\n\nAccept with this link. It works once, for this email address, for 14 days:\n\n${link}\n`,
  }),
};
