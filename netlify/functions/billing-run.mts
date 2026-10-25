import { getConnectionString } from "@netlify/database";
import type { Config } from "@netlify/functions";
import pg from "pg";
import { billingFromEnv } from "../../src/app/billing-config.js";
import { cdtfaRateLookup } from "../../src/app/cdtfa.js";
import { mailerFromEnv } from "../../src/app/mail.js";
import { heldCharges, runBilling } from "../../src/billing/billing.js";
import { pacificToday } from "../../src/payroll/business-days.js";
import "../../src/db/pool.js";

// Every morning: renew subscriptions that are due, bill people paid on yearly
// payroll plans, and retry failed payments. Charges needing a person are
// emailed to OPS_EMAIL.
const appUrl = process.env.APP_URL || process.env.URL;

export default async () => {
  const cfg = { ...billingFromEnv(), mailer: mailerFromEnv(), taxRates: cdtfaRateLookup(), appUrl };
  if (!cfg.gateway || !cfg.seller) {
    console.log("billing skipped: STRIPE_SECRET_KEY, BILLING_SELLER_ORG_ID and BILLING_SELLER_ENTITY_ID are needed");
    return;
  }
  const pool = new pg.Pool({ connectionString: getConnectionString(), max: 2 });
  try {
    const r = await runBilling(pool, cfg, pacificToday());
    console.log(`billing: ${r.created} charges created, ${r.charged} paid, ${r.failed} failed`);
    const held = await heldCharges(pool);
    if (held.length && cfg.mailer && process.env.OPS_EMAIL) {
      await cfg.mailer({
        to: process.env.OPS_EMAIL,
        subject: `Billing: ${held.length} charge${held.length === 1 ? "" : "s"} need a look`,
        text: `These charges stopped and won't retry on their own:\n\n${held.map((h) => `${h.id} (organisation ${h.orgId}): ${h.failure}`).join("\n")}\n\n`
          + `Check the card processor's dashboard before charging any of them again.\n`,
      });
    }
  } finally {
    await pool.end();
  }
};

// 16:00 UTC is 8 or 9 a.m. in California.
export const config: Config = { schedule: "0 16 * * *" };
