// Background-work runtime role (ADR-008/049). Starts pg-boss, creates the
// approved queues, and registers handlers. Durable domain records
// (discovery_runs, source_collection_attempts) remain authoritative for
// user-facing status; queue state is delivery machinery only.
import http from "node:http";
import type { Job } from "pg-boss";
import { getBoss, startBossWithQueues } from "../work/boss.js";
import { runCollectionJob, type CollectionPayload } from "../discovery/collection.js";
import { runExtraction } from "../profile/extraction.js";
import { buildObjectStore } from "../storage/objectStore.js";
import { HttpAiClient } from "../profile/aiClient.js";
import { getPool, pingDatabase } from "../db.js";

const pool = getPool();
const store = buildObjectStore();
const ai = new HttpAiClient(process.env.AI_INTERNAL_URL ?? "http://ai:8000");
let dbOk = false;

const health = http.createServer((_req, res) => {
  res.writeHead(dbOk ? 200 : 503, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: dbOk ? "ok" : "degraded" }));
});
health.listen(Number(process.env.WORKER_HEALTH_PORT ?? 8081), "0.0.0.0");

// Bounded retry policy per ADR-044 lives at enqueue time
// (src/work/boss.ts → ENQUEUE_POLICY); handlers only rethrow transient
// failures so those policies actually engage.
async function main(): Promise<void> {
  try {
    dbOk = await pingDatabase();
  } catch {
    dbOk = false;
  }

  const boss = getBoss();
  await startBossWithQueues(boss);

  await boss.work<CollectionPayload>(
    "collection",
    async (jobs: Job<CollectionPayload>[]) => {
      const results = [];
      for (const job of jobs) {
        const result = await runCollectionJob({ db: pool }, job.data);
        if (result.outcome === "failed_transient") {
          // Unknown/transient failure: rethrow for bounded pg-boss retry.
          throw new Error("transient_collection_failure");
        }
        results.push(result);
      }
      return results;
    }
  );

  // Extraction jobs carry a resume document id (T3.2 work unit).
  await boss.work<{ resumeDocumentId: string }>(
    "extraction",
    async (jobs: Job<{ resumeDocumentId: string }>[]) => {
      const results = [];
      for (const job of jobs) {
        const result = await runExtraction(pool, store, ai, job.data.resumeDocumentId, new Date());
        if (!result.ok && result.reason === "ai_unavailable") {
          throw new Error("transient_ai_unavailable"); // bounded retry
        }
        results.push(result);
      }
      return results;
    }
  );

  console.log(JSON.stringify({ event: "worker_ready", db_reachable: dbOk }));
}

main().catch((err) => {
  console.log(JSON.stringify({
    event: "worker_boot_failure",
    error: err instanceof Error ? err.message : String(err)
  }));
  process.exit(1);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => process.exit(0));
}
