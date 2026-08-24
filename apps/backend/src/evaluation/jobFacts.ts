// Structured job facts + evidence map (T6.1/T6.3).
// CONSTRAINTS see ONLY these structured fields — never free description text,
// so adversarial description claims cannot influence eligibility decisions.
import type { Pool } from "pg";

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
              ORDER BY o.observed_at DESC, id DESC LIMIT 1) AS latest_observation_id
       FROM source_listings l
      WHERE l.canonical_job_id = $1`,
    [canonicalJobId]
  );
  if (listings.rows.length === 0) return null;

  const primary = listings.rows[0];
  const companyRow = await db.query<{ provenance: Record<string, unknown> }>(
    `SELECT provenance FROM source_listing_observations WHERE id = $1`,
    [primary.latest_observation_id]
  );
  const companyName =
    (companyRow.rows[0]?.provenance?.["boardToken"] as string | undefined) ??
    (companyRow.rows[0]?.provenance?.["site"] as string | undefined) ??
    primary.current_title?.split(/[-–|]/)[0].trim() ??
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
  const latestObservationId =
    listings.rows
      .map((l) => l.latest_observation_id)
      .filter((x): x is string => x !== null)[0] ?? null;

  return { facts, evidence, latestObservationId, sourceSlugs, companyName: facts.company ?? "" };
}
