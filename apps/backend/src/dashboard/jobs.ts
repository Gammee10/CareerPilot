// Dashboard job views (T7.2, FR-14/15): ranked new-jobs view + detail with
// evidence, scores, eligibility state and links. Not-interested jobs are
// never re-presented; unavailable jobs appear only when saved (ADR-046).
import type { Pool } from "pg";
import { getCurrentCompatibleEvaluation, MATCHING_POLICY_VERSION } from "../evaluation/snapshot.js";
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

export const DASHBOARD_DEFAULT_LIMIT = 50;
export const DASHBOARD_MAX_LIMIT = 200;

export type DashboardPage = {
  jobs: JobListItem[];
  total: number;
  limit: number;
  offset: number;
};

export async function listJobsForDashboard(
  db: Pool,
  accountId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<DashboardPage> {
  // H6: fixed query count regardless of job volume (~8 roundtrips) plus
  // pagination, instead of ~6 queries per job with no LIMIT.
  const limit = Math.min(
    Math.max(Math.floor(opts.limit ?? DASHBOARD_DEFAULT_LIMIT), 1),
    DASHBOARD_MAX_LIMIT
  );
  const offset = Math.max(Math.floor(opts.offset ?? 0), 0);

  // Q1: candidate jobs (evaluated at least once) + review state.
  const rows = await db.query<{ canonical_job_id: string; review_state: string }>(
    `SELECT DISTINCT e.canonical_job_id,
            COALESCE(r.state, 'new') AS review_state
       FROM evaluations e
       LEFT JOIN user_job_reviews r
         ON r.account_id = e.account_id AND r.canonical_job_id = e.canonical_job_id
      WHERE e.account_id = $1`,
    [accountId]
  );
  // Not-interested jobs are never re-presented (T7.2 AC).
  const candidates = rows.rows.filter((r) => r.review_state !== "not_interested");
  if (candidates.length === 0) return { jobs: [], total: 0, limit, offset };
  const jobIds = candidates.map((r) => r.canonical_job_id);

  // Q2: latest availability per job, batched.
  const availRows = await db.query<{ canonical_job_id: string; state: string }>(
    `SELECT DISTINCT ON (canonical_job_id) canonical_job_id, state
       FROM availability_history
      WHERE canonical_job_id = ANY($1)
      ORDER BY canonical_job_id, recorded_at DESC, id DESC`,
    [jobIds]
  );
  const availabilityByJob = new Map(availRows.rows.map((r) => [r.canonical_job_id, r.state]));

  // Default ranking covers believed-active jobs only; saved/unavailable
  // remain retained and truthfully labeled.
  const visible = candidates.filter((r) => {
    const availability = availabilityByJob.get(r.canonical_job_id) ?? "uncertain";
    return availability === "active" || r.review_state === "saved";
  });

  // Q3: current profile version (compatibility input).
  const profileRow = await db.query<{ current_profile_version_id: string | null }>(
    "SELECT current_profile_version_id FROM career_profiles WHERE account_id = $1",
    [accountId]
  );
  const currentProfileVersionId = profileRow.rows[0]?.current_profile_version_id ?? null;

  // Q4: globally-latest observation per job, batched (mirrors
  // getCurrentJobSelection, which the single-job path uses).
  const obsRows = await db.query<{ canonical_job_id: string; observation_id: string }>(
    `SELECT DISTINCT ON (l.canonical_job_id) l.canonical_job_id,
            o.id AS observation_id
       FROM source_listing_observations o
       JOIN source_listings l ON l.id = o.source_listing_id
      WHERE l.canonical_job_id = ANY($1)
      ORDER BY l.canonical_job_id, o.observed_at DESC, o.id DESC`,
    [jobIds]
  );
  const latestObsByJob = new Map(obsRows.rows.map((r) => [r.canonical_job_id, r.observation_id]));

  // Q5: newest succeeded evaluation per job, batched.
  const evalRows = await db.query<{
    canonical_job_id: string;
    id: string;
    score: number | null;
    eligibility: string;
    matching_policy_version: string;
    profile_version_id: string;
    input_observation_id: string | null;
  }>(
    `SELECT DISTINCT ON (canonical_job_id) canonical_job_id, id, score,
            eligibility, matching_policy_version, profile_version_id,
            input_observation_id
       FROM evaluations
      WHERE account_id = $1 AND canonical_job_id = ANY($2)
        AND superseded = false AND outcome = 'succeeded'
      ORDER BY canonical_job_id, created_at DESC`,
    [accountId, jobIds]
  );
  // ADR-040 compatibility in Node (same rule as
  // getCurrentCompatibleEvaluation): current profile + current policy +
  // latest observation must all match, else pending.
  const compatibleByJob = new Map<string, { id: string; score: number | null; eligibility: string }>();
  for (const e of evalRows.rows) {
    if (!currentProfileVersionId || e.profile_version_id !== currentProfileVersionId) continue;
    if (e.matching_policy_version !== MATCHING_POLICY_VERSION) continue;
    if ((e.input_observation_id ?? null) !== (latestObsByJob.get(e.canonical_job_id) ?? null)) continue;
    compatibleByJob.set(e.canonical_job_id, { id: e.id, score: e.score, eligibility: e.eligibility });
  }

  // Q6: primary listing facts per job (title/location from the listing holding
  // the latest observation; falls back deterministically when unobserved).
  const obsIds = [...latestObsByJob.values()];
  const listingRows = obsIds.length > 0
    ? await db.query<{
        canonical_job_id: string;
        current_title: string | null;
        current_location: string | null;
        company: string | null;
      }>(
        `SELECT l.canonical_job_id, l.current_title, l.current_location,
                COALESCE(
                  NULLIF(o.provenance->>'boardToken', ''),
                  NULLIF(o.provenance->>'site', '')
                ) AS company
           FROM source_listing_observations o
           JOIN source_listings l ON l.id = o.source_listing_id
          WHERE o.id = ANY($1)`,
        [obsIds]
      )
    : { rows: [] as Array<{
        canonical_job_id: string;
        current_title: string | null;
        current_location: string | null;
        company: string | null;
      }> };
  const factsByJob = new Map(
    listingRows.rows.map((r) => [r.canonical_job_id, r])
  );
  // Jobs without any observation yet: deterministic listing fallback (Q7).
  const missingFacts = visible
    .map((v) => v.canonical_job_id)
    .filter((id) => !factsByJob.has(id));
  if (missingFacts.length > 0) {
    const fallbackRows = await db.query<{
      canonical_job_id: string;
      current_title: string | null;
      current_location: string | null;
    }>(
      `SELECT DISTINCT ON (canonical_job_id) canonical_job_id, current_title,
              current_location
         FROM source_listings
        WHERE canonical_job_id = ANY($1)
        ORDER BY canonical_job_id, latest_observation_at DESC NULLS LAST, id DESC`,
      [missingFacts]
    );
    for (const r of fallbackRows.rows) {
      factsByJob.set(r.canonical_job_id, { ...r, company: null });
    }
  }

  const items: Array<JobListItem & { eligibleRank: number }> = [];
  for (const row of visible) {
    const evaluation = compatibleByJob.get(row.canonical_job_id);
    const facts = factsByJob.get(row.canonical_job_id);
    items.push({
      canonicalJobId: row.canonical_job_id,
      title: facts?.current_title ?? null,
      company: facts?.company ?? null,
      location: facts?.current_location ?? null,
      availability: availabilityByJob.get(row.canonical_job_id) ?? "uncertain",
      reviewState: row.review_state,
      eligibility: evaluation?.eligibility ?? null,
      score: evaluation?.score != null ? Number(evaluation.score) : null,
      pendingReevaluation: evaluation === undefined,
      eligibleRank:
        evaluation?.eligibility === "confirmed" ? 0 :
        evaluation?.eligibility === "unverified" ? 1 : 2
    });
  }

  items.sort((a, b) => {
    if (a.eligibleRank !== b.eligibleRank) return a.eligibleRank - b.eligibleRank;
    return (b.score ?? -1) - (a.score ?? -1);
  });
  const total = items.length;
  const page = items
    .slice(offset, offset + limit)
    .map(({ eligibleRank: _r, ...item }) => item);
  return { jobs: page, total, limit, offset };
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
  // Ownership gate (C5): the caller must have an evaluation or review row for
  // this job; otherwise fail closed as not-found (non-disclosing 404).
  const scope = await db.query<{ one: number }>(
    `SELECT 1 AS one FROM evaluations WHERE account_id = $1 AND canonical_job_id = $2
      UNION
     SELECT 1 AS one FROM user_job_reviews WHERE account_id = $1 AND canonical_job_id = $2
     LIMIT 1`,
    [accountId, canonicalJobId]
  );
  if (scope.rows.length === 0) return null;

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
