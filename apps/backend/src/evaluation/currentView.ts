// Single deterministic "current view" selector (H7, ADR-040).
//
// `loadJobView` (evaluation input) and `getCurrentCompatibleEvaluation`
// (compatible-current check) must agree on which observation is "the latest"
// for a canonical job. Previously they used different queries — an unordered
// listing pick vs a global latest-observation lookup — so freshly evaluated
// jobs could read back as permanently `pendingReevaluation`. Both paths now
// resolve through `getCurrentJobSelection`: the globally latest observation
// across all listings of the job by `(observed_at DESC, id DESC)`.
import type { Pool } from "pg";

export type CurrentJobSelection = {
  listingId: string;
  observationId: string;
};

export async function getCurrentJobSelection(
  db: Pool,
  canonicalJobId: string
): Promise<CurrentJobSelection | null> {
  const row = await db.query<{ listing_id: string; observation_id: string }>(
    `SELECT l.id AS listing_id, o.id AS observation_id
       FROM source_listing_observations o
       JOIN source_listings l ON l.id = o.source_listing_id
      WHERE l.canonical_job_id = $1
      ORDER BY o.observed_at DESC, o.id DESC
      LIMIT 1`,
    [canonicalJobId]
  );
  if (row.rows.length === 0) return null;
  return { listingId: row.rows[0].listing_id, observationId: row.rows[0].observation_id };
}
