import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type pg from "pg";
import type { Role } from "../core/ledger.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const SESSION_DAYS = 7;
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
}

export async function createSession(pool: pg.Pool, userId: string): Promise<{ token: string; maxAge: number }> {
  const token = randomBytes(32).toString("base64url");
  const maxAge = SESSION_DAYS * 24 * 3600;
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))",
    [tokenHash(token), userId, maxAge],
  );
  return { token, maxAge };
}

export async function sessionUser(pool: pg.Pool, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash(token)],
  );
  return rows[0] ?? null;
}

export async function endSession(pool: pg.Pool, token: string | undefined): Promise<void> {
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
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
