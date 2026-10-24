import { getConnectionString } from "@netlify/database";
import type { Config } from "@netlify/functions";
import pg from "pg";
import { handleApi } from "../../src/app/api.js";
import "../../src/db/pool.js";

// One pool per function instance, reused across invocations.
const pool = new pg.Pool({ connectionString: getConnectionString(), max: 3 });

export default async (req: Request) => handleApi(req, pool, { signupCode: process.env.SIGNUP_CODE });

export const config: Config = { path: "/api/*" };
