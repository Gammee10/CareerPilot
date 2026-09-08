// Minimal SQL migration runner (implementation freedom per AGENTS.md).
// Applies db/migrations/*.sql in lexicographic order, each in its own
// transaction, recorded in schema_migrations. Password comes exclusively
// from the file-mounted Compose secret (ADR-056).

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { getPool } from "../db.js";

async function main(): Promise<void> {
  const dir = path.resolve(config.migrationsDir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const pool = getPool();

  // L5: single-flight migrator. Concurrent backend/worker boot must not
  // double-apply migrations — hold a session-level advisory lock for the
  // whole run on one dedicated connection. The lock is taken BEFORE the
  // schema_migrations CREATE TABLE: even CREATE TABLE IF NOT EXISTS can
  // race (duplicate pg_type key) when two sessions boot simultaneously.
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('careerpilot-migrator'))");
    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           name text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`
      );
      const { rows } = await client.query<{ name: string }>(
        "SELECT name FROM schema_migrations"
      );
      const applied = new Set(rows.map((r) => r.name));

      for (const file of files) {
        if (applied.has(file)) continue;
        const sql = fs.readFileSync(path.join(dir, file), "utf8");
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
          await client.query("COMMIT");
          console.log(JSON.stringify({ event: "migration_applied", migration: file }));
        } catch (err) {
          await client.query("ROLLBACK").catch(() => undefined);
          console.log(JSON.stringify({
            event: "migration_failed",
            migration: file,
            // Error message only; never the SQL text or connection data (ADR-015).
            error: err instanceof Error ? err.message : String(err)
          }));
          process.exitCode = 1;
          return;
        }
      }
      console.log(JSON.stringify({ event: "migrations_up_to_date", total: files.length }));
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('careerpilot-migrator'))");
    }
  } finally {
    client.release();
  }
  await pool.end();
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.log(JSON.stringify({
      event: "migrations_boot_failure",
      error: err instanceof Error ? err.message : String(err)
    }));
    process.exit(1);
  }
);
