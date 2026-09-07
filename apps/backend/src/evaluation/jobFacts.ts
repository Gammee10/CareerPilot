// Structured job facts + evidence map (T6.1/T6.3).
// CONSTRAINTS see ONLY these structured fields — never free description text,
// so adversarial description claims cannot influence eligibility decisions.
import type { Pool } from "pg";
import { getCurrentJobSelection } from "./currentView.js";

export type JobFacts = {
  canonicalJobId: string;
  company: string | null;
  title: string | null;
  location: string | null;
  /** Deterministic keyword inference from the location field only. */
  remoteInferred: boolean | null;
  /** Numeric salary is not exposed by the authorized sources; stays null. */
  salaryMin: number | null;
  salaryMax: number | null;
};

export type EvidenceEntry = { field: string; value: string };

/** Named structured fields + description excerpt; stable reference keys. */
export type EvidenceMap = Record<string, EvidenceEntry>;

// Conservative remote-work inference (adversarial hardening, T9.2): only
// locations BEGINNING with an explicit remote/distributed form count. Free
// text merely CONTAINING "remote" (e.g. injected instructions) must not flip
// work-mode facts.
const REMOTE_PREFIX_RE =
  /^\s*(fully remote|100% remote|remote|distributed|work from anywhere)\b/i;

export function inferRemote(location: string | null): boolean | null {
  if (location === null || location.trim().length === 0) return null;
  return REMOTE_PREFIX_RE.test(location);
}

export async function loadJobView(
  db: Pool,
  canonicalJobId: string
): Promise<{
  facts: JobFacts;
  evidence: EvidenceMap;
  latestObservationId: string | null;
  sourceSlugs: string[];
  companyName: string;
} | null> {
  const listings = await db.query<{
    id: string;
    current_title: string | null;
    current_location: string | null;
    preferred_application_url: string | null;
    job_source_slug: string;
    latest_observation_id: string | null;
  }>(
    `SELECT l.id, l.current_title, l.current_location, l.preferred_application_url,
            l.job_source_slug,
            (SELECT o.id FROM source_listing_observations o
              WHERE o.source_listing_id = l.id
              ORDER BY o.observed_at DESC, o.id DESC LIMIT 1) AS latest_observation_id
       FROM source_listings l
      WHERE l.canonical_job_id = $1
      ORDER BY l.latest_observation_at DESC NULLS LAST, l.id DESC`,
    [canonicalJobId]
  );
  if (listings.rows.length === 0) return null;

  // Shared current-view selection (H7): the primary listing is the one
  // holding the globally latest observation — the same observation
  // getCurrentCompatibleEvaluation compares snapshots against. Falls back to
  // the deterministically first listing only when no observation exists yet.
  const selection = await getCurrentJobSelection(db, canonicalJobId);
  const primary =
    (selection && listings.rows.find((l) => l.id === selection.listingId)) ??
    listings.rows[0];
  const companyRow = primary.latest_observation_id
    ? await db.query<{ provenance: Record<string, unknown> }>(
        `SELECT provenance FROM source_listing_observations WHERE id = $1`,
        [primary.latest_observation_id]
      )
    : { rows: [] as Array<{ provenance: Record<string, unknown> }> };
  // Employer identity comes only from adapter provenance (board/site slugs).
  // Never infer a company from the title text: a title fragment as employer
  // produces excluded_companies false positives/negatives. Unknown stays null.
  const companyName =
    (companyRow.rows[0]?.provenance?.["boardToken"] as string | undefined) ??
    (companyRow.rows[0]?.provenance?.["site"] as string | undefined) ??
    null;

  const facts: JobFacts = {
    canonicalJobId,
    company: companyName,
    title: primary.current_title,
    location: primary.current_location,
    remoteInferred: inferRemote(primary.current_location),
    salaryMin: null,
    salaryMax: null
  };

  const evidence: EvidenceMap = {};
  if (facts.title) evidence["field:title"] = { field: "title", value: facts.title };
  if (facts.location) evidence["field:location"] = { field: "location", value: facts.location };
  if (facts.company) evidence["field:company"] = { field: "company", value: facts.company };
  evidence["field:source"] = {
    field: "source",
    value: listings.rows.map((l) => l.job_source_slug).join(",")
  };

  const sourceSlugs = [...new Set(listings.rows.map((l) => l.job_source_slug))];
  // The snapshot input id is the shared global-latest observation (H7), so
  // compatible-current selection agrees with the facts it was computed from.
  const latestObservationId =
    selection?.observationId ??
    (listings.rows
      .map((l) => l.latest_observation_id)
      .filter((x): x is string => x !== null)[0] ?? null);

  return { facts, evidence, latestObservationId, sourceSlugs, companyName: facts.company ?? "" };
}
