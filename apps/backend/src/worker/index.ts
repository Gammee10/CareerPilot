// Background-work runtime role (ADR-008/049). Starts pg-boss, creates the
// approved queues, and registers handlers. Durable domain records
// (discovery_runs, source_collection_attempts) remain authoritative for
// user-facing status; queue state is delivery machinery only.
import http from "node:http";
import type { Job } from "pg-boss";
import type Boss from "pg-boss";
import { getBoss, startBossWithQueues } from "../work/boss.js";
import { runCollectionJob, type CollectionPayload } from "../discovery/collection.js";
import { runExtraction } from "../profile/extraction.js";
import { buildObjectStore } from "../storage/objectStore.js";
import { HttpAiClient } from "../profile/aiClient.js";
import { withCorrelation, logEvent } from "../observability/logger.js";
import { getPool, pingDatabase } from "../db.js";

const pool = getPool();
const store = buildObjectStore();
const ai = new HttpAiClient(process.env.AI_INTERNAL_URL ?? "http://ai:8000");

let boss: Boss | undefined;

// M9: readiness reflects LIVE datastore reachability, not a boot-time
// sample. Each probe pings (Docker healthchecks hit every 10s — one cheap
// SELECT each); failures fail closed as degraded without crashing the worker.
const health = http.createServer((_req, res) => {
  void (async () => {
    let ok = false;
    try {
      ok = await pingDatabase();
    } catch {
      ok = false;
    }
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: ok ? "ok" : "degraded" }));
  })();
});
health.listen(Number(process.env.WORKER_HEALTH_PORT ?? 8081), "0.0.0.0");

// Bounded retry policy per ADR-044 lives at enqueue time
// (src/work/boss.ts → ENQUEUE_POLICY); handlers only rethrow transient
// failures so those policies actually engage.
async function main(): Promise<void> {
  boss = getBoss();
  await startBossWithQueues(boss);

  await boss.work<CollectionPayload>(
    "collection",
    async (jobs: Job<CollectionPayload>[]) => {
      // M9: each job runs inside a correlation scope so worker logs carry
      // correlation IDs. Payload-carried producer IDs arrive with a future
      // enqueue path; until then every job mints its own scope here.
      return withCorrelation(async () => {
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
      });
    }
  );

  // Extraction jobs carry a resume document id (T3.2 work unit).
  await boss.work<{ resumeDocumentId: string; accountId: string }>(
    "extraction",
    async (jobs: Job<{ resumeDocumentId: string; accountId: string }>[]) => {
      return withCorrelation(async () => {
        const results = [];
        for (const job of jobs) {
          const result = await runExtraction(pool, store, ai, job.data.accountId, job.data.resumeDocumentId, new Date());
          if (!result.ok && result.reason === "ai_unavailable") {
            throw new Error("transient_ai_unavailable"); // bounded retry
          }
          results.push(result);
        }
        return results;
      });
    }
  );

  logEvent("info", "worker_ready", {});
}

main().catch((err) => {
  logEvent("error", "worker_boot_failure", {
    error: err instanceof Error ? err.message : String(err)
  });
  process.exit(1);
});

// M9: graceful shutdown — drain in-flight pg-boss jobs instead of abandoning
// them with process.exit(0). A 25s cap keeps Docker's SIGKILL (default 10s
// after SIGTERM... composed services use stop_grace_period) from hard-killing
// mid-drain; remaining jobs are safely re-delivered via pg-boss visibility.
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      process.exit(1);
      return;
    }
    shuttingDown = true;
    void (async () => {
      const timeout = setTimeout(() => process.exit(1), 25_000);
      try {
        await new Promise<void>((resolve) => health.close(() => resolve()));
        if (boss) await boss.stop();
        await pool.end();
        clearTimeout(timeout);
        process.exit(0);
      } catch {
        clearTimeout(timeout);
        process.exit(1);
      }
    })();
  });
}
