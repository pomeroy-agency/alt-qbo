import { getConnectionString } from "@netlify/database";
import type { Config } from "@netlify/functions";
import pg from "pg";
import { syncAllFeeds } from "../../src/core/bank-feeds.js";
import { plaidFromEnv } from "../../src/app/plaid.js";
import { strictSsl } from "../../src/db/pool.js";

// Every morning, before the business day: pull new transactions for every
// connected bank account into its review queue. Does nothing until Plaid's
// keys (PLAID_CLIENT_ID, PLAID_SECRET) are set.
export default async () => {
  const plaid = plaidFromEnv();
  if (!plaid) { console.log("bank feeds skipped: PLAID_CLIENT_ID and PLAID_SECRET aren't set"); return; }
  const pool = new pg.Pool({ connectionString: strictSsl(getConnectionString()), max: 2 });
  try {
    const r = await syncAllFeeds(pool, plaid);
    console.log(`bank feeds: ${r.synced} synced, ${r.added} lines added, ${r.needsLogin} need the owner to sign in again, ${r.failed} failed`);
  } finally {
    await pool.end();
  }
};

// 12:00 UTC is 4 or 5 a.m. in California, before the bank rules' auto-recording is wanted.
export const config: Config = { schedule: "0 12 * * *" };
