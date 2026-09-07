// T8.5 — retention enforcement across category schedules (ADRs 019–021).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { runRetentionSweep } from "../src/observability/retention.js";
import { InMemoryObjectStore } from "../src/storage/objectStore.js";
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

  it("replacement upload supersedes prior raws, starting their grace (C7 writer)", async () => {
    const acct = await db.query<{ id: string }>(
      `INSERT INTO accounts (email, state) VALUES ('c7@example.invalid', 'active') RETURNING id`
    );
    const store = new InMemoryObjectStore();
    const { createUploadGrant, completeUpload } = await import(
      "../src/profile/resumes.js"
    );
    const upload = async (text: string) => {
      const grant = await createUploadGrant(db, acct.rows[0].id, t0);
      const res = await completeUpload(
        db, store, grant.token, Buffer.from(text), "text/plain", t0
      );
      if (!res.ok) throw Error("setup upload");
      return res.resumeDocumentId;
    };
    const first = await upload("first resume");
    const second = await upload("second resume");
    const rows = await db.query<{ id: string; superseded_at: Date | null }>(
      "SELECT id, superseded_at FROM resume_documents WHERE account_id = $1",
      [acct.rows[0].id]
    );
    expect(rows.rows.find((r) => r.id === first)!.superseded_at).not.toBeNull();
    expect(rows.rows.find((r) => r.id === second)!.superseded_at).toBeNull();
  });

  it("sweep deletes artifact bytes for swept rows and keeps fresh bytes (C7 sweeper)", async () => {
    const acct = await db.query<{ id: string }>(
      `INSERT INTO accounts (email, state) VALUES ('c7b@example.invalid', 'active') RETURNING id`
    );
    const store = new InMemoryObjectStore();
    await store.put("k-old", Buffer.from("old bytes"), "text/plain");
    await store.put("k-fresh", Buffer.from("fresh bytes"), "text/plain");
    await db.query(
      `INSERT INTO resume_documents (account_id, storage_key, superseded_at)
       VALUES ($1, 'k-old', $2), ($1, 'k-fresh', $3)`,
      [acct.rows[0].id, new Date(t0.getTime() - 40 * DAY), new Date(t0.getTime() - 5 * DAY)]
    );
    const results = await runRetentionSweep(db, t0, store);
    expect(results.resumeGraceMarked).toBe(1);
    expect(results.resumeArtifactsDeleted).toBe(1);
    expect(await store.get("k-old")).toBeNull();
    expect(await store.get("k-fresh")).not.toBeNull();
    const rows = await db.query<{ storage_key: string; deleted_at: Date | null }>(
      "SELECT storage_key, deleted_at FROM resume_documents ORDER BY storage_key"
    );
    expect(rows.rows.find((r) => r.storage_key === "k-old")!.deleted_at).not.toBeNull();
    expect(rows.rows.find((r) => r.storage_key === "k-fresh")!.deleted_at).toBeNull();
  });
});
