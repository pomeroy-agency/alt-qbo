import type { Tx } from "../db/pool.js";

// The terms of service in force, as published at /terms.html. Change the
// version (the date the new text takes effect) whenever the text changes,
// and owners and admins are asked to accept it again.
export const TERMS_VERSION = "2026-10-29";

/** Records that a person accepted the current terms for an organisation. Safe to repeat. */
export async function acceptTerms(tx: Tx, orgId: string, userId: string): Promise<void> {
  await tx.query(
    "INSERT INTO terms_acceptances (org_id, user_id, version) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [orgId, userId, TERMS_VERSION],
  );
}

/** The organisations, of those given, that have accepted the current terms. */
export async function orgsAccepted(tx: Pick<Tx, "query">, orgIds: string[]): Promise<Set<string>> {
  if (!orgIds.length) return new Set();
  const { rows } = await tx.query("SELECT DISTINCT org_id FROM terms_acceptances WHERE org_id = ANY($1) AND version = $2", [orgIds, TERMS_VERSION]);
  return new Set(rows.map((r) => r.org_id as string));
}
