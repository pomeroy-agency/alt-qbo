import { getConnectionString } from "@netlify/database";
import type { Config, Context } from "@netlify/functions";
import pg from "pg";
import { handleApi } from "../../src/app/api.js";
import { mailerFromEnv } from "../../src/app/mail.js";
import { cdtfaRateLookup } from "../../src/app/cdtfa.js";
import { getStore } from "@netlify/blobs";
import { netlifyBackupStore } from "../../src/app/backup-store.js";
import type { FileStore } from "../../src/core/attachments.js";
import { backupKeyFromEnv } from "../../src/core/nightly-backups.js";
import { billingFromEnv } from "../../src/app/billing-config.js";
import { hubFromEnv } from "../../src/app/hub.js";
import { oauthClientsFromEnv } from "../../src/app/oauth.js";
import { newsletterFromEnv, startNewsletterJob } from "../../src/newsletter/config.js";
import { strictSsl } from "../../src/db/pool.js";
import { plaidFromEnv } from "../../src/app/plaid.js";
import { invoicePaymentsFromEnv } from "../../src/app/stripe-connect.js";

// One pool per function instance, reused across invocations.
const pool = new pg.Pool({ connectionString: strictSsl(getConnectionString()), max: 3 });

const mailer = mailerFromEnv();
// Links in emails and the card page's return address use the site's configured address
// (APP_URL, else Netlify's URL). A deploy preview or branch deploy uses the address it was
// opened at, so a test there never sends anyone back to the live app.
const appUrl = process.env.APP_URL || process.env.URL;
const appUrlFor = (req: Request, context: Context) =>
  context.deploy?.context === "production" || !context.deploy?.context ? appUrl : new URL(req.url).origin;

// California sales tax rates come from the CDTFA's public rate lookup.
const taxRates = cdtfaRateLookup();

// Nightly backups are encrypted with BACKUP_KEY; restore points can be downloaded once it's set.
const backupKey = backupKeyFromEnv();
const billing = billingFromEnv();
// The Pomeroy account hub: ACCOUNT_HUB_URL and ACCOUNT_HUB_SECRET (hub.ts).
const hub = hubFromEnv();

// MilePost connects with the OAuth client ID and secret set here (and in MilePost's own settings).
const oauthClients = oauthClientsFromEnv();
const milepost = { url: process.env.MILEPOST_URL || "https://crm.pomeroyagency.com" };

// TrailBook News: the Newsletter page, in the operator's own organisation only (NEWSLETTER_ORG_ID).
const newsletter = newsletterFromEnv(process.env, mailer, appUrl);
// The worker runs on this deploy's own address, so a preview's page starts the preview's worker.
const workerUrl = process.env.CONTEXT === "production" ? process.env.URL : process.env.DEPLOY_PRIME_URL || process.env.URL;

// Receipts and other attached files: their own Blobs store, apart from the database.
// The store is opened on first use, inside a request, where Blobs has its context.
const fileBlobs = () => getStore({ name: "attachments", consistency: "strong" });
const files: FileStore = {
  put: async (key, data) => { await fileBlobs().set(key, new Uint8Array(data).buffer as ArrayBuffer); },
  get: async (key) => {
    const b = await fileBlobs().get(key, { type: "arrayBuffer" });
    return b ? new Uint8Array(b) : null;
  },
  delete: async (key) => { await fileBlobs().delete(key); },
};

// Automatic bank feeds: PLAID_CLIENT_ID, PLAID_SECRET and PLAID_ENV. Off until they're set.
const plaid = plaidFromEnv();
// Card and bank payments on invoices: off until STRIPE_CONNECT_CLIENT_ID and INVOICE_PAYMENTS=on are set.
const invoicePayments = invoicePaymentsFromEnv();

export default async (req: Request, context: Context) => handleApi(req, pool, {
  files, plaid, invoicePayments,
  // Ad events (sign-up reports to Meta and Google) finish after the response, so they never slow a sign-up.
  defer: (work) => context.waitUntil(work),
  signupCode: process.env.SIGNUP_CODE, mailer, appUrl: appUrlFor(req, context), taxRates, billing, adEvents: billing.adEvents, oauthClients, milepost,
  hub, newsletter, startNewsletterJob: workerUrl ? (task) => startNewsletterJob(workerUrl, task) : undefined,
  backups: backupKey ? { store: netlifyBackupStore(getStore({ name: "backups", consistency: "strong" })), key: backupKey } : undefined,
});

export const config: Config = { path: ["/api/*", "/oauth/*"] };
