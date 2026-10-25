import { getConnectionString } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import pg from "pg";
import { EXAMPLE_ORG_NAME } from "../../src/app/example.js";
import { backupKeyFromEnv, runNightlyBackups } from "../../src/core/nightly-backups.js";
import { netlifyBackupStore } from "../../src/app/backup-store.js";
import { pacificToday } from "../../src/payroll/business-days.js";
import { mailerFromEnv } from "../../src/app/mail.js";
import "../../src/db/pool.js";

// Every night: an encrypted copy of each business's books, read back and checked, kept 30 days.
export default async () => {
  const key = backupKeyFromEnv();
  if (!key) {
    console.error("nightly backups skipped: BACKUP_KEY is not set");
    return;
  }
  const pool = new pg.Pool({ connectionString: getConnectionString(), max: 2 });
  try {
    const result = await runNightlyBackups(pool, netlifyBackupStore(getStore({ name: "backups", consistency: "strong" })), key, pacificToday(), {
      skipOrgNames: [EXAMPLE_ORG_NAME],
    });
    console.log(`nightly backups: ${result.backedUp} verified, ${result.failed} failed, ${result.removed} old copies removed`);
    // OPS_EMAIL hears about any copy that failed its check, so someone looks the same morning.
    const mailer = mailerFromEnv();
    if (result.failed && mailer && process.env.OPS_EMAIL) {
      await mailer({
        to: process.env.OPS_EMAIL,
        subject: `Nightly backups: ${result.failed} failed`,
        text: `${result.failed} of ${result.failed + result.backedUp} nightly backups failed their check. The function log has the reason for each one.\n`,
      });
    }
  } finally {
    await pool.end();
  }
};

// 10:00 UTC is 2 or 3 a.m. in California, after the day's work.
export const config: Config = { schedule: "0 10 * * *" };
