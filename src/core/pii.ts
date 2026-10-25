import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { LedgerError } from "./errors.js";

// Sealing for the few values that must never sit readable in the database:
// Social Security numbers and bank account numbers. AES-256-GCM with a key
// held outside the database (PII_KEY, 32 bytes base64), so a copy of the
// database or a backup file alone reveals nothing.

const VERSION = "v1";

function key(): Buffer {
  const raw = process.env.PII_KEY;
  if (!raw) throw new LedgerError("INVALID", "private details like Social Security numbers can't be saved until PII_KEY is set up on the server");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new LedgerError("INVALID", "PII_KEY must be 32 bytes, base64-encoded");
  return k;
}

/** Seals a value; the result is safe to store. */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

/** Opens a sealed value. Fails loudly if it was altered or sealed with another key. */
export function unseal(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("not a sealed value");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

/** Checks and normalises a Social Security number to nine digits. */
export function cleanSsn(v: string): string {
  const digits = v.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(digits)) throw new LedgerError("INVALID", "a Social Security number has nine digits, like 123-45-6789");
  // SSA never issues area 000, 666 or 900-999, group 00 or serial 0000.
  if (/^(000|666|9\d\d)/.test(digits) || digits.slice(3, 5) === "00" || digits.slice(5) === "0000") {
    throw new LedgerError("INVALID", "that isn't a valid Social Security number");
  }
  return digits;
}
