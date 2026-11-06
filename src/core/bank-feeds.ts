import type pg from "pg";
import { withSystem, withTenant, type Tx } from "../db/pool.js";
import { appendAudit } from "./audit.js";
import { LedgerError } from "./errors.js";
import { bankAccount, insertBankLines, type ImportResult } from "./bank.js";
import { seal, unseal } from "./pii.js";
import type { Actor, Role } from "./ledger.js";
import { PlaidError, type PlaidClient, type PlaidTransaction } from "../app/plaid.js";

// Automatic bank feeds. A business connects a bank login through Plaid Link;
// TrailBook keeps the sealed access token and pulls posted transactions into
// the same review queue as imported files (pending ones wait until they post).
// Each transaction is keyed by Plaid's ID, so a sync never adds a line twice.

const CAN_CONNECT: Role[] = ["owner", "admin", "accountant"];
const CAN_SYNC: Role[] = ["owner", "admin", "accountant", "bookkeeper", "system"];

export interface BankFeed {
  id: string;
  bankAccount: string;
  institution: string | null;
  accountName: string | null;
  accountMask: string | null;
  status: "active" | "needs_login" | "error" | "removed";
  lastSyncedAt: string | null;
  lastError: string | null;
}

const feedOf = (r: any): BankFeed => ({
  id: r.id, bankAccount: r.code, institution: r.institution, accountName: r.account_name, accountMask: r.account_mask,
  status: r.status, lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null, lastError: r.last_error,
});

export async function listFeeds(tx: Tx, entityId: string): Promise<BankFeed[]> {
  const { rows } = await tx.query(
    `SELECT f.*, a.code FROM bank_feeds f JOIN accounts a ON a.id = f.bank_account_id
      WHERE f.entity_id = $1 AND f.status <> 'removed' ORDER BY a.code`,
    [entityId],
  );
  return rows.map(feedOf);
}

async function feedRow(tx: Tx, entityId: string, feedId: string) {
  const r = (await tx.query("SELECT f.*, a.code FROM bank_feeds f JOIN accounts a ON a.id = f.bank_account_id WHERE f.id = $1 AND f.entity_id = $2", [feedId, entityId])).rows[0];
  if (!r || r.status === "removed") throw new LedgerError("INVALID", "bank connection not found");
  return r;
}

/** Links a bank account here to an account at the bank, from Plaid Link's public token, and pulls its recent transactions. */
export async function connectFeed(
  tx: Tx, plaid: PlaidClient,
  input: { orgId: string; entityId: string; bankAccount: string; publicToken: string; providerAccountId?: string; institution?: string; actor: Actor },
): Promise<{ feed: BankFeed; sync: ImportResult }> {
  if (!CAN_CONNECT.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", "only an owner, admin or accountant can connect a bank");
  const acct = await bankAccount(tx, input.entityId, input.bankAccount);
  if ((await tx.query("SELECT 1 FROM bank_feeds WHERE bank_account_id = $1 AND status <> 'removed'", [acct.id])).rows[0]) {
    throw new LedgerError("INVALID", `${acct.code} ${acct.name} is already connected; remove that connection first`);
  }
  const { accessToken, itemId } = await plaid.exchange(input.publicToken);
  const accounts = await plaid.accounts(accessToken);
  const chosen = input.providerAccountId ? accounts.find((a) => a.id === input.providerAccountId) : accounts.length === 1 ? accounts[0] : undefined;
  if (!chosen) {
    // Don't leave a login connected (and billed) that nothing uses.
    await plaid.remove(accessToken).catch(() => undefined);
    throw new LedgerError("INVALID", accounts.length > 1 ? "choose one account at the bank for this bank account" : "that bank account wasn't found at the bank");
  }
  const { rows } = await tx.query(
    `INSERT INTO bank_feeds (org_id, entity_id, bank_account_id, provider, item_id, provider_account_id, access_token_sealed, institution, account_name, account_mask, created_by)
     VALUES ($1, $2, $3, 'plaid', $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [input.orgId, input.entityId, acct.id, itemId, chosen.id, seal(accessToken), input.institution?.slice(0, 120) || null, chosen.name?.slice(0, 120) ?? null, chosen.mask?.slice(-4) ?? null, input.actor.id],
  );
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "bank_feed.connected", objectType: "bank_feed", objectId: rows[0].id,
    after: { bankAccount: acct.code, provider: "plaid", env: plaid.env, institution: input.institution ?? null, accountMask: chosen.mask?.slice(-4) ?? null },
    context: { role: input.actor.role },
  });
  const sync = await syncFeed(tx, plaid, { orgId: input.orgId, entityId: input.entityId, feedId: rows[0].id, actor: input.actor });
  return { feed: feedOf((await feedRow(tx, input.entityId, rows[0].id))), sync };
}

const toLine = (t: PlaidTransaction) => ({
  date: t.date,
  description: (t.merchant_name && !t.name.toLowerCase().includes(t.merchant_name.toLowerCase()) ? `${t.merchant_name} ${t.name}` : t.name || t.merchant_name || "Bank transaction").replace(/\s+/g, " ").slice(0, 300),
  // Plaid reports money out as positive; the books store it as negative.
  amountMinor: -BigInt(Math.round(t.amount * 100)),
  key: `plaid:${t.transaction_id}`,
});

/** Pulls new posted transactions for one connection. A bank asking the owner to sign in again marks the connection, not an error. */
export async function syncFeed(
  tx: Tx, plaid: PlaidClient, input: { orgId: string; entityId: string; feedId: string; actor: Actor },
): Promise<ImportResult & { status: BankFeed["status"]; message?: string }> {
  if (!CAN_SYNC.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot sync bank connections`);
  const f = await feedRow(tx, input.entityId, input.feedId);
  const token = unseal(f.access_token_sealed);
  const added: PlaidTransaction[] = [];
  let cursor: string | null = f.sync_cursor;
  try {
    // Every page first, then the database: the cursor only moves once the lines are in.
    for (let page = 0; page < 40; page++) {
      const r = await plaid.sync(token, cursor);
      added.push(...r.added, ...r.modified.filter((m) => !m.pending));
      cursor = r.nextCursor;
      if (!r.hasMore) break;
    }
  } catch (err) {
    if (!(err instanceof PlaidError)) throw err;
    const status = err.code === "ITEM_LOGIN_REQUIRED" || err.code === "PENDING_EXPIRATION" ? "needs_login" : "error";
    await tx.query("UPDATE bank_feeds SET status = $2, last_error = $3 WHERE id = $1", [f.id, status, err.message.slice(0, 300)]);
    return { importId: "", added: 0, autoRecorded: 0, duplicates: 0, unreadableRows: [], status, message: err.message };
  }
  const lines = added.filter((t) => t.account_id === f.provider_account_id && !t.pending).map(toLine);
  const result = await insertBankLines(tx, {
    orgId: input.orgId, entityId: input.entityId, acct: { id: f.bank_account_id, code: f.code }, lines, unreadable: [],
    fileName: `Bank feed${f.institution ? `: ${f.institution}` : ""}`, actor: input.actor,
  });
  await tx.query("UPDATE bank_feeds SET sync_cursor = $2, status = 'active', last_error = NULL, last_synced_at = now() WHERE id = $1", [f.id, cursor]);
  return { ...result, status: "active" };
}

/** After the owner signs in again through Plaid Link (update mode). */
export async function markReconnected(tx: Tx, input: { orgId: string; entityId: string; feedId: string; actor: Actor }): Promise<void> {
  if (!CAN_CONNECT.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", "only an owner, admin or accountant can reconnect a bank");
  const f = await feedRow(tx, input.entityId, input.feedId);
  await tx.query("UPDATE bank_feeds SET status = 'active', last_error = NULL WHERE id = $1", [f.id]);
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "bank_feed.reconnected", objectType: "bank_feed", objectId: f.id,
    after: { bankAccount: f.code }, context: { role: input.actor.role },
  });
}

/** The sealed token, for Plaid Link's update mode. Never leaves the server. */
export async function feedAccessToken(tx: Tx, entityId: string, feedId: string): Promise<string> {
  return unseal((await feedRow(tx, entityId, feedId)).access_token_sealed);
}

/** Disconnects at Plaid (so it stops billing) and keeps the record. Lines already imported stay. */
export async function removeFeed(tx: Tx, plaid: PlaidClient, input: { orgId: string; entityId: string; feedId: string; actor: Actor }): Promise<void> {
  if (!CAN_CONNECT.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", "only an owner, admin or accountant can remove a bank connection");
  const f = await feedRow(tx, input.entityId, input.feedId);
  try {
    await plaid.remove(unseal(f.access_token_sealed));
  } catch (err) {
    if (!(err instanceof PlaidError) || err.code !== "ITEM_NOT_FOUND") throw err;
  }
  await tx.query("UPDATE bank_feeds SET status = 'removed', removed_at = now() WHERE id = $1", [f.id]);
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "bank_feed.removed", objectType: "bank_feed", objectId: f.id,
    after: { bankAccount: f.code }, context: { role: input.actor.role },
  });
}

/** The daily run: every live connection, each in its own tenant transaction. */
export async function syncAllFeeds(pool: pg.Pool, plaid: PlaidClient): Promise<{ synced: number; added: number; needsLogin: number; failed: number }> {
  const feeds = await withSystem(pool, async (tx) => (await tx.query("SELECT id, org_id, entity_id FROM bank_feeds WHERE status IN ('active', 'error') ORDER BY created_at")).rows);
  const out = { synced: 0, added: 0, needsLogin: 0, failed: 0 };
  const actor: Actor = { id: "system:bank-feeds", role: "system" };
  for (const f of feeds) {
    try {
      const r = await withTenant(pool, f.org_id, (tx) => syncFeed(tx, plaid, { orgId: f.org_id, entityId: f.entity_id, feedId: f.id, actor }));
      if (r.status === "needs_login") out.needsLogin++;
      else if (r.status === "error") out.failed++;
      else { out.synced++; out.added += r.added; }
    } catch (err) {
      out.failed++;
      console.error(`bank feed ${f.id}: ${(err as Error).message}`);
    }
  }
  return out;
}
