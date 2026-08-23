import fs from "node:fs";

const SECRETS_DIR = "/run/secrets";

export const config = {
  port: Number(process.env.PORT ?? 8080),
  workerHealthPort: Number(process.env.WORKER_HEALTH_PORT ?? 8081),
  logLevel: process.env.LOG_LEVEL ?? "info",
  nodeEnv: process.env.NODE_ENV ?? "production",
  pg: {
    host: process.env.PGHOST ?? "postgres",
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "careerpilot",
    user: process.env.PGUSER ?? "careerpilot",
    passwordSecretName: "postgres_password"
  },
  migrationsDir:
    process.env.MIGRATIONS_DIR ?? new URL("../../../db/migrations", import.meta.url).pathname,
  // ADR-026/027 accepted policy values. Tests may override via env, never in production.
  identity: {
    signinLinkTtlMinutes: Number(process.env.SIGNIN_LINK_TTL_MINUTES ?? 15),
    invitationTtlDays: 14,
    signinLinkMaxPer15Min: 3,
    signinLinkMaxPer24H: 10,
    userSessionAbsoluteDays: 30,
    userSessionIdleDays: 7,
    adminSessionAbsoluteHours: 12,
    adminSessionIdleHours: 1
  },
  sessionCookieName: "cp_session",
  publicUrl: process.env.APP_PUBLIC_URL ?? "http://localhost:8080"
};

// Reads a file-mounted Compose secret (ADR-056). Secret values are never
// logged and never sourced from environment variables.
export function readSecret(name: string): string {
  return fs.readFileSync(`${SECRETS_DIR}/${name}`, "utf8").trim();
}
