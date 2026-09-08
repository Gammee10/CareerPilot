// Durable background-work mechanism (ADR-049): pg-boss backed by the
// approved PostgreSQL system of record. Queue delivery never replaces
// authoritative domain records — Discovery Run and source-attempt rows
// remain the source of truth for status (T5.1).
import Boss from "pg-boss";
import { readSecretFile } from "../config.js";

export const QUEUES = [
  "extraction",
  "collection",
  "normalization",
  "canonicalization",
  "analysis",
  "evaluation",
  "availability"
] as const;

export type QueueName = (typeof QUEUES)[number];

let boss: Boss | undefined;

export function getBoss(): Boss {
  if (!boss) {
    const passwordFile = process.env.PGPASSWORD_FILE ?? "/run/secrets/postgres_password";
    // L4: shared reader — a missing file fails boot with an operational
    // message, never a raw ENOENT stack.
    const password = readSecretFile(passwordFile, "postgres_password");
    boss = new Boss({
      host: process.env.PGHOST ?? "postgres",
      port: Number(process.env.PGPORT ?? 5432),
      database: process.env.PGDATABASE ?? "careerpilot",
      user: process.env.PGUSER ?? "careerpilot",
      password,
      schema: process.env.PGBOSS_SCHEMA ?? "pgboss",
      // Bounded retry policy lives per-job at send time (ADR-044);
      // library defaults are not trusted for domain policy.
      max: 10
    });
  }
  return boss;
}

export async function startBossWithQueues(b: Boss): Promise<void> {
  await b.start();
  for (const q of QUEUES) {
    await b.createQueue(q);
  }
}

/**
 * Bounded, transient-only retry policy applied at ENQUEUE time (ADR-044).
 * Handlers rethrow only clearly-transient failures; non-transient and
 * rate-limited outcomes resolve the job without retry. Every registered
 * queue has an entry — future queues must add theirs here, never rely on
 * library defaults for domain policy.
 */
export const ENQUEUE_POLICY: Record<QueueName, { retryLimit: number; retryDelay: number }> = {
  extraction: { retryLimit: 2, retryDelay: 60 },
  collection: { retryLimit: 2, retryDelay: 60 },
  normalization: { retryLimit: 2, retryDelay: 60 },
  canonicalization: { retryLimit: 2, retryDelay: 60 },
  analysis: { retryLimit: 2, retryDelay: 60 },
  evaluation: { retryLimit: 2, retryDelay: 60 },
  availability: { retryLimit: 2, retryDelay: 60 }
};
