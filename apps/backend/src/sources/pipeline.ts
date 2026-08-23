// Shared job-processing pipeline (T4.2–T4.6, ADR-012/037/006/046/039/007).
import type { Pool } from "pg";
import { materialFingerprint, type SourceObservation } from "./contract.js";
import { validateSourceObservation } from "./contract.js";
import { recordAudit } from "../identity/audit.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Per-source freshness windows (operational tunable; ADR-046).
export const FRESHNESS_DAYS: Record<string, number> = {
  greenhouse: 14,
  lever: 14,
  remoteok: 21 // feed is delayed 24h by design
};

function strongMatchKey(o: SourceObservation): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return [o.companyName, o.title, o.location ?? ""].map(norm).join("|");
}

// ---------------------------------------------------------------------------
// T4.2 Normalization + observation persistence
// ---------------------------------------------------------------------------
export type PersistResult =
  | { ok: true; listingId: string; canonicalJobId: string; classification: "initial" | "material" | "non_material" | "duplicate" }
  | { ok: false; reason: "invalid_observation"; reasons: string[] };

export async function persistObservation(
  db: Pool,
  raw: unknown,
  runId: string | null,
  now: Date
): Promise<PersistResult> {
  const validated = validateSourceObservation(raw);
  if (!validated.ok) {
    // Malformed observations are rejected with a recorded outcome (T4.2 AC).
    await recordAudit(db, {
      actorType: "capability",
      action: "normalization.rejected",
      outcome: "failure",
      targetCategory: "source_observation",
      details: { reasons: validated.reasons.slice(0, 10) }
    });
    return { ok: false, reason: "invalid_observation", reasons: validated.reasons };
  }
  const obs = validated.observation;
  const fingerprint = materialFingerprint(obs);
  const key = strongMatchKey(obs);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Listing identity (source + external key).
    let listing = await client.query<{ id: string; latest_hash: string | null; canonical_job_id: string | null }>(
      `INSERT INTO source_listings (job_source_slug, external_listing_key)
       VALUES ($1, $2)
       ON CONFLICT (job_source_slug, external_listing_key) DO NOTHING
       RETURNING id`,
      [obs.source, obs.externalListingKey]
    );
    if (listing.rows.length === 0) {
      listing = await client.query<{ id: string; latest_hash: string | null; canonical_job_id: string | null }>(
        `SELECT l.id, l.canonical_job_id,
                (SELECT o.content_hash FROM source_listing_observations o
                  WHERE o.source_listing_id = l.id ORDER BY o.observed_at DESC LIMIT 1) AS latest_hash
           FROM source_listings l
          WHERE l.job_source_slug = $1 AND l.external_listing_key = $2`,
        [obs.source, obs.externalListingKey]
      );
    }
    const listingId = listing.rows[0].id;

    // Duplicate guard (ADR-044): retries of the SAME logical collection
    // (same run linkage, same hash, same signal) must not duplicate
    // observations. A genuinely newer collection is fresh evidence.
    if (listing.rows[0].latest_hash === fingerprint) {
      const dup = await client.query(
        `SELECT 1 FROM source_listing_observations
          WHERE source_listing_id = $1 AND content_hash = $2
            AND collected_by_run_id IS NOT DISTINCT FROM $3
            AND COALESCE(availability_signal::text, '') = COALESCE($4, '')
          LIMIT 1`,
        [listingId, fingerprint, runId, String(obs.availabilitySignal)]
      );
      if (dup.rows.length > 0) {
        await client.query("COMMIT");
        const existing = await client.query<{ canonical_job_id: string }>(
          "SELECT canonical_job_id FROM source_listings WHERE id = $1", [listingId]
        );
        return {
          ok: true, listingId,
          canonicalJobId: existing.rows[0].canonical_job_id!,
          classification: "duplicate"
        };
      }
    }

    // Canonicalize BEFORE writing the observation so it can reference the run.
    const canonicalJobId = await ensureCanonicalJob(client as unknown as Pool, obs);

    // Classification vs previous observation.
    const previous = listing.rows[0].latest_hash;
    let classification: "initial" | "material" | "non_material";
    if (previous === null) classification = "initial";
    else if (previous === fingerprint) classification = "non_material";
    else classification = "material";

    await client.query(
      `INSERT INTO source_listing_observations
         (source_listing_id, collected_by_run_id, observed_at, availability_signal, content_hash, provenance, change_classification)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        listingId,
        runId,
        now,
        obs.availabilitySignal,
        fingerprint,
        JSON.stringify({ ...obs.provenance, restrictions: obs.restrictions }),
        classification
      ]
    );

    // Derived current view updates only on initial/material changes.
    if (classification !== "non_material") {
      await client.query(
        `UPDATE source_listings
            SET current_title = $2,
                current_location = $3,
                preferred_application_url = $4,
                alternative_application_urls = $5,
                strong_match_key = $6,
                latest_observation_at = $7,
                canonical_job_id = $8
          WHERE id = $1`,
        [
          listingId,
          obs.title,
          obs.location,
          obs.applicationUrls.preferred ?? obs.applicationUrls.alternatives[0] ?? null,
          JSON.stringify(obs.applicationUrls.alternatives),
          key,
          now,
          canonicalJobId
        ]
      );
    } else {
      await client.query(
        "UPDATE source_listings SET latest_observation_at = $2 WHERE id = $1",
        [listingId, now]
      );
    }

    await client.query("COMMIT");
    return { ok: true, listingId, canonicalJobId, classification };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// T4.3 Canonicalization — layered conservative matching (ADR-006/038)
// ---------------------------------------------------------------------------
async function ensureCanonicalJob(db: Pool, obs: SourceObservation): Promise<string> {
  // Strong shared identifier only: exact normalized company+title+location
  // across already-keyed listings (ADR-006 layered conservative matching).
  const key = strongMatchKey(obs);
  const rows = await db.query<{ id: string }>(
    `SELECT DISTINCT cj.id
       FROM canonical_jobs cj
       JOIN source_listings sl ON sl.canonical_job_id = cj.id
      WHERE sl.strong_match_key = $1
      ORDER BY cj.id
      LIMIT 2`,
    [key]
  );

  if (rows.rows.length === 1) return rows.rows[0].id; // confident match

  // Zero or ambiguous (>1) matches: conservative path creates a separate
  // candidate; uncertain cases never auto-merge (ADR-006).
  const created = await db.query<{ id: string }>(
    "INSERT INTO canonical_jobs DEFAULT VALUES RETURNING id"
  );
  return created.rows[0].id;
}

/** Non-destructive reconciliation record (ADR-038). */
export async function recordMerge(
  db: Pool,
  fromCanonicalJobId: string,
  toCanonicalJobId: string,
  confidence: "high" | "uncertain",
  evidence: Record<string, unknown>,
  performedByRunId: string | null,
  _now: Date
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Current relationship: future listings resolve to the surviving identity.
    await client.query(
      "UPDATE source_listings SET canonical_job_id = $2 WHERE canonical_job_id = $1",
      [fromCanonicalJobId, toCanonicalJobId]
    );
    // Historical evaluations/reviews are NOT rewritten — they remain
    // attributable to their original canonical-job identities.
    await client.query(
      `INSERT INTO canonical_job_reconciliations
         (action, from_canonical_job_id, to_canonical_job_id, confidence, evidence, performed_by_run_id)
       VALUES ('merge', $1, $2, $3, $4, $5)`,
      [fromCanonicalJobId, toCanonicalJobId, confidence, JSON.stringify(evidence), performedByRunId]
    );
    await recordAudit(client, {
      actorType: "capability",
      action: "canonical.reconciled",
      outcome: "success",
      targetCategory: "canonical_job_reconciliation",
      details: { action: "merge" }
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// T4.4 Availability processing — evidence-weighted (ADR-046)
// ---------------------------------------------------------------------------
export type AvailabilityState = "active" | "unavailable" | "stale" | "uncertain";

/** Pure state computation from observation signals + freshness window. */
export function computeAvailabilityState(
  signals: Array<{ signal: "active" | "closed" | "removed"; observedAt: Date }>,
  hasOwnObservations: boolean,
  now: Date,
  freshnessDays: number
): AvailabilityState {
  if (signals.length === 0) {
    // No own evidence at all (e.g. user-imported URL): truthfully uncertain.
    return "uncertain";
  }
  const latest = signals.reduce((a, b) => (b.observedAt > a.observedAt ? b : a));
  if (latest.signal === "closed" || latest.signal === "removed") {
    return "unavailable"; // explicit authoritative signal wins regardless of age
  }
  const ageMs = now.getTime() - latest.observedAt.getTime();
  if (ageMs <= freshnessDays * DAY_MS) return "active";
  return "stale";
}

/** Recomputes and appends a history row only on genuine transitions. */
export async function refreshAvailability(
  db: Pool,
  canonicalJobId: string,
  now: Date,
  freshnessDaysOverride?: number
): Promise<AvailabilityState> {
  const listings = await db.query<{ id: string; job_source_slug: string; latest_observation_at: Date | null }>(
    "SELECT id, job_source_slug, latest_observation_at FROM source_listings WHERE canonical_job_id = $1",
    [canonicalJobId]
  );
  if (listings.rows.length === 0) return "uncertain";

  const signals: Array<{ signal: "active" | "closed" | "removed"; observedAt: Date }> = [];
  for (const listing of listings.rows) {
    if (listing.latest_observation_at === null) continue; // imported, no own evidence
    const latestObs = await db.query<{ availability_signal: "active" | "closed" | "removed" | null; observed_at: Date }>(
      `SELECT availability_signal, observed_at FROM source_listing_observations
        WHERE source_listing_id = $1 ORDER BY observed_at DESC, id DESC LIMIT 1`,
      [listing.id]
    );
    if (latestObs.rows[0]?.availability_signal) {
      signals.push({
        signal: latestObs.rows[0].availability_signal,
        observedAt: latestObs.rows[0].observed_at
      });
    }
  }

  const hasOwnObservations = signals.length > 0 ||
    listings.rows.some((l) => l.latest_observation_at !== null);
  const maxFreshness = Math.max(
    ...listings.rows.map((l) => FRESHNESS_DAYS[l.job_source_slug] ?? 14),
    freshnessDaysOverride ?? 14
  );
  const state = computeAvailabilityState(signals, hasOwnObservations, now, maxFreshness);

  const latestHistory = await db.query<{ state: AvailabilityState }>(
    `SELECT state FROM availability_history
      WHERE canonical_job_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    [canonicalJobId]
  );
  const priorState = latestHistory.rows[0]?.state;

  if (priorState !== state) {
    const reason =
      state === "active"
        ? (priorState !== undefined && priorState !== "active" ? "restored" : "observation_active")
        : state === "unavailable"
          ? signals.find((s) => s.signal !== "active")!.signal === "removed"
            ? "explicit_removed"
            : "explicit_closed"
          : state === "stale"
            ? "freshness_window_stale"
            : "freshness_window_uncertain";
    await db.query(
      `INSERT INTO availability_history (canonical_job_id, state, reason, recorded_at)
       VALUES ($1, $2, $3, $4)`,
      [canonicalJobId, state, reason, now]
    );
  }
  return state;
}
