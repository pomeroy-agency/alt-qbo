import { getConnectionString } from "@netlify/database";
import type { Config } from "@netlify/functions";
import pg from "pg";
import { mailerFromEnv } from "../../src/app/mail.js";
import { pacificToday } from "../../src/payroll/business-days.js";
import { sendDepositReminders } from "../../src/payroll/deposit-reminders.js";
import { sendSalesTaxReminders } from "../../src/core/sales-tax-reminders.js";
import "../../src/db/pool.js";

// Every morning: email reminders of payroll tax deposits coming due or missed,
// and of the business's own sales tax returns and prepayments coming due.
const appUrl = process.env.APP_URL || process.env.URL;

export default async () => {
  const pool = new pg.Pool({ connectionString: getConnectionString(), max: 2 });
  try {
    const result = await sendDepositReminders(pool, mailerFromEnv(), pacificToday(), appUrl);
    console.log(`deposit reminders: ${result.sent} sent, ${result.failed} failed`);
    const sales = await sendSalesTaxReminders(pool, mailerFromEnv(), pacificToday(), appUrl);
    console.log(`sales tax reminders: ${sales.sent} sent, ${sales.failed} failed`);
  } finally {
    await pool.end();
  }
};

// 15:00 UTC is 7 or 8 a.m. in California.
export const config: Config = { schedule: "0 15 * * *" };
