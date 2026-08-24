// Evaluation snapshots (T6.4, ADR-013/040): immutable, tied to exact inputs;
// compatible-current selection for the dashboard.
import type { Pool } from "pg";
import { recordAudit } from "../identity/audit.js";

export const MATCHING_POLICY_VERSION = "mp-1";

export type SnapshotInput = {
  accountId: string;
  canonicalJobId: string;
  profileVersionId: string;
  inputObservationId: string | null;
  eligibility: "confirmed" | "unverified" | "conflicting" | "ineligible";
  constraintFailures: Array<{ constraint: string; detail: string }>;
  dimensions: unknown;
  explanation: unknown;
  score: number | null;
};

/**
 * Inserts a new immutable snapshot. Supersession is DERIVED (a newer
 * snapshot existing for the same account+job) — append-only rows are never
 * mutated (AGENTS.md invariant 7).
 */
export async function createEvaluationSnapshot(
  db: Pool,
  input: SnapshotInput,
  _now: Date
): Promise<string> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO evaluations
         (account_id, canonical_job_id, profile_version_id, input_observation_id,
          matching_policy_version, outcome, eligibility, constraint_failures,
          dimensions, explanation, score)
       VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        input.accountId,
        input.canonicalJobId,
        input.profileVersionId,
        input.inputObservationId,
        MATCHING_POLICY_VERSION,
        input.eligibility,
        JSON.stringify(input.constraintFailures),
        JSON.stringify(input.dimensions),
        JSON.stringify(input.explanation),
        input.score
      ]
    );
    await recordAudit(client, {
      actorType: "capability",
      actorAccountId: input.accountId,
      action: "evaluation.created",
      outcome: "success",
      targetCategory: "evaluation",
      targetId: inserted.rows[0].id
    });
    await client.query("COMMIT");
    return inserted.rows[0].id;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ADR-040 compatible-current-result selection: the newest succeeded snapshot
 * is current ONLY if its inputs match the user's CURRENT approved profile,
 * the CURRENT matching policy, AND the job's latest observation. Otherwise
 * the dashboard must not imply a current personalized result exists.
 */
export async function getCurrentCompatibleEvaluation(
  db: Pool,
  accountId: string,
  canonicalJobId: string
): Promise<{ id: string; score: number | null; eligibility: string; created_at: Date } | null> {
  const currentProfile = await db.query<{ current_profile_version_id: string | null }>(
    "SELECT current_profile_version_id FROM career_profiles WHERE account_id = $1",
    [accountId]
  );
  const profileVersionId = currentProfile.rows[0]?.current_profile_version_id ?? null;

  const latestObs = await db.query<{ latest_observation_id: string | null }>(
    `SELECT o.id::text AS latest_observation_id
       FROM source_listing_observations o
       JOIN source_listings l ON l.id = o.source_listing_id
      WHERE l.canonical_job_id = $1
      ORDER BY o.observed_at DESC, o.id DESC
      LIMIT 1`,
    [canonicalJobId]
  );
  const latestObservationId = latestObs.rows[0]?.latest_observation_id ?? null;

  const row = await db.query<{
    id: string;
    score: number | null;
    eligibility: string;
    matching_policy_version: string;
    profile_version_id: string;
    input_observation_id: string | null;
    created_at: Date;
  }>(
    `SELECT id, score, eligibility, matching_policy_version, profile_version_id, input_observation_id, created_at
       FROM evaluations
      WHERE account_id = $1 AND canonical_job_id = $2
        AND superseded = false AND outcome = 'succeeded'
      ORDER BY created_at DESC LIMIT 1`,
    [accountId, canonicalJobId]
  );
  const evalRow = row.rows[0];
  if (!evalRow) return null;

  if (!profileVersionId || evalRow.profile_version_id !== profileVersionId) return null;
  if (evalRow.matching_policy_version !== MATCHING_POLICY_VERSION) return null;
  if ((evalRow.input_observation_id ?? null) !== latestObservationId) return null;

  return {
    id: evalRow.id,
    score: evalRow.score,
    eligibility: evalRow.eligibility,
    created_at: evalRow.created_at
  };
}
