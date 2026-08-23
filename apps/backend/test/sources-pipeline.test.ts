const RUN1 = "00000000-0000-4000-8000-000000000001";
const RUN2 = "00000000-0000-4000-8000-000000000002";
const RUNA = "00000000-0000-4000-8000-00000000000a";
const RUNB = "00000000-0000-4000-8000-00000000000b";
const RUNLATE = "00000000-0000-4000-8000-00000000000c";

// T4.2â€“T4.6 â€” pipeline stages: normalization, canonicalization, availability,
// material-change detection, reconciliation, link selection.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  persistObservation,
  refreshAvailability,
  recordMerge,
  computeAvailabilityState
} from "../src/sources/pipeline.js";
import { selectApplicationLinks } from "../src/sources/links.js";
import { resetDb } from "./helpers.js";
import { testDbConfig, TEST_DB } from "./global-setup.js";
import { Pool } from "pg";

const db = new Pool({ ...testDbConfig(), database: TEST_DB });
const t0 = new Date("2026-08-23T12:00:00Z");

  // Creates a real discovery-run row so observation FKs resolve.
async function createRun(runId: string, label: string): Promise<void> {
  const acct = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, state) VALUES ($1, 'active') RETURNING id`,
    [`run-owner-${label}@example.invalid`]
  );
  const pv = await db.query<{ id: string }>(
    `INSERT INTO profile_versions (account_id, version_number, source, content)
     VALUES ($1, 1, 'manual', '{}') RETURNING id`,
    [acct.rows[0].id]
  );
  await db.query(
    `INSERT INTO discovery_runs (id, account_id, profile_version_id, trigger_source, status)
     VALUES ($1, $2, $3, 'scheduled', 'complete')`,
    [runId, acct.rows[0].id, pv.rows[0].id]
  );
}


beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.end();
});

function observation(overrides: Record<string, unknown> = {}) {
  return {
    source: "greenhouse",
    externalListingKey: "job-1",
    companyName: "acme",
    title: "Backend Engineer",
    location: "Remote",
    descriptionText: "Build services with Go.",
    applicationUrls: { preferred: "https://boards.greenhouse.io/acme/jobs/1", alternatives: [] },
    postedAt: null,
    availabilitySignal: "active" as const,
    restrictions: [],
    provenance: { fetchedAt: "2026-08-23T12:00:00Z" },
    ...overrides
  };
}

describe("normalization (T4.2)", () => {
  it.each([
    ["missing title", observation({ title: "" })],
    ["bad preferred url", observation({ applicationUrls: { preferred: "http://insecure.example/x", alternatives: [] } })],
    ["no urls at all", observation({ applicationUrls: { alternatives: [] } })],
    ["invalid signal", observation({ availabilitySignal: "maybe" })],
    ["unknown source", observation({ source: "indeed" })],
    ["non-object", "just a string"]
  ])("rejects malformed observation (%s) with recorded outcome", async (_label, bad) => {
    const result = await persistObservation(db, bad as never, null, t0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_observation");

    const audit = await db.query(
      "SELECT id FROM audit_events WHERE action = 'normalization.rejected'"
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
    // Nothing was persisted.
    const listings = await db.query("SELECT id FROM source_listings");
    expect(listings.rows).toHaveLength(0);
  });
});

describe("canonicalization (T4.3)", () => {
  it("same strong key across sources converges on ONE canonical job", async () => {
    const a = await persistObservation(db, observation(), null, t0);
    const b = await persistObservation(
      db,
      observation({
        source: "lever",
        externalListingKey: "lev-9",
        companyName: "Acme", // normalization makes this equal to 'acme'
        title: "Backend Engineer",
        location: "remote",
        applicationUrls: { preferred: "https://jobs.lever.co/acme/9", alternatives: [] }
      }),
      null,
      new Date(t0.getTime() + 1000)
    );
    expect(a.canonicalJobId).toBe(b.canonicalJobId);
  });

  it("different companies remain separate candidates (conservative)", async () => {
    const a = await persistObservation(db, observation(), null, t0);
    const b = await persistObservation(
      db,
      observation({ externalListingKey: "job-2", companyName: "globex" }),
      null,
      new Date(t0.getTime() + 1000)
    );
    expect(a.canonicalJobId).not.toBe(b.canonicalJobId);
  });

  it("duplicate observations do not create duplicate rows (idempotent retry)", async () => {
    await createRun(RUN1, "one");
    await createRun(RUN2, "two");
    await persistObservation(db, observation(), RUN1, t0);
    const again = await persistObservation(db, observation(), RUN1, new Date(t0.getTime() + 500));
    expect(again.classification).toBe("duplicate");
    const obsCount = await db.query("SELECT count(*)::int AS n FROM source_listing_observations");
    expect(obsCount.rows[0].n).toBe(1);

    // A genuinely LATER collection (different run) records fresh evidence
    // even with identical content — classified non-material.
    const laterRun = await persistObservation(db, observation(), RUN2, new Date(t0.getTime() + 60_000));
    expect(laterRun.classification).toBe("non_material");
    const after = await db.query("SELECT count(*)::int AS n FROM source_listing_observations");
    expect(after.rows[0].n).toBe(2);
  });

  it("merge records the relationship non-destructively; evaluations keep their identity", async () => {
    // Seed an evaluation against the original canonical job.
    const a = await persistObservation(db, observation(), null, t0);
    const acct = await db.query<{ id: string }>(
      `INSERT INTO accounts (email, state) VALUES ('eval@example.invalid', 'active') RETURNING id`
    );
    const pv = await db.query<{ id: string }>(
      `INSERT INTO profile_versions (account_id, version_number, source, content)
       VALUES ($1, 1, 'manual', '{}') RETURNING id`,
      [acct.rows[0].id]
    );
    const evaluation = await db.query<{ id: string; canonical_job_id: string }>(
      `INSERT INTO evaluations (account_id, canonical_job_id, profile_version_id,
                                matching_policy_version, outcome, eligibility)
       VALUES ($1, $2, $3, 'test', 'succeeded', 'unverified') RETURNING id, canonical_job_id`,
      [acct.rows[0].id, a.canonicalJobId, pv.rows[0].id]
    );

    // Later a second canonical job exists and evidence supports merging.
    const b = await persistObservation(
      db,
      observation({ externalListingKey: "job-3", companyName: "ACME Corp", title: "backend engineer" }),
      null,
      new Date(t0.getTime() + 2000)
    );
    expect(b.canonicalJobId).not.toBe(a.canonicalJobId);

    await recordMerge(
      db,
      b.canonicalJobId,
      a.canonicalJobId,
      "high",
      { reason: "identical posting text and employer ats url" },
      null,
      new Date(t0.getTime() + 3000)
    );

    // Historical evaluation is NOT rewritten.
    const afterEval = await db.query<{ canonical_job_id: string }>(
      "SELECT canonical_job_id FROM evaluations WHERE id = $1",
      [evaluation.rows[0].id]
    );
    expect(afterEval.rows[0].canonical_job_id).toBe(a.canonicalJobId);

    // Reconciliation row retains BOTH identities with evidence.
    const rec = await db.query<{ action: string; from_canonical_job_id: string; to_canonical_job_id: string; confidence: string }>(
      "SELECT action, from_canonical_job_id, to_canonical_job_id, confidence FROM canonical_job_reconciliations"
    );
    expect(rec.rows[0]).toMatchObject({
      action: "merge",
      from_canonical_job_id: b.canonicalJobId,
      to_canonical_job_id: a.canonicalJobId,
      confidence: "high"
    });
  });
});

describe("material-change detection (T4.5)", () => {
  it("material change classified and current view updated", async () => {
    await persistObservation(db, observation(), null, t0);
    const later = new Date(t0.getTime() + 60_000);
    const result = await persistObservation(
      db,
      observation({ title: "Staff Backend Engineer", descriptionText: "Now with Rust." }),
      null,
      later
    );
    expect(result.classification).toBe("material");

    const listing = await db.query<{ current_title: string }>(
      "SELECT current_title FROM source_listings WHERE external_listing_key = 'job-1'"
    );
    expect(listing.rows[0].current_title).toBe("Staff Backend Engineer");

    const cls = await db.query<{ change_classification: string }>(
      `SELECT change_classification FROM source_listing_observations
        ORDER BY observed_at DESC LIMIT 1`
    );
    expect(cls.rows[0].change_classification).toBe("material");
  });

  it("NON-material change produces no re-evaluation trigger (T4.5 AC)", async () => {
    await persistObservation(db, observation(), null, t0);
    // Same material fields, different fetch timestamp inside provenance only.
    const result = await persistObservation(
      db,
      observation({ provenance: { fetchedAt: "2026-08-24T00:00:00Z" } }),
      null,
      new Date(t0.getTime() + 60_000)
    );
    expect(result.classification).toBe("duplicate"); // identical fingerprint â†’ no-op

    const audits = await db.query(
      `SELECT id FROM audit_events WHERE details->>'classification' = 'material'`
    );
    expect(audits.rows).toHaveLength(0); // nothing material happened
  });
});

describe("availability processing (T4.4)", () => {
  async function seedListingWithSignal(
    signal: "active" | "closed" | "removed",
    observedAt: Date,
    runId: string
  ) {
    const persisted = await persistObservation(
      db,
      observation({ availabilitySignal: signal }),
      runId,
      observedAt
    );
    if (!persisted.ok) throw Error("setup");
    await refreshAvailability(db, persisted.canonicalJobId, observedAt);
    return persisted;
  }

  async function latestState(canonicalJobId: string): Promise<{ state: string; reason: string }> {
    const row = await db.query<{ state: string; reason: string }>(
      `SELECT state, reason FROM availability_history
        WHERE canonical_job_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      [canonicalJobId]
    );
    return row.rows[0];
  }

  it("fresh active observation -> active; explicit close -> unavailable", async () => {
    await createRun(RUNA, "ra");
    const seeded = await seedListingWithSignal("active", t0, RUNA);
    expect(await latestState(seeded.canonicalJobId)).toMatchObject({
      state: "active", reason: "observation_active"
    });

    await createRun(RUNB, "rb");
    await persistObservation(
      db,
      observation({ availabilitySignal: "closed" }),
      RUNB,
      new Date(t0.getTime() + 60_000)
    );
    await refreshAvailability(db, seeded.canonicalJobId, new Date(t0.getTime() + 60_000));
    expect(await latestState(seeded.canonicalJobId)).toMatchObject({
      state: "unavailable", reason: "explicit_closed"
    });
  });

  it("absence NEVER marks unavailable: a collection run without the listing writes no history", async () => {
    await createRun(RUNA, "ra");
    const seeded = await seedListingWithSignal("active", t0, RUNA);
    // A later run collects other listings but not this one â€” nothing happens
    // to the missing listing's state.
    await persistObservation(
      db,
      observation({ externalListingKey: "other-job" }),
      null,
      new Date(t0.getTime() + 60_000)
    );
    await refreshAvailability(db, seeded.canonicalJobId, new Date(t0.getTime() + 60_000));

    const history = await db.query(
      "SELECT state FROM availability_history WHERE canonical_job_id = $1",
      [seeded.canonicalJobId]
    );
    expect(history.rows.map((r) => r.state)).toEqual(["active"]); // unchanged
  });

  it("past the freshness window the state becomes stale; a later active observation restores it", async () => {
    await createRun(RUNA, "ra");
    const seeded = await seedListingWithSignal("active", t0, RUNA);

    const staleAt = new Date(t0.getTime() + 20 * 24 * 60 * 60 * 1000); // beyond window
    await refreshAvailability(db, seeded.canonicalJobId, staleAt);
    expect(await latestState(seeded.canonicalJobId)).toMatchObject({ state: "stale" });

    await createRun(RUNLATE, "rl");
    await persistObservation(
      db,
      observation({ availabilitySignal: "active" }),
      RUNLATE,
      new Date(staleAt.getTime() + 60_000)
    );
    await refreshAvailability(db, seeded.canonicalJobId, new Date(staleAt.getTime() + 60_000));
    expect(await latestState(seeded.canonicalJobId)).toMatchObject({
      state: "active", reason: "restored"
    });
  });

  it("listing with no own observations is uncertain (imported URL case)", () => {
    expect(computeAvailabilityState([], false, t0, 14)).toBe("uncertain");
  });

  it("covers all four states explicitly", () => {
    const now = t0;
    const freshActive = [{ signal: "active" as const, observedAt: new Date(now.getTime() - 1000) }];
    const oldActive = [{ signal: "active" as const, observedAt: new Date(now.getTime() - 30 * 24 * 3600 * 1000) }];
    const closed = [{ signal: "closed" as const, observedAt: new Date(now.getTime() - 1000) }];
    expect(computeAvailabilityState(freshActive, true, now, 14)).toBe("active");
    expect(computeAvailabilityState(oldActive, true, now, 14)).toBe("stale");
    expect(computeAvailabilityState(closed, true, now, 14)).toBe("unavailable");
    expect(computeAvailabilityState([], false, now, 14)).toBe("uncertain");
  });
});

describe("application-link selection (T4.6)", () => {
  it("prefers the employer ATS link and keeps alternatives in the detail view", () => {
    const selected = selectApplicationLinks({
      preferred: "https://boards.greenhouse.io/acme/jobs/1",
      alternatives: ["https://acme.com/careers/1", "https://jobs.lever.co/acme/1"]
    });
    expect(selected.preferred).toContain("greenhouse.io");
    expect(selected.basis).toBe("employer_ats");
    expect(selected.alternatives).toHaveLength(2); // retained for detail view
  });

  it("falls back to the best source link when no ATS link exists", () => {
    const selected = selectApplicationLinks({
      alternatives: ["https://remoteok.com/remote-jobs/x"]
    });
    expect(selected.basis).toBe("source_link");
    expect(selected.preferred).toContain("remoteok.com");
  });

});
