// Bounded re-evaluation after material profile change (T6.5, ADR-041/FR-24).
// Only the user's ACTIVE, non-dismissed, in-scope jobs with existing
// evaluations are re-evaluated; historical/unavailable/out-of-scope/dismissed
// jobs are untouched. Delivery is asynchronous via pg-boss (H16): the HTTP
// path only enqueues; the worker runs bounded batches.
import type { Pool } from "pg";
import type { AiClient } from "../profile/aiClient.js";
import { ENQUEUE_POLICY } from "../work/boss.js";
import { evaluateJobForUser } from "./engine.js";

export type ReevaluationScope = {
  sources: string[];       // enabled/allowed source slugs (empty = all)
  companies: string[];     // targeted employers (empty = all)
};

/** H16: per-batch bound so one profile change can never fan out to N AI
 * calls inside a single request or job. Additional pages re-enqueue. */
export const REEVALUATION_BATCH_LIMIT = 50;

export async function selectJobsForReevaluation(
  db: Pool,
  accountId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<string[]> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? REEVALUATION_BATCH_LIMIT), 1), 200);
  const offset = Math.max(Math.floor(opts.offset ?? 0), 0);
  // Scope from the user's search strategy; empty targeting = whole scope.
  const strategy = await db.query<{ source_targeting: Record<string, unknown> }>(
    "SELECT source_targeting FROM search_strategy WHERE account_id = $1",
    [accountId]
  );
  const targeting = strategy.rows[0]?.source_targeting ?? {};
  const allowedSources = Array.isArray(targeting["sources"])
    ? (targeting["sources"] as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const companies = Array.isArray(targeting["companies"])
    ? (targeting["companies"] as unknown[])
        .filter((c): c is string => typeof c === "string" && c.length > 0)
        .map((c) => c.toLowerCase())
    : [];

  // Company match stays in Node (substring includes on the primary-listing
  // company); the SQL already narrowed to the primary listing per job.
  const rows = await db.query<{ canonical_job_id: string; company: string | null }>(
    `SELECT DISTINCT ON (e.canonical_job_id) e.canonical_job_id,
            -- H16: company comes from the PRIMARY listing (latest
            -- observation holder, same rule as the H7 current-view
            -- selector), not the lexicographic MIN strong key.
            SPLIT_PART(l.strong_match_key, '|', 1) AS company
       FROM evaluations e
       JOIN source_listings l ON l.canonical_job_id = e.canonical_job_id
      WHERE e.account_id = $1
        -- job currently believed ACTIVE (ADR-041: unavailable never re-evaluated)
        AND (
          SELECT a.state FROM availability_history a
           WHERE a.canonical_job_id = e.canonical_job_id
           ORDER BY a.recorded_at DESC, id DESC LIMIT 1
        ) = 'active'
        -- not dismissed by the user (FR-24: active, non-dismissed jobs)
        AND NOT EXISTS (
          SELECT 1 FROM user_job_reviews r
           WHERE r.account_id = e.account_id
             AND r.canonical_job_id = e.canonical_job_id
             AND r.state = 'not_interested'
        )
        -- H16: ADR-041 source scoping enforced — a job qualifies only via a
        -- listing from an allowed source (empty allowlist = all sources).
        AND (
          $4::text[] IS NULL
          OR EXISTS (
            SELECT 1 FROM source_listings sl2
             WHERE sl2.canonical_job_id = e.canonical_job_id
               AND sl2.job_source_slug = ANY($4::text[])
          )
        )
      ORDER BY e.canonical_job_id, l.latest_observation_at DESC NULLS LAST, l.id DESC
      LIMIT $2 OFFSET $3`,
    [
      accountId,
      limit,
      offset,
      allowedSources.length > 0 ? allowedSources : null
    ]
  );

  const inScope = rows.rows.filter((row) => {
    if (companies.length === 0) return true;
    if (row.company === null) return false;
    const company = row.company.toLowerCase();
    return companies.some((c) => company.includes(c));
  });
  return inScope.map((r) => r.canonical_job_id);
}

/** Runs ONE bounded batch; reports whether more pages remain. */
export async function runReevaluationForProfileChange(
  db: Pool,
  ai: AiClient | undefined,
  accountId: string,
  now: Date,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ evaluated: number; truncated: boolean }> {
  const limit = opts.limit ?? REEVALUATION_BATCH_LIMIT;
  // Fetch one extra row to detect truncation without a COUNT query.
  const jobIds = await selectJobsForReevaluation(db, accountId, {
    limit: limit + 1,
    offset: opts.offset ?? 0
  });
  const truncated = jobIds.length > limit;
  for (const jobId of jobIds.slice(0, limit)) {
    await evaluateJobForUser(db, accountId, jobId, now, ai);
  }
  return { evaluated: Math.min(jobIds.length, limit), truncated };
}

export type ReevaluationJobData = {
  accountId: string;
  offset?: number;
};

/**
 * Enqueues async re-evaluation after a material profile change (H16). The
 * HTTP path never evaluates inline: one profile change with N jobs must not
 * become N AI calls inside a single request. Fire-and-forget — enqueue
 * failures are logged and never fail the save itself.
 */
export async function enqueueReevaluation(
  send: (
    queue: "evaluation",
    data: ReevaluationJobData,
    opts: { retryLimit: number; retryDelay: number }
  ) => Promise<unknown>,
  accountId: string
): Promise<boolean> {
  try {
    await send("evaluation", { accountId }, {
      retryLimit: ENQUEUE_POLICY.evaluation.retryLimit,
      retryDelay: ENQUEUE_POLICY.evaluation.retryDelay
    });
    return true;
  } catch (err) {
    console.log(JSON.stringify({
      event: "reevaluation_enqueue_failed",
      error: err instanceof Error ? err.message : String(err)
    }));
    return false;
  }
}
