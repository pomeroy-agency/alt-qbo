import { getConnectionString } from "@netlify/database";
import type { Config } from "@netlify/functions";
import pg from "pg";
import { mailerFromEnv } from "../../src/app/mail.js";
import { cdtfaRateLookup } from "../../src/app/cdtfa.js";
import { EXAMPLE_ORG_NAME } from "../../src/app/example.js";
import { runRecurring, sendInvoiceReminders } from "../../src/core/invoicing.js";
import { pacificToday } from "../../src/payroll/business-days.js";
import { strictSsl } from "../../src/db/pool.js";

// Every morning: issue the recurring invoices and bills due today (emailing
// the invoices set to go out), then send customers' payment reminders for the
// businesses that turned them on. The example business never emails anyone.
const appUrl = process.env.APP_URL || process.env.URL;

export default async () => {
  const pool = new pg.Pool({ connectionString: strictSsl(getConnectionString()), max: 2 });
  try {
    const mailer = mailerFromEnv();
    const today = pacificToday();
    const rec = await runRecurring(pool, { today, lookup: cdtfaRateLookup(), mailer, appUrl, excludeOrg: EXAMPLE_ORG_NAME });
    console.log(`recurring: ${rec.issued} issued, ${rec.emailed} emailed, ${rec.failed} failed`);
    const rem = await sendInvoiceReminders(pool, { today, mailer, appUrl, excludeOrg: EXAMPLE_ORG_NAME });
    console.log(`invoice reminders: ${rem.sent} sent, ${rem.failed} failed`);
  } finally {
    await pool.end();
  }
};

// 14:00 UTC is 6 or 7 a.m. in California, before the deposit reminders.
export const config: Config = { schedule: "0 14 * * *" };
