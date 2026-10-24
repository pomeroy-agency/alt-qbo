import pg from "pg";
import { migrate } from "../src/db/migrate.js";

// Creates a fresh test database and migrates it. Point TEST_DATABASE_ADMIN_URL
// at any database on a server where the user can create databases.
export default async function setup() {
  const admin = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://postgres@localhost:5432/postgres";
  const url = new URL(admin);
  const dbName = `altqbo_test_${process.pid}`;
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await client.query(`CREATE DATABASE ${dbName}`);
  await client.end();

  url.pathname = `/${dbName}`;
  process.env.DATABASE_URL = url.toString();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool);
  await pool.end();

  return async () => {
    const c = new pg.Client({ connectionString: admin });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await c.end();
  };
}
