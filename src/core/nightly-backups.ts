import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type pg from "pg";
import { withSystem, withTenant, type Tx } from "../db/pool.js";
import { backupEntity, verifyBackup, type Backup } from "./backup.js";

// Every night, a full backup of each business's books goes to storage kept
// apart from the database, encrypted with a key held outside both, and is
// read straight back and checked: the file opens, its checksum matches, the
// audit chain was intact, every entry balances, and the balance of every
// account in the copy equals the balance in the live books. Copies are kept
// for 30 days. Each run is recorded so the business can see its restore
// points and download any of them.

export const KEEP_DAYS = 30;
const MAGIC = Buffer.from("AQB1");
const ACTOR = { id: "system:nightly-backup", role: "system" as const };

/** Where encrypted copies are kept: Netlify Blobs in production, memory in tests. */
export interface BackupStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export function backupKeyFromEnv(raw = process.env.BACKUP_KEY): Buffer | null {
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("BACKUP_KEY must be 32 bytes, base64-encoded");
  return k;
}

/** gzip, then AES-256-GCM: "AQB1" | iv (12) | tag (16) | ciphertext. */
export function sealBackup(backup: Backup, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(gzipSync(JSON.stringify(backup, (_k, v) => (typeof v === "bigint" ? v.toString() : v)))), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function openBackup(data: Uint8Array, key: Buffer): Backup {
  const buf = Buffer.from(data);
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("not an encrypted Alt-QBO backup");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(4, 16));
  d.setAuthTag(buf.subarray(16, 32));
  const zipped = Buffer.concat([d.update(buf.subarray(32)), d.final()]);
  return JSON.parse(gunzipSync(zipped).toString("utf8"));
}

/** A fingerprint of every account's balance: the same books give the same value. */
function fingerprint(rows: { account_id: string; net: string | bigint }[]): string {
  const lines = rows.filter((r) => BigInt(r.net) !== 0n).map((r) => `${r.account_id}:${BigInt(r.net)}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

async function liveFingerprint(tx: Tx, entityId: string): Promise<string> {
  const { rows } = await tx.query(
    "SELECT account_id, sum(debit_minor - credit_minor)::text AS net FROM journal_lines WHERE entity_id = $1 GROUP BY account_id",
    [entityId],
  );
  return fingerprint(rows);
}

/** The checks a copy must pass to count as a restore point. Returns the first problem, or null. */
export function checkCopy(b: Backup, expectedFingerprint: string): string | null {
  const v = verifyBackup(b);
  if (!v.ok) return v.reason ?? "the copy didn't verify";
  if (!(b.audit.verification as { ok?: boolean })?.ok) return "the audit chain was broken when the copy was taken";
  for (const [table, n] of Object.entries(b.counts)) {
    if ((b.tables[table]?.length ?? -1) !== n) return `the copy is missing rows from ${table}`;
  }
  const perEntry = new Map<string, bigint>();
  const perAccount = new Map<string, bigint>();
  for (const l of b.tables.journal_lines ?? []) {
    const net = BigInt(String(l.debit_minor)) - BigInt(String(l.credit_minor));
    perEntry.set(String(l.entry_id), (perEntry.get(String(l.entry_id)) ?? 0n) + net);
    perAccount.set(String(l.account_id), (perAccount.get(String(l.account_id)) ?? 0n) + net);
  }
  for (const [entry, net] of perEntry) if (net !== 0n) return `journal entry ${entry} doesn't balance in the copy`;
  const got = fingerprint([...perAccount].map(([account_id, net]) => ({ account_id, net })));
  if (got !== expectedFingerprint) return "account balances in the copy don't match the books";
  return null;
}

const blobKey = (orgId: string, entityId: string, date: string) => `${orgId}/${entityId}/${date}.bin`;

export interface NightlyResult { backedUp: number; failed: number; removed: number }

/** Backs up every business except the practice examples. `today` is the Pacific date the run is for. */
export async function runNightlyBackups(
  pool: pg.Pool, store: BackupStore, key: Buffer, today: string, opts: { skipOrgNames?: string[] } = {},
): Promise<NightlyResult> {
  const entities = (await withSystem(pool, (tx) => tx.query(
    `SELECT e.org_id, e.id FROM entities e JOIN organizations o ON o.id = e.org_id
      WHERE NOT (o.name = ANY($1)) ORDER BY e.created_at`,
    [opts.skipOrgNames ?? []],
  ))).rows as { org_id: string; id: string }[];
  const result: NightlyResult = { backedUp: 0, failed: 0, removed: 0 };
  for (const e of entities) {
    const key_ = blobKey(e.org_id, e.id, today);
    let problem: string | null = null;
    let bytes = 0;
    let checksum: string | null = null;
    try {
      const { backup, expected } = await withTenant(pool, e.org_id, async (tx) => ({
        backup: await backupEntity(tx, { orgId: e.org_id, entityId: e.id, actor: ACTOR, scheduled: true }),
        expected: await liveFingerprint(tx, e.id),
      }));
      const sealed = sealBackup(backup, key);
      await store.put(key_, sealed);
      bytes = sealed.length;
      checksum = backup.checksum;
      // Read it back from storage, as a restore would.
      const stored = await store.get(key_);
      problem = stored ? checkCopy(openBackup(stored, key), expected) : "the copy couldn't be read back from storage";
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
    await withSystem(pool, (tx) => tx.query(
      `INSERT INTO backup_runs (org_id, entity_id, backup_date, blob_key, bytes, checksum, verified, problem)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (entity_id, backup_date) DO UPDATE
         SET blob_key = EXCLUDED.blob_key, bytes = EXCLUDED.bytes, checksum = EXCLUDED.checksum,
             verified = EXCLUDED.verified, problem = EXCLUDED.problem, created_at = now()`,
      [e.org_id, e.id, today, key_, bytes, checksum, problem === null, problem],
    ));
    if (problem) {
      result.failed++;
      console.error(`backup of entity ${e.id} failed: ${problem}`);
    } else {
      result.backedUp++;
    }
    result.removed += await pruneOld(pool, store, e.org_id, e.id, today);
  }
  return result;
}

function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Removes copies older than the keeping period, and marks their runs as expired. */
async function pruneOld(pool: pg.Pool, store: BackupStore, orgId: string, entityId: string, today: string): Promise<number> {
  const cutoff = daysBefore(today, KEEP_DAYS);
  let removed = 0;
  for (const k of await store.list(`${orgId}/${entityId}/`)) {
    const date = /(\d{4}-\d{2}-\d{2})\.bin$/.exec(k)?.[1];
    if (date && date < cutoff) {
      await store.delete(k);
      removed++;
    }
  }
  if (removed) {
    await withSystem(pool, (tx) => tx.query(
      "UPDATE backup_runs SET expired = true WHERE entity_id = $1 AND backup_date < $2 AND NOT expired",
      [entityId, cutoff],
    ));
  }
  return removed;
}

export interface RestorePoint { id: string; date: string; verified: boolean; problem: string | null; bytes: number; createdAt: string }

export async function listRestorePoints(tx: Tx, entityId: string): Promise<RestorePoint[]> {
  const { rows } = await tx.query(
    `SELECT id, backup_date::text AS date, verified, problem, bytes, created_at FROM backup_runs
      WHERE entity_id = $1 AND NOT expired ORDER BY backup_date DESC LIMIT $2`,
    [entityId, KEEP_DAYS + 1],
  );
  return rows.map((r) => ({ id: r.id, date: r.date, verified: r.verified, problem: r.problem, bytes: Number(r.bytes), createdAt: r.created_at.toISOString() }));
}

/** Opens one stored restore point for download. */
export async function readRestorePoint(tx: Tx, store: BackupStore, key: Buffer, entityId: string, runId: string): Promise<Backup> {
  const run = (await tx.query("SELECT blob_key, verified, expired FROM backup_runs WHERE id = $1 AND entity_id = $2", [runId, entityId])).rows[0];
  if (!run || run.expired || !run.verified) throw new Error("that backup isn't available");
  const data = await store.get(run.blob_key);
  if (!data) throw new Error("that backup isn't available");
  return openBackup(data, key);
}

/** An in-memory store, for tests and local development. */
export function memoryStore(): BackupStore & { data: Map<string, Uint8Array> } {
  const data = new Map<string, Uint8Array>();
  return {
    data,
    put: async (k, v) => { data.set(k, v); },
    get: async (k) => data.get(k) ?? null,
    list: async (p) => [...data.keys()].filter((k) => k.startsWith(p)),
    delete: async (k) => { data.delete(k); },
  };
}
