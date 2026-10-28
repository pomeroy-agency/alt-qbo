import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import type pg from "pg";
import type { Tx } from "../db/pool.js";
import { seal, unseal } from "../core/pii.js";
import { AuthError } from "./auth.js";

// Two-factor sign-in with an authenticator app (TOTP, RFC 6238: SHA-1, six
// digits, 30-second steps), plus one-time recovery codes for a lost phone.
// The shared secret is sealed with PII_KEY like other private values, each
// code works once (the last accepted time step is kept), and a sign-in that
// passed the password but not the code holds only a short-lived ticket.

const STEP_SECONDS = 30;
const DIGITS = 6;
/** Steps either side of now that still count, for a phone clock that's a little off. */
const DRIFT_STEPS = 1;
const TICKET_MINUTES = 5;
const TICKET_ATTEMPTS = 5;
const RECOVERY_CODES = 10;
const ISSUER = "TrailBook";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code an authenticator shows for one time step. */
export function totpAt(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const offset = h[h.length - 1]! & 15;
  const n = (h.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(n).padStart(DIGITS, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The time step a code matches, within the allowed drift and after the last one used; null otherwise. */
export function matchTotp(secret: Buffer, code: string, nowMs: number, lastCounter: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  for (let c = now - DRIFT_STEPS; c <= now + DRIFT_STEPS; c++) {
    if (lastCounter !== null && c <= lastCounter) continue;
    if (timingSafeEqual(Buffer.from(totpAt(secret, c)), Buffer.from(code))) return c;
  }
  return null;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const cleanCode = (code: unknown) => (typeof code === "string" ? code.replace(/[\s-]/g, "").toLowerCase() : "");

// ------------------------------------------------------------------ setup

export interface MfaSetup {
  secret: string;
  uri: string;
  /** The same link as a QR code, an SVG image to scan with the phone. */
  qrSvg: string;
}

/** Starts turning two-factor on: a fresh secret, saved as pending until a code from it is entered. */
export async function beginMfaSetup(pool: pg.Pool, user: { id: string; email: string }): Promise<MfaSetup> {
  const secretBytes = randomBytes(20);
  const secret = base32Encode(secretBytes);
  await pool.query("UPDATE users SET totp_pending = $2 WHERE id = $1", [user.id, seal(secret)]);
  const label = encodeURIComponent(`${ISSUER}:${user.email}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { secret, uri, qrSvg };
}

function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODES }, () => {
    const s = base32Encode(randomBytes(8)).slice(0, 12).toLowerCase();
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  });
}

async function replaceRecoveryCodes(tx: Tx, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await tx.query("UPDATE mfa_recovery_codes SET retired_at = now() WHERE user_id = $1 AND used_at IS NULL AND retired_at IS NULL", [userId]);
  for (const c of codes) await tx.query("INSERT INTO mfa_recovery_codes (code_hash, user_id) VALUES ($1, $2)", [sha(cleanCode(c)), userId]);
  return codes;
}

/** Finishes setup when the code matches the pending secret. Returns the recovery codes, shown once. */
export async function enableMfa(tx: Tx, userId: string, code: unknown, nowMs = Date.now()): Promise<string[]> {
  const u = (await tx.query("SELECT totp_pending, totp_enabled_at FROM users WHERE id = $1 FOR UPDATE", [userId])).rows[0];
  if (u?.totp_enabled_at) throw new AuthError("two-factor sign-in is already on", 409);
  if (!u?.totp_pending) throw new AuthError("start setup again to get a new code", 400);
  const secret = unseal(u.totp_pending);
  const counter = matchTotp(base32Decode(secret), cleanCode(code), nowMs, null);
  if (counter === null) throw new AuthError("that code doesn't match; check the time on your phone and try the newest code", 400);
  await tx.query(
    "UPDATE users SET totp_secret = $2, totp_pending = NULL, totp_enabled_at = now(), totp_last_counter = $3 WHERE id = $1",
    [userId, seal(secret), counter],
  );
  return replaceRecoveryCodes(tx, userId);
}

/**
 * Checks a code for a signed-up user: a current authenticator code, or one of
 * their unused recovery codes (spent on use). Records the step so the same
 * code can't be replayed.
 */
export async function checkSecondFactor(tx: Tx, userId: string, code: unknown, nowMs = Date.now()): Promise<"totp" | "recovery" | null> {
  const u = (await tx.query("SELECT totp_secret, totp_last_counter FROM users WHERE id = $1 FOR UPDATE", [userId])).rows[0];
  if (!u?.totp_secret) return null;
  const c = cleanCode(code);
  if (/^\d{6}$/.test(c)) {
    const last = u.totp_last_counter === null ? null : Number(u.totp_last_counter);
    const counter = matchTotp(base32Decode(unseal(u.totp_secret)), c, nowMs, last);
    if (counter === null) return null;
    await tx.query("UPDATE users SET totp_last_counter = $2 WHERE id = $1", [userId, counter]);
    return "totp";
  }
  const spent = await tx.query(
    "UPDATE mfa_recovery_codes SET used_at = now() WHERE code_hash = $1 AND user_id = $2 AND used_at IS NULL AND retired_at IS NULL RETURNING 1",
    [sha(c), userId],
  );
  return spent.rows[0] ? "recovery" : null;
}

export async function disableMfa(tx: Tx, userId: string): Promise<void> {
  await tx.query(
    "UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_counter = NULL WHERE id = $1",
    [userId],
  );
  await tx.query("UPDATE mfa_recovery_codes SET retired_at = now() WHERE user_id = $1 AND used_at IS NULL AND retired_at IS NULL", [userId]);
}

export async function regenerateRecoveryCodes(tx: Tx, userId: string): Promise<string[]> {
  return replaceRecoveryCodes(tx, userId);
}

export async function mfaStatus(pool: pg.Pool | Tx, userId: string): Promise<{ enabled: boolean; recoveryCodesLeft: number }> {
  const { rows } = await pool.query(
    `SELECT u.totp_enabled_at IS NOT NULL AS enabled,
            (SELECT count(*)::int FROM mfa_recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL AND r.retired_at IS NULL) AS left
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  return { enabled: Boolean(rows[0]?.enabled), recoveryCodesLeft: rows[0]?.left ?? 0 };
}

// ---------------------------------------------------------------- sign-in

/** A ticket for the second step of signing in, after the password or email link passed. */
export async function issueMfaTicket(pool: pg.Pool | Tx, userId: string): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))",
    [sha(ticket), userId, TICKET_MINUTES],
  );
  return ticket;
}

/**
 * Completes the second step: the user once a code matches. A ticket allows
 * five tries and works once. A wrong code comes back as an error message
 * rather than a throw, so the counted try is committed.
 */
export async function redeemMfaTicket(
  tx: Tx, ticket: unknown, code: unknown, nowMs = Date.now(),
): Promise<{ userId: string; method: "totp" | "recovery" } | { error: string }> {
  if (typeof ticket !== "string" || ticket.length < 20 || ticket.length > 100) throw new AuthError("sign in again", 401);
  const ch = (await tx.query(
    "SELECT token_hash, user_id, attempts, used_at, expires_at <= now() AS expired FROM mfa_challenges WHERE token_hash = $1 FOR UPDATE",
    [sha(ticket)],
  )).rows[0];
  if (!ch || ch.used_at || ch.expired || ch.attempts >= TICKET_ATTEMPTS) throw new AuthError("that sign-in has expired; sign in again", 401);
  const method = await checkSecondFactor(tx, ch.user_id, code, nowMs);
  if (!method) {
    await tx.query("UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = $1", [ch.token_hash]);
    return { error: ch.attempts + 1 >= TICKET_ATTEMPTS ? "too many wrong codes; sign in again" : "that code isn't right; try the newest one from your app" };
  }
  await tx.query("UPDATE mfa_challenges SET used_at = now() WHERE token_hash = $1", [ch.token_hash]);
  return { userId: ch.user_id, method };
}
