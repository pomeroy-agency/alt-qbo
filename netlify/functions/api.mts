import { getConnectionString } from "@netlify/database";
import type { Config } from "@netlify/functions";
import pg from "pg";
import { handleApi } from "../../src/app/api.js";
import { mailerFromEnv } from "../../src/app/mail.js";
import "../../src/db/pool.js";

// One pool per function instance, reused across invocations.
const pool = new pg.Pool({ connectionString: getConnectionString(), max: 3 });

const mailer = mailerFromEnv();
// Links in emails use the site's configured address: APP_URL if set, else Netlify's own URL for this deploy.
const appUrl = process.env.APP_URL || (process.env.CONTEXT === "production" ? process.env.URL : process.env.DEPLOY_PRIME_URL || process.env.URL);

export default async (req: Request) => handleApi(req, pool, { signupCode: process.env.SIGNUP_CODE, mailer, appUrl });

export const config: Config = { path: "/api/*" };
