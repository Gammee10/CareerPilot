// Source-collection work unit (T5.1/T5.5/T5.6): one job = one source within
// one discovery run. Idempotent identity: collection:{runId}:{sourceSlug}.
import type { Pool } from "pg";
import { PoliteClient, NonTransientError, AttemptsExhaustedError, type Transport } from "../sources/politeClient.js";
import { buildAdapter } from "../sources/registry.js";
import { checkCollectionAllowed } from "../sources/registry.js";
import type { SourceSlug } from "../sources/contract.js";
import { persistObservation, refreshAvailability } from "../sources/pipeline.js";
import { completeRunFromAttempts } from "./orchestrator.js";


export type CollectionPayload = {
  runId: string;
  sourceSlug: SourceSlug;
  config: Record<string, string>;
};

export type CollectionDeps = {
  db: Pool;
  /** Injectable transport for deterministic tests; real fetch when omitted. */
  transport?: Transport;
  now?: () => Date;
};

type AttemptStatus =
  | "in_progress"
  | "succeeded"
  | "failed_transient"
  | "failed_non_transient"
  | "rate_limited"
  | "deferred";

type AttemptOutcome = Exclude<AttemptStatus, "in_progress">;

function defaultTransport(): Transport {
  return async (url) => {
    const res = await fetch(url, {
      headers: { "user-agent": "CareerPilotBeta/0.1 (+public job boards API)" },
      signal: AbortSignal.timeout(10_000)
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return { status: res.status, headers, body: await res.text() };
  };
}

/**
 * Executes one source-collection attempt within a discovery run.
 * - Verifies the run is still running and the account active (ADR-045).
 * - Idempotent: re-delivery of the same logical job yields at most one
 *   persisted outcome (T5.1 AC).
 * - Transient failures rethrow so pg-boss retries within its bounded budget;
 *   non-transient/rate-limit outcomes are terminal for the job (ADR-044).
 */
export async function runCollectionJob(
  deps: CollectionDeps,
  payload: CollectionPayload
): Promise<{ outcome: AttemptOutcome; observationCount: number }> {
  const db = deps.db;
  const now = deps.now ?? (() => new Date());

  // Supersession / account guard (ADR-045).
  const run = await db.query<{ status: string; account_id: string }>(
    "SELECT status, account_id FROM discovery_runs WHERE id = $1",
    [payload.runId]
  );
  if (run.rows.length === 0 || run.rows[0].status !== "running") {
    return { outcome: "deferred", observationCount: 0 };
  }
  const acct = await db.query<{ state: string }>(
    "SELECT state FROM accounts WHERE id = $1",
    [run.rows[0].account_id]
  );
  if (acct.rows[0]?.state !== "active") {
    return { outcome: "deferred", observationCount: 0 };
  }

  // Independent enable/disable + terms gate (ADR-059).
  const gate = await checkCollectionAllowed(db, payload.sourceSlug);
  if (!gate.allowed) {
    await markAttempt(db, payload.runId, payload.sourceSlug, 1, "failed_non_transient", null, now());
    return { outcome: "failed_non_transient", observationCount: 0 };
  }

  // Idempotency identity (T5.1 AC): same logical work -> one outcome.
  const idempotencyKey = `collection:${payload.runId}:${payload.sourceSlug}`;
  const existing = await db.query<{ outcome: AttemptOutcome }>(
    "SELECT (outcome->>'outcome') AS outcome FROM idempotency_records WHERE idempotency_key = $1",
    [idempotencyKey]
  );
  if (existing.rows.length > 0) {
    return { outcome: existing.rows[0].outcome as AttemptOutcome, observationCount: -1 };
  }

  const priorAttempts = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM source_collection_attempts
      WHERE discovery_run_id = $1 AND job_source_slug = $2`,
    [payload.runId, payload.sourceSlug]
  );
  const attemptNumber = Number(priorAttempts.rows[0].n) + 1;
  if (attemptNumber > 3) {
    // ADR-044 budget exhausted at job level.
    await markAttempt(db, payload.runId, payload.sourceSlug, 3, "deferred", null, now());
    return { outcome: "deferred", observationCount: 0 };
  }

  await markAttempt(
    db, payload.runId, payload.sourceSlug, attemptNumber,
    "in_progress",
    { pageBudget: 5, timeoutMs: 10_000 },
    now()
  );

  const transport = deps.transport ?? defaultTransport();
  const client = new PoliteClient(
    transport,
    async () => undefined, // real sleeping is delegated to pg-boss retry delays
    () => now().getTime(),
    { minIntervalMs: 1000, maxAttempts: 3 }
  );

  try {
    const adapter = buildAdapter(payload.sourceSlug, payload.config);
    const collected = await adapter.collect({
      client,
      pageBudget: 5,
      fetchedAt: now().toISOString()
    });

    let observationCount = 0;
    const canonicalJobs = new Set<string>();
    for (const obs of collected.observations) {
      const persisted = await persistObservation(db, obs, payload.runId, now());
      if (!persisted.ok) continue;
      if (persisted.classification !== "duplicate") observationCount += 1;
      canonicalJobs.add(persisted.canonicalJobId);
    }
    for (const jobId of canonicalJobs) {
      await refreshAvailability(db, jobId, now());
    }

    await finishAttempt(db, payload.runId, payload.sourceSlug, "succeeded", null, observationCount);
    await rememberOutcome(db, idempotencyKey, "succeeded");
    void maybeCompleteRun(db, payload.runId, now());
    return { outcome: "succeeded", observationCount };
  } catch (err) {
    if (err instanceof NonTransientError) {
      // Authorization/policy/invalid-request: never retried automatically.
      await finishAttempt(db, payload.runId, payload.sourceSlug, "failed_non_transient", `http_${err.status}`, 0);
      await rememberOutcome(db, idempotencyKey, "failed_non_transient");
      void maybeCompleteRun(db, payload.runId, now());
      return { outcome: "failed_non_transient", observationCount: 0 };
    }
    if (err instanceof AttemptsExhaustedError) {
      const rateLimited = err.lastStatus === 429 || err.lastStatus === 503;
      const outcome: AttemptOutcome = rateLimited ? "rate_limited" : "failed_transient";
      await finishAttempt(
        db, payload.runId, payload.sourceSlug, outcome,
        err.lastStatus ? `http_${err.lastStatus}` : null, 0
      );
      await rememberOutcome(db, idempotencyKey, outcome);
      void maybeCompleteRun(db, payload.runId, now());
      return { outcome, observationCount: 0 };
    }
    // Unknown/transient failure: record and RETHROW so pg-boss retries within
    // its bounded per-job budget (set at send time honoring source policy).
    await finishAttempt(db, payload.runId, payload.sourceSlug, "failed_transient", "unknown_error", 0);
    throw err;
  }
}

async function maybeCompleteRun(db: Pool, runId: string, now: Date): Promise<void> {
  const pendingJobs = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pgboss.job
      WHERE name = 'collection'
        AND (payload->>'runId') = $1
        AND state IN ('created','active','retry')`,
    [runId]
  );
  // 1 because this job itself is still marked active during handling.
  if (Number(pendingJobs.rows[0].n) <= 1) {
    await completeRunFromAttempts(db, runId, now);
  }
}

async function markAttempt(
  db: Pool, runId: string, slug: string, attemptNumber: number,
  status: AttemptStatus, limits: Record<string, unknown> | null, now: Date
): Promise<void> {
  await db.query(
    `INSERT INTO source_collection_attempts
       (discovery_run_id, job_source_slug, attempt_number, page_budget, timeout_ms, status, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      runId, slug, attemptNumber,
      Number(limits?.pageBudget ?? 5), Number(limits?.timeoutMs ?? 10_000),
      status, now
    ]
  );
}

async function finishAttempt(
  db: Pool, runId: string, slug: string, status: AttemptOutcome,
  errorCode: string | null, observationCount: number
): Promise<void> {
  await db.query(
    `UPDATE source_collection_attempts
        SET status = $3, error_code = $4, observation_count = $5, finished_at = now()
      WHERE id = (
        SELECT id FROM source_collection_attempts
         WHERE discovery_run_id = $1 AND job_source_slug = $2
         ORDER BY started_at DESC LIMIT 1
      )`,
    [runId, slug, status, errorCode, observationCount]
  );
}

async function rememberOutcome(
  db: Pool, idempotencyKey: string, outcome: AttemptOutcome
): Promise<void> {
  await db.query(
    `INSERT INTO idempotency_records (idempotency_key, work_type, outcome)
     VALUES ($1, 'source_collection', $2)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [idempotencyKey, JSON.stringify({ outcome })]
  );
}

