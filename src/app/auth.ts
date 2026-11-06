import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";
import type { Role } from "../core/ledger.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** A session ends 7 days after sign-in at most, and sooner after 12 hours without use. */
const SESSION_DAYS = 7;
export const SESSION_IDLE_HOURS = 12;
/** last_seen_at moves at most this often, so ordinary use doesn't write on every request. */
const TOUCH_SECONDS = 60;
export const SESSION_COOKIE = "altqbo_session";

export class AuthError extends Error {
  constructor(message: string, public readonly status = 401) {
    super(message);
    this.name = "AuthError";
  }
}

/** scrypt with a random 16-byte salt, stored as "scrypt$<salt>$<hash>" in base64. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new AuthError("password must be at least 10 characters", 400);
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  /** This session passed the second factor (at sign-in, or by turning two-factor on in it). */
  secondFactor: boolean;
}

/** `secondFactor` when the person entered an authenticator or recovery code to get this session. */
export async function createSession(pool: pg.Pool, userId: string, opts: { secondFactor?: boolean } = {}): Promise<{ token: string; maxAge: number }> {
  const token = randomBytes(32).toString("base64url");
  const maxAge = SESSION_DAYS * 24 * 3600;
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, mfa_at)
     VALUES ($1, $2, now() + make_interval(secs => $3), CASE WHEN $4 THEN now() END)`,
    [tokenHash(token), userId, maxAge, opts.secondFactor === true],
  );
  return { token, maxAge };
}

/** The person behind a session that hasn't reached its 7 days or sat unused for 12 hours. */
export async function sessionUser(pool: pg.Pool, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, s.mfa_at IS NOT NULL AS "secondFactor",
            s.last_seen_at < now() - make_interval(secs => $3) AS stale
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND s.last_seen_at > now() - make_interval(hours => $2)`,
    [tokenHash(token), SESSION_IDLE_HOURS, TOUCH_SECONDS],
  );
  if (!rows[0]) return null;
  const { stale, ...user } = rows[0];
  if (stale) await pool.query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1", [tokenHash(token)]);
  return user;
}

/** Records that this session just passed the second factor. */
export async function markSecondFactor(pool: pg.Pool, token: string | undefined): Promise<void> {
  if (token) await pool.query("UPDATE sessions SET mfa_at = now() WHERE token_hash = $1", [tokenHash(token)]);
}

export async function endSession(pool: pg.Pool, token: string | undefined): Promise<void> {
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
}

/** Signs a person out everywhere. Returns how many sessions ended. */
export async function endAllSessions(pool: pg.Pool, userId: string): Promise<number> {
  const r = await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  return r.rowCount ?? 0;
}

export async function membershipRole(pool: pg.Pool, userId: string, orgId: string): Promise<Role | null> {
  const { rows } = await pool.query("SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2", [userId, orgId]);
  return rows[0]?.role ?? null;
}

export function normaliseEmail(email: unknown): string {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new AuthError("enter a valid email address", 400);
  }
  return email.trim().toLowerCase();
}

/** Wrong passwords allowed per email in the window before password sign-in pauses for that email. */
export const SIGN_IN_MAX_FAILURES = 10;
export const SIGN_IN_WINDOW_MINUTES = 15;

/** Refuses a password sign-in while an email has had too many wrong passwords recently. */
export async function checkSignInAllowed(pool: pg.Pool, email: string): Promise<void> {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM sign_in_failures WHERE email = $1 AND failed_at > now() - make_interval(mins => $2)",
    [email, SIGN_IN_WINDOW_MINUTES],
  );
  if (rows[0].n >= SIGN_IN_MAX_FAILURES) {
    throw new AuthError(`too many wrong passwords for this email; wait ${SIGN_IN_WINDOW_MINUTES} minutes, or sign in with an emailed link or reset your password`, 429);
  }
}

/** Counts a wrong password, or clears the count after a right one. Old rows are tidied as it goes. */
export async function recordSignIn(pool: pg.Pool, email: string, ok: boolean): Promise<void> {
  if (ok) {
    await pool.query("DELETE FROM sign_in_failures WHERE email = $1", [email]);
    return;
  }
  await pool.query("INSERT INTO sign_in_failures (email) VALUES ($1)", [email]);
  await pool.query("DELETE FROM sign_in_failures WHERE failed_at < now() - interval '1 day'");
}
