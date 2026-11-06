import { getConnectionString } from "@netlify/database";
import type { Config } from "@netlify/functions";
import pg from "pg";
import { sweepPayments } from "../../src/core/invoice-payments.js";
import { invoicePaymentsFromEnv } from "../../src/app/stripe-connect.js";
import { strictSsl } from "../../src/db/pool.js";

// Every hour: record invoice payments whose customer didn't come back from
// Stripe's page, and bank debits (ACH) that have cleared. Does nothing until
// online payments are switched on (STRIPE_CONNECT_CLIENT_ID, INVOICE_PAYMENTS=on).
export default async () => {
  const payments = invoicePaymentsFromEnv();
  if (!payments) { console.log("invoice payments skipped: not switched on"); return; }
  const pool = new pg.Pool({ connectionString: strictSsl(getConnectionString()), max: 2 });
  try {
    const r = await sweepPayments(pool, payments);
    console.log(`invoice payments: ${r.checked} checked, ${r.paid} recorded, ${r.failed} failed`);
  } finally {
    await pool.end();
  }
};

export const config: Config = { schedule: "17 * * * *" };
