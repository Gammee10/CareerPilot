import { Pool } from "pg";
import { config, readSecret } from "./config.js";

let pool: Pool | undefined;

// The database password is only ever read from the file-mounted Compose
// secret (ADR-056); it never appears in env vars or logs.
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.pg.host,
      port: config.pg.port,
      database: config.pg.database,
      user: config.pg.user,
      password: readSecret(config.pg.passwordSecretName),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  }
  return pool;
}

export async function pingDatabase(): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("SELECT 1");
    return true;
  } finally {
    client.release();
  }
}
