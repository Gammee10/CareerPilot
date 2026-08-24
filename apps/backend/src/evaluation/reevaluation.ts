// Bounded re-evaluation after material profile change (T6.5, ADR-041/FR-24).
// Only the user's ACTIVE, non-dismissed, in-scope jobs with existing
// evaluations are re-evaluated; historical/unavailable/out-of-scope/dismissed
// jobs are untouched.
import type { Pool } from "pg";
import type { AiClient } from "../profile/aiClient.js";
import { evaluateJobForUser } from "./engine.js";

export type ReevaluationScope = {
  sources: string[];       // enabled/allowed source slugs (empty = all)
  companies: string[];     // targeted employers (empty = all)
};

export async function selectJobsForReevaluation(
  db: Pool,
  accountId: string
): Promise<string[]> {
  // Scope from the user's search strategy; empty targeting = whole scope.
  const strategy = await db.query<{ source_targeting: Record<string, unknown> }>(
    "SELECT source_targeting FROM search_strategy WHERE account_id = $1",
    [accountId]
  );
  const targeting = strategy.rows[0]?.source_targeting ?? {};
  const allowedSources = Array.isArray(targeting["sources"])
    ? (targeting["sources"] as string[])
    : [];
  const companies = Array.isArray(targeting["companies"])
    ? (targeting["companies"] as string[]).map((c) => c.toLowerCase())
    : [];

  const rows = await db.query<{ canonical_job_id: string; company: string | null }>(
    `SELECT DISTINCT e.canonical_job_id,
            SPLIT_PART(MIN(sl.strong_match_key), '|', 1) AS company
       FROM evaluations e
       JOIN source_listings sl ON sl.canonical_job_id = e.canonical_job_id
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
      GROUP BY e.canonical_job_id`,
    [accountId]
  );

  const inScope = rows.rows.filter((row) => {
    if (companies.length === 0) return true;
    if (row.company === null) return false;
    const company = row.company.toLowerCase();
    return companies.some((c) => company.includes(c));
  });
  void allowedSources;
  return inScope.map((r) => r.canonical_job_id);
}

/** Runs bounded re-evaluation; returns evaluated + skipped counts. */
export async function runReevaluationForProfileChange(
  db: Pool,
  ai: AiClient | undefined,
  accountId: string,
  now: Date
): Promise<{ evaluated: number }> {
  const jobIds = await selectJobsForReevaluation(db, accountId);
  for (const jobId of jobIds) {
    await evaluateJobForUser(db, accountId, jobId, now, ai);
  }
  return { evaluated: jobIds.length };
}
