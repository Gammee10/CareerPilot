import fs from "node:fs";

const SECRETS_DIR = "/run/secrets";

export const config = {
  port: Number(process.env.PORT ?? 8080),
  workerHealthPort: Number(process.env.WORKER_HEALTH_PORT ?? 8081),
  logLevel: process.env.LOG_LEVEL ?? "info",
  pg: {
    host: process.env.PGHOST ?? "postgres",
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "careerpilot",
    user: process.env.PGUSER ?? "careerpilot",
    passwordSecretName: "postgres_password"
  },
  migrationsDir:
    process.env.MIGRATIONS_DIR ?? new URL("../../../db/migrations", import.meta.url).pathname
};

// Reads a file-mounted Compose secret (ADR-056). Secret values are never
// logged and never sourced from environment variables.
export function readSecret(name: string): string {
  return fs.readFileSync(`${SECRETS_DIR}/${name}`, "utf8").trim();
}
