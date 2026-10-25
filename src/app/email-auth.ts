import { createHash, randomBytes } from "node:crypto";
import type { Tx } from "../db/pool.js";
import { AuthError } from "./auth.js";

// One-time links sent by email: sign in without a password, reset a
// password, confirm an email address. Only a hash of each token is kept,
// and the database lets a token be used once, before it expires.

export type EmailPurpose = "sign_in" | "reset" | "verify";

const LIFETIME_MINUTES: Record<EmailPurpose, number> = { sign_in: 15, reset: 60, verify: 60 * 24 * 3 };
/** Links per person and purpose per hour, so nobody can flood an inbox through the forms. */
const HOURLY_LIMIT = 5;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A fresh link token for this user, or null when they've asked for too many this hour. */
export async function issueEmailToken(tx: Tx, user: { id: string; email: string }, purpose: EmailPurpose): Promise<string | null> {
  const recent = (await tx.query(
    "SELECT count(*)::int AS n FROM email_tokens WHERE user_id = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'",
    [user.id, purpose],
  )).rows[0].n;
  if (recent >= HOURLY_LIMIT) return null;
  const token = randomBytes(32).toString("base64url");
  await tx.query(
    "INSERT INTO email_tokens (token_hash, user_id, purpose, email, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))",
    [hash(token), user.id, purpose, user.email, LIFETIME_MINUTES[purpose]],
  );
  return token;
}

/**
 * Spends a link token and returns its user. Reaching the inbox proves the
 * address, so every purpose also marks the email confirmed.
 */
export async function useEmailToken(tx: Tx, token: string, purpose: EmailPurpose): Promise<{ id: string; email: string; name: string }> {
  const row = (await tx.query(
    `SELECT t.token_hash, t.used_at, t.expires_at <= now() AS expired, t.email = u.email AS same_email, u.id, u.email, u.name
       FROM email_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = $2 FOR UPDATE OF t`,
    [hash(token), purpose],
  )).rows[0];
  if (!row) throw new AuthError("this link isn't valid; ask for a new one", 400);
  if (row.used_at) throw new AuthError("this link has already been used; ask for a new one", 400);
  if (row.expired || !row.same_email) throw new AuthError("this link has expired; ask for a new one", 400);
  await tx.query("UPDATE email_tokens SET used_at = now() WHERE token_hash = $1", [row.token_hash]);
  await tx.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [row.id]);
  return { id: row.id, email: row.email, name: row.name };
}

export const emailText = {
  sign_in: (name: string, link: string) => ({
    subject: "Your Alt-QBO sign-in link",
    text: `Hi ${name},\n\nUse this link to sign in to Alt-QBO. It works once, for the next 15 minutes:\n\n${link}\n\nIf you didn't ask for it, ignore this email; nobody can sign in without it.\n`,
  }),
  reset: (name: string, link: string) => ({
    subject: "Reset your Alt-QBO password",
    text: `Hi ${name},\n\nUse this link to choose a new Alt-QBO password. It works once, for the next hour:\n\n${link}\n\nIf you didn't ask for it, ignore this email; your password stays as it is.\n`,
  }),
  verify: (name: string, link: string) => ({
    subject: "Confirm your email for Alt-QBO",
    text: `Hi ${name},\n\nConfirm this is your email address for Alt-QBO:\n\n${link}\n\nThe link works for three days.\n`,
  }),
  mfa_on: (name: string) => ({
    subject: "Two-factor sign-in is on for your Alt-QBO account",
    text: `Hi ${name},\n\nTwo-factor sign-in was just turned on for your Alt-QBO account. From now on, signing in also needs a code from your authenticator app.\n\nKeep your recovery codes somewhere safe. If you didn't do this, reset your password right away.\n`,
  }),
  mfa_off: (name: string) => ({
    subject: "Two-factor sign-in is off for your Alt-QBO account",
    text: `Hi ${name},\n\nTwo-factor sign-in was just turned off for your Alt-QBO account. Signing in now needs only your password.\n\nIf you didn't do this, reset your password and turn two-factor back on right away.\n`,
  }),
  invite: (orgName: string, role: string, inviter: string, link: string) => ({
    subject: `${inviter} invited you to ${orgName} on Alt-QBO`,
    text: `${inviter} invited you to join ${orgName} on Alt-QBO as ${role}.\n\nAccept with this link. It works once, for this email address, for 14 days:\n\n${link}\n`,
  }),
};
