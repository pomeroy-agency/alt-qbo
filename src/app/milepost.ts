import type { Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { LedgerError } from "../core/errors.js";
import { seal, unseal } from "../core/pii.js";

// TrailBook calling MilePost (Greg's CRM) with a MilePost API key, for the
// MilePost tab inside TrailBook. The key belongs to one MilePost organisation
// and is linked to one TrailBook business. It is sealed with PII_KEY before
// it is stored and is only ever used on the server: the browser sees the
// last four characters, never the key.

export interface MilePostOptions {
  /** MilePost's address, like https://crm.pomeroyagency.com. */
  url: string;
  /** For tests. */
  fetch?: typeof fetch;
}

export interface MilePostAccount { id: string | null; name: string | null; active: boolean }

export interface MilePostContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  lifecycle_stage: string | null;
  created_at: string | null;
}

/** How long a "subscription active" answer is trusted before MilePost is asked again. */
const RECHECK_MS = 15 * 60_000;

async function call<T>(mp: MilePostOptions, apiKey: string, path: string): Promise<T> {
  const f = mp.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(`${mp.url.replace(/\/+$/, "")}/api/v1${path}`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LedgerError("INVALID", "MilePost didn't answer; try again in a minute");
  }
  if (res.status === 401 || res.status === 403) throw new LedgerError("FORBIDDEN", "MilePost refused the API key; it may have been revoked. Paste a new one under Integrations");
  if (!res.ok) throw new LedgerError("INVALID", `MilePost answered with an error (${res.status})`);
  return (await res.json()) as T;
}

/** MilePost's /me: which organisation the key belongs to, and its subscription when MilePost reports one. */
async function whoAmI(mp: MilePostOptions, apiKey: string): Promise<MilePostAccount> {
  const me = await call<{ org?: { id?: string; name?: string }; subscription?: { active?: boolean } }>(mp, apiKey, "/me");
  // MilePost doesn't report a subscription yet; until it does, a working key counts as active.
  return { id: me.org?.id ?? null, name: me.org?.name ?? null, active: me.subscription?.active !== false };
}

export function cleanApiKey(raw: unknown): string {
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!/^pacrm_[A-Za-z0-9_-]{20,200}$/.test(key)) throw new LedgerError("INVALID", "a MilePost API key starts with pacrm_; create one in MilePost under Integrations, API keys");
  return key;
}

/** Checks the key with MilePost first, outside any transaction. */
export async function checkKey(mp: MilePostOptions, apiKey: string): Promise<MilePostAccount> {
  return whoAmI(mp, apiKey);
}

/** Saves a checked key for this business, replacing any earlier one. */
export async function saveKey(
  tx: Tx,
  input: { orgId: string; entityId: string; apiKey: string; account: MilePostAccount; actor: string },
): Promise<void> {
  const old = (await tx.query("SELECT id FROM app_links WHERE entity_id = $1 AND app = 'milepost' AND removed_at IS NULL", [input.entityId])).rows[0];
  if (old) await tx.query("UPDATE app_links SET removed_at = now(), removed_by = $2 WHERE id = $1", [old.id, input.actor]);
  const { rows } = await tx.query(
    `INSERT INTO app_links (org_id, entity_id, app, api_key_sealed, key_hint, account_id, account_name, active, created_by)
     VALUES ($1, $2, 'milepost', $3, $4, $5, $6, $7, $8) RETURNING id`,
    [input.orgId, input.entityId, seal(input.apiKey), input.apiKey.slice(-4), input.account.id, input.account.name, input.account.active, input.actor],
  );
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor, action: "app.key_saved",
    objectType: "app_link", objectId: rows[0].id, after: { app: "milepost", account: input.account.name, keyHint: input.apiKey.slice(-4) },
  });
}

export async function removeKey(tx: Tx, input: { orgId: string; entityId: string; actor: string }): Promise<boolean> {
  const { rows } = await tx.query(
    "UPDATE app_links SET removed_at = now(), removed_by = $2 WHERE entity_id = $1 AND app = 'milepost' AND removed_at IS NULL RETURNING id",
    [input.entityId, input.actor],
  );
  if (!rows[0]) return false;
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor, action: "app.key_removed",
    objectType: "app_link", objectId: rows[0].id, after: { app: "milepost" },
  });
  return true;
}

export interface KeyLink { id: string; apiKey: string; keyHint: string; accountName: string | null; active: boolean; checkedAt: Date }

export async function getKeyLink(tx: Tx, entityId: string): Promise<KeyLink | null> {
  const r = (await tx.query(
    "SELECT id, api_key_sealed, key_hint, account_name, active, checked_at FROM app_links WHERE entity_id = $1 AND app = 'milepost' AND removed_at IS NULL",
    [entityId],
  )).rows[0];
  if (!r) return null;
  return { id: r.id, apiKey: unseal(r.api_key_sealed), keyHint: r.key_hint, accountName: r.account_name, active: r.active, checkedAt: new Date(r.checked_at) };
}

/** Whether a stored answer is old enough to ask MilePost again. */
export const needsRecheck = (link: KeyLink, now = Date.now()) => now - link.checkedAt.getTime() > RECHECK_MS;

export async function recordCheck(tx: Tx, linkId: string, account: MilePostAccount): Promise<void> {
  await tx.query("UPDATE app_links SET active = $2, account_name = coalesce($3, account_name), checked_at = now() WHERE id = $1", [linkId, account.active, account.name]);
}

/** MilePost contacts: the latest 25, or the ones with this email. */
export async function listContacts(mp: MilePostOptions, apiKey: string, email?: string): Promise<MilePostContact[]> {
  const q = email ? `?email=${encodeURIComponent(email)}` : "";
  const out = await call<MilePostContact[] | { contacts?: MilePostContact[] }>(mp, apiKey, `/contacts${q}`);
  const list = Array.isArray(out) ? out : out.contacts ?? [];
  // Only what the tab shows; nothing else from MilePost is kept or passed on.
  return list.slice(0, 100).map((c) => ({
    id: String(c.id), first_name: c.first_name ?? null, last_name: c.last_name ?? null, email: c.email ?? null, phone: c.phone ?? null,
    job_title: c.job_title ?? null, lifecycle_stage: c.lifecycle_stage ?? null, created_at: c.created_at ?? null,
  }));
}
