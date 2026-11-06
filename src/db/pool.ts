import pg from "pg";

// Postgres returns bigint (int8) as a string by default; parse it as BigInt
// so money in minor units never passes through a float.
pg.types.setTypeParser(20, (v) => BigInt(v));
// Keep DATE columns as 'YYYY-MM-DD' strings rather than local-time Dates.
pg.types.setTypeParser(1082, (v) => v);

export type Tx = pg.PoolClient;

/**
 * pg already treats sslmode=require (and prefer, verify-ca) as verify-full, but
 * warns about it on every new instance, which lands in the error log. Saying
 * verify-full outright keeps the same checks and drops the warning.
 */
export function strictSsl(connectionString: string): string {
  if (/[?&]uselibpqcompat=/i.test(connectionString)) return connectionString;
  return connectionString.replace(/([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/i, "$1verify-full");
}

export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new pg.Pool({ connectionString: strictSsl(connectionString) });
}

/** Runs fn in a transaction as the system owner (no tenant boundary). */
export async function withSystem<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs fn in a transaction scoped to one organisation. The session drops to
 * the altqbo_app role, so row-level security hides every other tenant's rows.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  orgId: string,
  fn: (tx: Tx) => Promise<T>,
  opts: { allowSoftClosed?: boolean } = {},
): Promise<T> {
  return withSystem(pool, async (tx) => {
    await tx.query("SET LOCAL ROLE altqbo_app");
    await tx.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    if (opts.allowSoftClosed) await tx.query("SELECT set_config('app.allow_soft_closed', 'on', true)");
    return fn(tx);
  });
}
