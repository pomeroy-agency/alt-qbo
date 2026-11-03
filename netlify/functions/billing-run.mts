import { getConnectionString } from "@netlify/database";
import type { Config } from "@netlify/functions";
import pg from "pg";
import { billingFromEnv } from "../../src/app/billing-config.js";
import { cdtfaRateLookup } from "../../src/app/cdtfa.js";
import { mailerFromEnv } from "../../src/app/mail.js";
import { heldCharges, runBilling, unbookedCharges } from "../../src/billing/billing.js";
import { accrueReferralFees, owedSummary } from "../../src/billing/referrals.js";
import { hubFromEnv, pushChanged } from "../../src/app/hub.js";
import { pacificToday } from "../../src/payroll/business-days.js";
import { strictSsl } from "../../src/db/pool.js";

// Every morning: renew subscriptions that are due, bill people paid on yearly
// payroll plans, and retry failed payments. Charges needing a person are
// emailed to OPS_EMAIL. Then, when ACCOUNT_HUB_URL and ACCOUNT_HUB_SECRET are
// set, tell the Pomeroy account hub about every organisation whose status
// changed, including trials and grace periods that ran out overnight.
// Referral fees earned by firms are recorded from the charges paid, and on
// the 1st of each month OPS_EMAIL gets the list of firms to pay.
const appUrl = process.env.APP_URL || process.env.URL;

export default async () => {
  const cfg = { ...billingFromEnv(), mailer: mailerFromEnv(), taxRates: cdtfaRateLookup(), appUrl };
  const hub = hubFromEnv();
  if ((!cfg.gateway || !cfg.seller) && !hub) {
    console.log("billing skipped: STRIPE_SECRET_KEY, BILLING_SELLER_ORG_ID and BILLING_SELLER_ENTITY_ID are needed");
    return;
  }
  const pool = new pg.Pool({ connectionString: strictSsl(getConnectionString()), max: 2 });
  try {
    const today = pacificToday();
    if (cfg.gateway && cfg.seller) {
      const r = await runBilling(pool, cfg, today);
      console.log(`billing: ${r.created} charges created, ${r.charged} paid, ${r.failed} failed`);
      const fees = await accrueReferralFees(pool);
      if (fees) console.log(`referrals: ${fees} fees recorded`);
      if (today.endsWith("-01") && cfg.mailer && process.env.OPS_EMAIL) {
        const owed = await owedSummary(pool);
        if (owed) {
          await cfg.mailer({
            to: process.env.OPS_EMAIL,
            subject: "Referral fees to pay this month",
            text: `These firms are owed TrailBook referral fees:\n\n${owed}\n\nPay each one outside TrailBook, then record it on the Referral fees page${appUrl ? ` (${appUrl}/#/referral-fees)` : ""}.\n`,
          }).catch((err) => console.error("referral summary email failed", err));
        }
      }
      const held = await heldCharges(pool);
      if (held.length && cfg.mailer && process.env.OPS_EMAIL) {
        await cfg.mailer({
          to: process.env.OPS_EMAIL,
          subject: `Billing: ${held.length} charge${held.length === 1 ? "" : "s"} need a look`,
          text: `These charges stopped and won't retry on their own:\n\n${held.map((h) => `${h.id} (organisation ${h.orgId}): ${h.failure}`).join("\n")}\n\n`
            + `Check the card processor's dashboard before charging any of them again.\n`,
        });
      }
      // Canadian-dollar charges that were paid but couldn't be put in the seller's books. These retry each morning.
      const unbooked = await unbookedCharges(pool);
      if (unbooked.length && cfg.mailer && process.env.OPS_EMAIL) {
        await cfg.mailer({
          to: process.env.OPS_EMAIL,
          subject: `Billing: ${unbooked.length} Canadian payment${unbooked.length === 1 ? "" : "s"} not in the books yet`,
          text: `These Canadian-dollar charges were paid, but the seller's books don't have them yet. TrailBook tries again every morning:\n\n`
            + `${unbooked.map((h) => `${h.id} (organisation ${h.orgId}): ${h.failure}`).join("\n")}\n\n`
            + `If the reason is a permission error, give the Stripe key read access to Charges and Balance.\n`,
        });
      }
    } else {
      console.log("billing skipped: STRIPE_SECRET_KEY, BILLING_SELLER_ORG_ID and BILLING_SELLER_ENTITY_ID are needed");
    }
    if (hub) {
      const p = await pushChanged(pool, hub, cfg, today);
      console.log(`account hub: ${p.sent} sent, ${p.unchanged} unchanged, ${p.failed} failed`);
    }
  } finally {
    await pool.end();
  }
};

// 16:00 UTC is 8 or 9 a.m. in California.
export const config: Config = { schedule: "0 16 * * *" };
