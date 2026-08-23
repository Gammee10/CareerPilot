import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

export const TEST_DB = "careerpilot_test";

function password(): string {
  // CI service containers provide a throwaway password via env; local runs
  // read the file-mounted dev secret. Production never uses this path.
  if (process.env.CI_TEST_PASSWORD) return process.env.CI_TEST_PASSWORD;
  const file =
    process.env.PGPASSWORD_FILE ??
    path.resolve(import.meta.dirname, "../../../secrets/local/postgres_password.txt");
  return fs.readFileSync(file, "utf8").trim();
}

export function testDbConfig() {
  return {
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5433),
    user: process.env.PGUSER ?? "careerpilot",
    password: password()
  };
}

export default async function globalSetup(): Promise<void> {
  const base = new Pool({ ...testDbConfig(), database: "postgres" });
  try {
    await base.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await base.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await base.end();
  }

  const target = new Pool({ ...testDbConfig(), database: TEST_DB });
  try {
    const migrationsDir = process.env.MIGRATIONS_DIR
      ? path.resolve(process.env.MIGRATIONS_DIR)
      : path.resolve(import.meta.dirname, "../../../db/migrations");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await target.query(sql);
    }
  } finally {
    await target.end();
  }
}
