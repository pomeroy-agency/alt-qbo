import { createHash } from "node:crypto";
import type { Tx } from "../db/pool.js";

export interface AuditInput {
  orgId: string;
  entityId?: string | null;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  before?: unknown;
  after?: unknown;
  context?: Record<string, unknown>;
}

export interface AuditEvent {
  orgId: string;
  seq: bigint;
  entityId: string | null;
  occurredAt: string;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  before: unknown;
  after: unknown;
  context: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

/** JSON with sorted keys and bigints as strings, so the same data always hashes the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalise(v);
    }
    return out;
  }
  return value;
}

export function genesisHash(orgId: string): string {
  return sha256(`alt-qbo:audit-genesis:${orgId}`);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function eventHash(e: Omit<AuditEvent, "hash">): string {
  return sha256(
    canonicalJson({
      orgId: e.orgId,
      seq: e.seq,
      entityId: e.entityId,
      occurredAt: e.occurredAt,
      actor: e.actor,
      action: e.action,
      objectType: e.objectType,
      objectId: e.objectId,
      before: e.before,
      after: e.after,
      context: e.context,
      prevHash: e.prevHash,
    }),
  );
}

/** Starts an organisation's chain. Called once, when the organisation is created. */
export async function initAuditChain(tx: Tx, orgId: string): Promise<void> {
  await tx.query("INSERT INTO audit_heads (org_id, last_seq, last_hash) VALUES ($1, 0, $2)", [
    orgId,
    genesisHash(orgId),
  ]);
}

/**
 * Appends an event to the organisation's chain inside the caller's
 * transaction, so the event commits or rolls back with the change it records.
 */
export async function appendAudit(tx: Tx, input: AuditInput): Promise<AuditEvent> {
  const head = await tx.query<{ last_seq: bigint; last_hash: string }>(
    "SELECT last_seq, last_hash FROM audit_heads WHERE org_id = $1 FOR UPDATE",
    [input.orgId],
  );
  const row = head.rows[0];
  if (!row) throw new Error(`no audit chain for organisation ${input.orgId}`);

  const base = {
    orgId: input.orgId,
    seq: row.last_seq + 1n,
    entityId: input.entityId ?? null,
    occurredAt: new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId,
    before: JSON.parse(canonicalJson(input.before ?? null)),
    after: JSON.parse(canonicalJson(input.after ?? null)),
    context: JSON.parse(canonicalJson(input.context ?? {})),
    prevHash: row.last_hash,
  };
  const event: AuditEvent = { ...base, hash: eventHash(base) };

  await tx.query(
    `INSERT INTO audit_events (org_id, seq, entity_id, occurred_at, actor, action, object_type,
       object_id, before, after, context, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      event.orgId, event.seq, event.entityId, event.occurredAt, event.actor, event.action,
      event.objectType, event.objectId, canonicalJson(event.before), canonicalJson(event.after),
      canonicalJson(event.context), event.prevHash, event.hash,
    ],
  );
  await tx.query("UPDATE audit_heads SET last_seq = $2, last_hash = $3 WHERE org_id = $1", [
    event.orgId, event.seq, event.hash,
  ]);
  return event;
}

export interface ChainVerification {
  ok: boolean;
  events: number;
  /** First sequence number where the chain fails, if it does. */
  brokenAt?: bigint;
  reason?: string;
}

/** Recomputes every hash in the organisation's chain and checks the head points at the end. */
export async function verifyAuditChain(tx: Tx, orgId: string): Promise<ChainVerification> {
  const { rows } = await tx.query(
    `SELECT org_id, seq, entity_id, occurred_at, actor, action, object_type, object_id,
            before, after, context, prev_hash, hash
       FROM audit_events WHERE org_id = $1 ORDER BY seq`,
    [orgId],
  );
  let prev = genesisHash(orgId);
  let expectedSeq = 1n;
  for (const r of rows) {
    const e: AuditEvent = {
      orgId: r.org_id,
      seq: r.seq,
      entityId: r.entity_id,
      occurredAt: (r.occurred_at as Date).toISOString(),
      actor: r.actor,
      action: r.action,
      objectType: r.object_type,
      objectId: r.object_id,
      before: r.before,
      after: r.after,
      context: r.context,
      prevHash: r.prev_hash,
      hash: r.hash,
    };
    if (e.seq !== expectedSeq) return fail(rows.length, e.seq, `expected seq ${expectedSeq}`);
    if (e.prevHash !== prev) return fail(rows.length, e.seq, "prev_hash does not match previous event");
    const { hash, ...rest } = e;
    if (eventHash(rest) !== hash) return fail(rows.length, e.seq, "hash does not match event contents");
    prev = hash;
    expectedSeq++;
  }
  const head = await tx.query<{ last_seq: bigint; last_hash: string }>(
    "SELECT last_seq, last_hash FROM audit_heads WHERE org_id = $1",
    [orgId],
  );
  const h = head.rows[0];
  if (!h || h.last_seq !== expectedSeq - 1n || h.last_hash !== prev) {
    return fail(rows.length, expectedSeq, "audit head does not match the last event (events missing)");
  }
  return { ok: true, events: rows.length };
}

function fail(events: number, brokenAt: bigint, reason: string): ChainVerification {
  return { ok: false, events, brokenAt, reason };
}

/** Exports the chain for an auditor: every event plus the head, as canonical JSON lines. */
export async function exportAuditChain(tx: Tx, orgId: string): Promise<string> {
  const { rows } = await tx.query(
    "SELECT * FROM audit_events WHERE org_id = $1 ORDER BY seq",
    [orgId],
  );
  return rows.map((r) => canonicalJson(r)).join("\n");
}
