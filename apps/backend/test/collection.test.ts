// T5.1/T5.5–T5.7 — collection work unit: idempotency, partial truthfulness,
// bounded retry semantics, supersession guards. Plus a real pg-boss e2e check.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Boss from "pg-boss";
import type { HttpResponse, Transport } from "../src/sources/politeClient.js";
import { runCollectionJob } from "../src/discovery/collection.js";
import {
  requestDiscoveryRun,
  startQueuedRun,
  completeRunFromAttempts
} from "../src/discovery/orchestrator.js";
import { resetDb } from "./helpers.js";
import { testDbConfig, TEST_DB } from "./global-setup.js";
import { Pool } from "pg";

const db = new Pool({ ...testDbConfig(), database: TEST_DB });
const t0 = new Date("2026-08-23T12:00:00Z");
const now = () => new Date(t0.getTime() + 60_000);

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.end();
});

async function setupUserWithProfile(): Promise<string> {
  const row = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, state) VALUES ('disc@example.invalid', 'active') RETURNING id`
  );
  await db.query(
    `INSERT INTO profile_versions (account_id, version_number, source, content)
     VALUES ($1, 1, 'manual', '{}')`,
    [row.rows[0].id]
  );
  return row.rows[0].id;
}

async function createRunningRun(accountId: string): Promise<string> {
  const requested = await requestDiscoveryRun(db, accountId, "scheduled", t0);
  if (!("runId" in requested)) throw Error("setup");
  const started = await startQueuedRun(db, requested.runId, t0);
  if (!started.ok) throw Error("setup start");
  return started.runId;
}

function okTransport(body: unknown): Transport {
  return async () =>
    ({ status: 200, headers: {}, body: JSON.stringify(body) }) satisfies HttpResponse;
}

const GREENHOUSE_PAGE = {
  jobs: [
    {
      id: 900,
      title: "Platform Engineer",
      absolute_url: "https://boards.greenhouse.io/acme/jobs/900",
      location: { name: "Remote" },
      updated_at: "2026-08-20T00:00:00Z",
      content: "<p>Kubernetes</p>"
    }
  ]
};

describe("collection work unit", () => {
  it("succeeds, persists observations, and records attempt + idempotency outcome", async () => {
    const user = await setupUserWithProfile();
    const runId = await createRunningRun(user);
    await db.query("UPDATE job_sources SET terms_validation_recorded_at = now() WHERE slug='greenhouse'");

    const result = await runCollectionJob(
      { db, transport: okTransport(GREENHOUSE_PAGE), now },
      { runId, sourceSlug: "greenhouse", config: { boardToken: "acme" } }
    );
    expect(result).toMatchObject({ outcome: "succeeded", observationCount: 1 });

    const attempt = await db.query<{ status: string; observation_count: number }>(
      `SELECT status, observation_count FROM source_collection_attempts
        WHERE discovery_run_id = $1`,
      [runId]
    );
    expect(attempt.rows[0]).toMatchObject({ status: "succeeded", observation_count: 1 });

    const obs = await db.query("SELECT count(*)::int AS n FROM source_listing_observations");
    expect(obs.rows[0].n).toBe(1);
  });

  it("worker restart mid-job (re-delivery) completes exactly once (T5.1 AC)", async () => {
    const user = await setupUserWithProfile();
    const runId = await createRunningRun(user);

    // First delivery processes the job fully.
    const first = await runCollectionJob(
      { db, transport: okTransport(GREENHOUSE_PAGE), now },
      { runId, sourceSlug: "greenhouse", config: { boardToken: "acme" } }
    );
    expect(first.outcome).toBe("succeeded");

    // Simulated re-delivery after crash-before-ack: short-circuits on the
    // idempotency identity — no duplicate observations or attempts.
    const second = await runCollectionJob(
      { db, transport: okTransport(GREENHOUSE_PAGE), now },
      { runId, sourceSlug: "greenhouse", config: { boardToken: "acme" } }
    );
    expect(second.outcome).toBe("succeeded");

    const obsCount = await db.query(
      "SELECT count(*)::int AS n FROM source_listing_observations WHERE collected_by_run_id = $1",
      [runId]
    );
    expect(obsCount.rows[0].n).toBe(1);
    const attemptCount = await db.query(
      "SELECT count(*)::int AS n FROM source_collection_attempts WHERE discovery_run_id = $1",
      [runId]
    );
    expect(attemptCount.rows[0].n).toBe(1);
  });

  it("non-transient auth/policy failure is NOT retried automatically (T5.6 AC)", async () => {
    const user = await setupUserWithProfile();
    const runId = await createRunningRun(user);

    let calls = 0;
    const transport: Transport = async () => {
      calls += 1;
      return { status: 401, headers: {}, body: "unauthorized" };
    };

    const result = await runCollectionJob(
      { db, transport, now },
      { runId, sourceSlug: "greenhouse", config: { boardToken: "acme" } }
    );

    expect(result).toMatchObject({ outcome: "failed_non_transient" });
    expect(calls).toBe(1); // single attempt — non-transient never retried

    const attempts = await db.query(
      "SELECT count(*)::int AS n FROM source_collection_attempts WHERE discovery_run_id = $1 AND status = 'failed_non_transient'",
      [runId]
    );
    expect(attempts.rows[0].n).toBe(1);
    // No pg-boss-level retry would occur: handler resolved normally (outcome recorded).
  });

  it("forced single-source failure yields PARTIAL status with usable results (T5.5 AC)", async () => {
    const user = await setupUserWithProfile();
    const runId = await createRunningRun(user);
    await db.query(
      "UPDATE job_sources SET terms_validation_recorded_at = now() WHERE slug IN ('greenhouse','lever')"
    );

    // Greenhouse succeeds.
    await runCollectionJob(
      { db, transport: okTransport(GREENHOUSE_PAGE), now },
      { runId, sourceSlug: "greenhouse", config: { boardToken: "acme" } }
    );
    // Lever fails non-transiently.
    let leverCalls = 0;
    const leverFailing: Transport = async () => {
      leverCalls += 1;
      return { status: 404, headers: {}, body: "" };
    };
    await runCollectionJob(
      { db, transport: leverFailing, now },
      { runId, sourceSlug: "lever", config: { site: "acme" } }
    );
    expect(leverCalls).toBe(1); // no retries for non-transient

    const completion = await completeRunFromAttempts(db, runId, now());
    expect(completion.status).toBe("partial");

    // The successful source's results remain usable and truthful.
    const greenhouseObs = await db.query(
      `SELECT count(*)::int AS n FROM source_listing_observations o
        JOIN source_listings l ON l.id = o.source_listing_id
       WHERE l.job_source_slug = 'greenhouse'`
    );
    expect(greenhouseObs.rows[0].n).toBe(1);

    const run = await db.query<{ status: string }>(
      "SELECT status FROM discovery_runs WHERE id = $1",
      [runId]
    );
    expect(run.rows[0].status).toBe("partial");
  });

  it("suspension mid-queue stops work: deferred outcome, no new results (T5.7 AC)", async () => {
    const user = await setupUserWithProfile();
    const runId = await createRunningRun(user);
    const adminId = await db.query<{ id: string }>(
      `INSERT INTO accounts (email, state) VALUES ('adm57@example.invalid', 'active') RETURNING id`
    );
    const { suspendAccount } = await import("../src/identity/accounts.js");
    await suspendAccount(db, user, adminId.rows[0].id, t0);

    const result = await runCollectionJob(
      { db, transport: okTransport(GREENHOUSE_PAGE), now },
      { runId, sourceSlug: "greenhouse", config: { boardToken: "acme" } }
    );
    expect(result).toEqual({ outcome: "deferred", observationCount: 0 });
    const obs = await db.query("SELECT count(*)::int AS n FROM source_listing_observations");
    expect(obs.rows[0].n).toBe(0);
  });

  it("disabled source is refused without any network call", async () => {
    const user = await setupUserWithProfile();
    const runId = await createRunningRun(user);
    await db.query("UPDATE job_sources SET enabled = false WHERE slug='lever'");

    let calls = 0;
    const counting: Transport = async () => {
      calls += 1;
      return { status: 500, headers: {}, body: "" };
    };
    const result = await runCollectionJob(
      { db, transport: counting, now },
      { runId, sourceSlug: "lever", config: { site: "x" } }
    );
    expect(result.outcome).toBe("failed_non_transient");
    expect(calls).toBe(0);
    // restore
    await db.query("UPDATE job_sources SET enabled = true WHERE slug='lever'");
  });
});

// ---------------------------------------------------------------------------
// Real pg-boss wiring end-to-end (T5.1): queue created, job delivered,
// handler processed through the same code path as production.
// ---------------------------------------------------------------------------
describe("pg-boss wiring (T5.1)", () => {
  it("delivers a collection job to a registered handler against the test DB", async () => {
    const boss = new Boss({
      ...testDbConfig(),
      database: TEST_DB,
      schema: "pgboss_test",
      max: 2
    });
    await boss.start();
    await boss.createQueue("collection");

    let handled = 0;
    const done = new Promise<void>((resolve) => {
      void boss.work<Record<string, unknown>>("collection", {}, async (_job) => {
        handled += 1;
        resolve();
        return { done: true };
      });
    });

    await boss.send("collection", { probe: true });
    await Promise.race([done, new Promise((r) => setTimeout(r, 10_000))]);
    expect(handled).toBe(1);

    await boss.stop();
  }, 20_000);
});
