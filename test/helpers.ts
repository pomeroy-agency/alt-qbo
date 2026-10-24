import { afterAll } from "vitest";
import { createPool, withSystem, withTenant } from "../src/db/pool.js";
import { createEntity, createOrganization } from "../src/core/tenancy.js";
import type { Actor } from "../src/core/ledger.js";

export const pool = createPool(process.env.DATABASE_URL);
afterAll(() => pool.end());

export const owner: Actor = { id: "user:owner", role: "owner" };
export const bookkeeper: Actor = { id: "user:bookkeeper", role: "bookkeeper" };
export const accountant: Actor = { id: "user:cpa", role: "accountant" };
export const approver: Actor = { id: "user:approver", role: "approver" };

/** A fresh organisation with one California LLC, fiscal year 2026. */
export async function setupCaliforniaBusiness(name = "Sunset Design Studio") {
  const org = await withSystem(pool, (tx) => createOrganization(tx, { name, actor: owner }));
  const entity = await withTenant(pool, org.id, (tx) =>
    createEntity(tx, {
      orgId: org.id,
      legalName: `${name} LLC`,
      entityType: "llc_single",
      place: { country: "US", region: "CA" },
      firstFiscalYear: 2026,
      actor: owner,
    }),
  );
  return { org, entity };
}
