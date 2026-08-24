// T8.5 — retention enforcement across category schedules (ADRs 019–021).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { runRetentionSweep } from "../src/observability/retention.js";
import { resetDb } from "./helpers.js";
import { testDbConfig, TEST_DB } from "./global-setup.js";
import { Pool } from "pg";

const db = new Pool({ ...testDbConfig(), database: TEST_DB });
const t0 = new Date("2026-08-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.end();
});

describe("retention sweeps", () => {
  it("resume grace: superseded documents are soft-deleted after 30 days", async () => {
    const acct = await db.query<{ id: string }>(
      `INSERT INTO accounts (email, state) VALUES ('r@example.invalid', 'active') RETURNING id`
    );
    await db.query(
      `INSERT INTO resume_documents (account_id, storage_key, superseded_at)
       VALUES ($1, 'k-old', $2), ($1, 'k-fresh', $3)`,
      [acct.rows[0].id, new Date(t0.getTime() - 40 * DAY), new Date(t0.getTime() - 5 * DAY)]
    );
    await runRetentionSweep(db, t0);
    const rows = await db.query<{ storage_key: string; deleted_at: Date | null }>(
      "SELECT storage_key, deleted_at FROM resume_documents ORDER BY storage_key"
    );
    const oldRow = rows.rows.find((r) => r.storage_key === "k-old")!;
    const freshRow = rows.rows.find((r) => r.storage_key === "k-fresh")!;
    expect(oldRow.deleted_at).not.toBeNull();
    expect(freshRow.deleted_at).toBeNull();
  });

  it("shared data: observations and availability older than 180 days are deleted", async () => {
    await db.query("INSERT INTO canonical_jobs (id) VALUES ('00000000-0000-4000-8000-00000000aa01')");
    await db.query(
      `INSERT INTO source_listings (id, job_source_slug, external_listing_key, canonical_job_id)
       VALUES ('00000000-0000-4000-8000-00000000ab01', 'greenhouse', 'old-key', '00000000-0000-4000-8000-00000000aa01')`
    );
    // Old observation + fresh observation.
    for (const [age, hash] of [[200, "old"], [5, "fresh"]] as Array<[number, string]>) {
      await db.query(
        `INSERT INTO source_listing_observations
           (source_listing_id, observed_at, availability_signal, content_hash, provenance)
         VALUES ('00000000-0000-4000-8000-00000000ab01', $1, 'active', $2, '{}')`,
        [new Date(t0.getTime() - age * DAY), hash]
      );
    }
    await db.query(
      `INSERT INTO availability_history (canonical_job_id, state, reason, recorded_at)
       VALUES ('00000000-0000-4000-8000-00000000aa01', 'active', 'observation_active', $1),
              ('00000000-0000-4000-8000-00000000aa01', 'stale', 'freshness_window_stale', $2)`,
      [new Date(t0.getTime() - 200 * DAY), new Date(t0.getTime() - 5 * DAY)]
    );

    await runRetentionSweep(db, t0);

    const obsAges = await db.query<{ content_hash: string }>(
      "SELECT content_hash FROM source_listing_observations"
    );
    expect(obsAges.rows.map((r) => r.content_hash)).toEqual(["fresh"]);
    const availStates = await db.query<{ reason: string }>(
      "SELECT reason FROM availability_history"
    );
    expect(availStates.rows.map((r) => r.reason)).toEqual(["freshness_window_stale"]); // only the fresh row remains
  });

  it("audit events expire after 12 months", async () => {
    await db.query(
      `INSERT INTO audit_events (occurred_at, actor_type, action, outcome)
       VALUES ($1, 'system', 'old.event', 'success'), (now(), 'system', 'new.event', 'success')`,
      [new Date(t0.getTime() - 400 * DAY)]
    );
    await runRetentionSweep(db, t0);
    const actions = await db.query<{ action: string }>("SELECT action FROM audit_events");
    expect(actions.rows.map((r) => r.action)).toEqual(["new.event"]);
  });

  it("exceptional-access records expire after 24 months", async () => {
    const acct = await db.query<{ id: string }>(
      `INSERT INTO accounts (email, state) VALUES ('ea@example.invalid', 'active') RETURNING id`
    );
    await db.query(
      `INSERT INTO exceptional_access_requests
         (requested_by_account_id, purpose, scope, status, time_limit, requested_at)
       VALUES ($1, 'support', '{}', 'completed', now(), $2),
              ($1, 'recent', '{}', 'approved', now(), now())`,
      [acct.rows[0].id, new Date(t0.getTime() - 800 * DAY)]
    );
    await runRetentionSweep(db, t0);
    const purposes = await db.query<{ purpose: string }>(
      "SELECT purpose FROM exceptional_access_requests"
    );
    expect(purposes.rows).toHaveLength(1);
    expect(purposes.rows[0].purpose).toBe("recent");
  });
});
