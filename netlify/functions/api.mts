import { getConnectionString } from "@netlify/database";
import type { Config } from "@netlify/functions";
import pg from "pg";
import { handleApi } from "../../src/app/api.js";
import { mailerFromEnv } from "../../src/app/mail.js";
import { cdtfaRateLookup } from "../../src/app/cdtfa.js";
import { getStore } from "@netlify/blobs";
import { netlifyBackupStore } from "../../src/app/backup-store.js";
import { backupKeyFromEnv } from "../../src/core/nightly-backups.js";
import { billingFromEnv } from "../../src/app/billing-config.js";
import "../../src/db/pool.js";

// One pool per function instance, reused across invocations.
const pool = new pg.Pool({ connectionString: getConnectionString(), max: 3 });

const mailer = mailerFromEnv();
// Links in emails use the site's configured address: APP_URL if set, else Netlify's own URL for this deploy.
const appUrl = process.env.APP_URL || (process.env.CONTEXT === "production" ? process.env.URL : process.env.DEPLOY_PRIME_URL || process.env.URL);

// California sales tax rates come from the CDTFA's public rate lookup.
const taxRates = cdtfaRateLookup();

// Nightly backups are encrypted with BACKUP_KEY; restore points can be downloaded once it's set.
const backupKey = backupKeyFromEnv();
const billing = billingFromEnv();

export default async (req: Request) => handleApi(req, pool, {
  signupCode: process.env.SIGNUP_CODE, mailer, appUrl, taxRates, billing,
  backups: backupKey ? { store: netlifyBackupStore(getStore({ name: "backups", consistency: "strong" })), key: backupKey } : undefined,
});

export const config: Config = { path: "/api/*" };
