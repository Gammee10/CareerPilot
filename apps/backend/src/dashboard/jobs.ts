// Dashboard job views (T7.2, FR-14/15): ranked new-jobs view + detail with
// evidence, scores, eligibility state and links. Not-interested jobs are
// never re-presented; unavailable jobs appear only when saved (ADR-046).
import type { Pool } from "pg";
import { getCurrentCompatibleEvaluation } from "../evaluation/snapshot.js";
import { loadJobView } from "../evaluation/jobFacts.js";

export type JobListItem = {
  canonicalJobId: string;
  title: string | null;
  company: string | null;
  location: string | null;
  availability: string;
  reviewState: string;
  eligibility: string | null;
  score: number | null;
  pendingReevaluation: boolean;
};

export async function listJobsForDashboard(
  db: Pool,
  accountId: string
): Promise<JobListItem[]> {
  const rows = await db.query<{ canonical_job_id: string; review_state: string }>(
    `SELECT DISTINCT e.canonical_job_id,
            COALESCE(r.state, 'new') AS review_state
       FROM evaluations e
       LEFT JOIN user_job_reviews r
         ON r.account_id = e.account_id AND r.canonical_job_id = e.canonical_job_id
      WHERE e.account_id = $1`,
    [accountId]
  );

  const items: Array<JobListItem & { eligibleRank: number }> = [];
  for (const row of rows.rows) {
    // Not-interested jobs are never re-presented (T7.2 AC).
    if (row.review_state === "not_interested") continue;

    const avail = await db.query<{ state: string }>(
      `SELECT state FROM availability_history
        WHERE canonical_job_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      [row.canonical_job_id]
    );
    const availability = avail.rows[0]?.state ?? "uncertain";
    // Default ranking covers believed-active jobs only; saved/unavailable
    // remain retained and truthfully labeled.
    if (availability !== "active" && row.review_state !== "saved") continue;

    const evaluation = await getCurrentCompatibleEvaluation(db, accountId, row.canonical_job_id);
    const view = await loadJobView(db, row.canonical_job_id);

    items.push({
      canonicalJobId: row.canonical_job_id,
      title: view?.facts.title ?? null,
      company: view?.facts.company ?? null,
      location: view?.facts.location ?? null,
      availability,
      reviewState: row.review_state,
      eligibility: evaluation?.eligibility ?? null,
      score: evaluation?.score ?? null,
      pendingReevaluation: evaluation === null,
      eligibleRank:
        evaluation?.eligibility === "confirmed" ? 0 :
        evaluation?.eligibility === "unverified" ? 1 : 2
    });
  }

  items.sort((a, b) => {
    if (a.eligibleRank !== b.eligibleRank) return a.eligibleRank - b.eligibleRank;
    return (b.score ?? -1) - (a.score ?? -1);
  });
  return items.map(({ eligibleRank: _r, ...item }) => item);
}

export type JobDetail = {
  jobId: string;
  facts: Record<string, unknown>;
  evidence: Record<string, { field: string; value: string }>;
  preferredApplicationUrl: string | null;
  alternativeApplicationUrls: string[];
  restrictions: string[];
  eligibility: string | null;
  constraintFailures: Array<{ constraint: string; detail: string }>;
  dimensions: unknown;
  explanation: unknown;
  score: number | null;
  pendingReevaluation: boolean;
  reviewState: string;
};

export async function getJobDetail(
  db: Pool,
  accountId: string,
  canonicalJobId: string
): Promise<JobDetail | null> {
  const view = await loadJobView(db, canonicalJobId);
  if (!view) return null;

  const linkRows = await db.query<{
    preferred_application_url: string | null;
    alternative_application_urls: string[] | null;
  }>(
    `SELECT preferred_application_url, alternative_application_urls
       FROM source_listings WHERE canonical_job_id = $1`,
    [canonicalJobId]
  );
  const preferred = linkRows.rows.find((r) => r.preferred_application_url)?.preferred_application_url ?? null;
  const alternatives = [
    ...new Set(linkRows.rows.flatMap((r) => r.alternative_application_urls ?? []))
  ];
  const restrictionRows = await db.query<{ restrictions: string[] }>(
    `SELECT DISTINCT jsonb_array_elements_text(o.provenance->'restrictions') AS restrictions
       FROM source_listing_observations o
       JOIN source_listings l ON l.id = o.source_listing_id
      WHERE l.canonical_job_id = $1`,
    [canonicalJobId]
  );

  const evaluation = await getCurrentCompatibleEvaluation(db, accountId, canonicalJobId);
  let constraintFailures: Array<{ constraint: string; detail: string }> = [];
  let dimensions: unknown = [];
  let explanation: unknown = [];
  let score: number | null = null;
  if (evaluation) {
    const full = await db.query<{
      constraint_failures: Array<{ constraint: string; detail: string }>;
      dimensions: unknown;
      explanation: unknown;
      score: number | null;
    }>(
      `SELECT constraint_failures, dimensions, explanation, score FROM evaluations WHERE id = $1`,
      [evaluation.id]
    );
    constraintFailures = full.rows[0].constraint_failures;
    dimensions = full.rows[0].dimensions;
    explanation = full.rows[0].explanation;
    score = full.rows[0].score;
  }

  const review = await db.query<{ state: string }>(
    "SELECT state FROM user_job_reviews WHERE account_id = $1 AND canonical_job_id = $2",
    [accountId, canonicalJobId]
  );

  return {
    jobId: canonicalJobId,
    facts: { ...view.facts },
    evidence: view.evidence,
    preferredApplicationUrl: preferred,
    alternativeApplicationUrls: alternatives,
    restrictions: [...new Set(restrictionRows.rows.flatMap((r) => r.restrictions))],
    eligibility: evaluation?.eligibility ?? null,
    constraintFailures,
    dimensions,
    explanation,
    score,
    pendingReevaluation: evaluation === null,
    reviewState: review.rows[0]?.state ?? "new"
  };
}

// ---------------------------------------------------------------------------
// Review lifecycle: New â†’ Seen â†’ Saved / Seen â†’ Not interested (domain model)
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  new: ["seen"],
  seen: ["saved", "not_interested"],
  saved: [],          // saved is stable; material updates may be shown as updated
  not_interested: []  // terminal for presentation purposes
};

export async function transitionReview(
  db: Pool,
  accountId: string,
  canonicalJobId: string,
  nextState: string,
  now: Date
): Promise<{ ok: true; state: string } | { ok: false; reason: "invalid_transition" | "job_not_found" }> {
  const existing = await db.query<{ state: string }>(
    "SELECT state FROM user_job_reviews WHERE account_id = $1 AND canonical_job_id = $2",
    [accountId, canonicalJobId]
  );
  const current = existing.rows[0]?.state ?? "new";
  if (!ALLOWED_TRANSITIONS[current]?.includes(nextState)) {
    return { ok: false, reason: "invalid_transition" };
  }
  await db.query(
    `INSERT INTO user_job_reviews (account_id, canonical_job_id, state)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id, canonical_job_id)
     DO UPDATE SET state = $3, state_changed_at = $4, updated_at = $4`,
    [accountId, canonicalJobId, nextState, now]
  );
  return { ok: true, state: nextState };
}
