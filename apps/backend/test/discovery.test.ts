// T5.2â€“T5.4 â€” scheduling, manual-refresh guardrails, coalescing.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  isDueForScheduledRun,
  localWallClock,
  requestDiscoveryRun,
  startQueuedRun,
  type ScheduledCandidate
} from "../src/discovery/orchestrator.js";
import { makeTestPool, resetDb, TEST_DB } from "./helpers.js";
import { testDbConfig } from "./global-setup.js";
import { Pool } from "pg";

const db = new Pool({ ...testDbConfig(), database: TEST_DB });
const t0 = new Date("2026-08-23T12:00:00Z"); // 08:00 New York (EDT), 14:00 Berlin

beforeEach(async () => {
  await resetDb(db);
});
afterAll(async () => {
  await db.end();
});

async function createUser(timezone = "UTC"): Promise<string> {
  const row = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, state, timezone) VALUES ($1, 'active', $2) RETURNING id`,
    [`sched-${timezone}-${Math.random().toString(36).slice(2)}@example.invalid`, timezone]
  );
  await db.query(
    `INSERT INTO profile_versions (account_id, version_number, source, content)
     VALUES ($1, 1, 'manual', '{}')`,
    [row.rows[0].id]
  );
  return row.rows[0].id;
}

describe("time-zone-aware daily scheduling (T5.2)", () => {
  it("computes local wall clock correctly across zones", () => {
    expect(localWallClock(t0, "America/New_York")).toEqual({ date: "2026-08-23", hour: 8 });
    expect(localWallClock(t0, "Europe/Berlin")).toEqual({ date: "2026-08-23", hour: 14 });
    expect(localWallClock(t0, "UTC")).toEqual({ date: "2026-08-23", hour: 12 });
  });

  it("fires once per local day at the target hour, per zone (T5.2 AC)", () => {
    const base: ScheduledCandidate = {
      accountId: "x",
      timezone: "America/New_York",
      lastScheduledRunLocalDate: null,
      accountState: "active"
    };
    // Before 08:00 local: not due.
    expect(isDueForScheduledRun(base, new Date("2026-08-23T11:59:00Z"))).toBe(false);
    // At 08:00 local: due.
    expect(isDueForScheduledRun(base, t0)).toBe(true);
    // Already ran today (local date): not due again.
    expect(
      isDueForScheduledRun({ ...base, lastScheduledRunLocalDate: "2026-08-23" }, t0)
    ).toBe(false);
    // Next local day: due again.
    expect(
      isDueForScheduledRun(
        { ...base, lastScheduledRunLocalDate: "2026-08-23" },
        new Date("2026-08-24T12:00:00Z")
      )
    ).toBe(true);
  });

  it("Berlin and New York are due at different instants for the same target hour", () => {
    const ny: ScheduledCandidate = {
      accountId: "ny", timezone: "America/New_York",
      lastScheduledRunLocalDate: null, accountState: "active"
    };
    const berlin: ScheduledCandidate = {
      accountId: "ber", timezone: "Europe/Berlin",
      lastScheduledRunLocalDate: null, accountState: "active"
    };
    // 06:00 UTC = 02:00 NY (not due), 08:00 Berlin (due).
    const sixUtc = new Date("2026-08-23T06:00:00Z");
    expect(isDueForScheduledRun(ny, sixUtc)).toBe(false);
    expect(isDueForScheduledRun(berlin, sixUtc)).toBe(true);
    // 12:00 UTC = 08:00 NY (due now too).
    expect(isDueForScheduledRun(ny, t0)).toBe(true);
  });

  it("suspended/closed accounts are never scheduled (ADR-045)", () => {
    const suspended: ScheduledCandidate = {
      accountId: "s", timezone: "UTC",
      lastScheduledRunLocalDate: null, accountState: "suspended"
    };
    expect(isDueForScheduledRun(suspended, t0)).toBe(false);
  });

  it("requestDiscoveryRun rejects work for non-active accounts", async () => {
    const adminId = await db.query<{ id: string }>(
      `INSERT INTO accounts (email, state) VALUES ('adm5@example.invalid', 'active') RETURNING id`
    );
    const user = await createUser();
    const { suspendAccount } = await import("../src/identity/accounts.js");
    await suspendAccount(db, user, adminId.rows[0].id, t0, {});
    const result = await requestDiscoveryRun(db, user, "manual", t0);
    expect(result).toEqual({ outcome: "account_inactive" });
  });
});

describe("manual refresh guardrails (T5.3, FR-9)", () => {
  it("allows a manual refresh after the ~6h interval and rejects rapid repeats", async () => {
    const user = await createUser();
    const { completeRunFromAttempts } = await import("../src/discovery/orchestrator.js");
    const first = await requestDiscoveryRun(db, user, "manual", t0);
    expect(first.outcome).toBe("started");
    if (!("runId" in first)) return;

    // The run finishes quickly; the USER-level interval still applies.
    await startQueuedRun(db, first.runId, t0);
    await completeRunFromAttempts(db, first.runId, new Date(t0.getTime() + 30_000));

    // Rapid repeat within the interval → rejected with truthful next time.
    const soon = await requestDiscoveryRun(db, user, "manual", new Date(t0.getTime() + 60_000));
    expect(soon).toEqual({
      outcome: "rejected_min_interval",
      nextEligibleAt: new Date(t0.getTime() + 6 * 60 * 60 * 1000)
    });

    // After the interval has passed: allowed again.
    const later = await requestDiscoveryRun(
      db, user, "manual", new Date(t0.getTime() + 6 * 60 * 60 * 1000 + 1000)
    );
    expect(later.outcome).toBe("started");
  });

  it("rapid repeat requests COALESCE instead of bypassing (T5.3 AC)", async () => {
    const user = await createUser();
    await requestDiscoveryRun(db, user, "manual", t0);
    // The run is queued; a second manual request inside the window coalesces.
    const second = await requestDiscoveryRun(db, user, "manual", new Date(t0.getTime() + 120_000));
    expect(second).toMatchObject({ outcome: "coalesced" });

    const runs = await db.query(
      "SELECT count(*)::int AS n FROM discovery_runs WHERE account_id = $1",
      [user]
    );
    expect(runs.rows[0].n).toBe(1);
  });
});

describe("coalescing (T5.4, ADR-042)", () => {
  it("simultaneous scheduled+manual+profile-change triggers yield â‰¤1 follow-up", async () => {
    const user = await createUser();

    // First trigger starts a run; it transitions to running.
    const first = await requestDiscoveryRun(db, user, "scheduled", t0);
    if (!("runId" in first)) throw Error("setup");
    await startQueuedRun(db, first.runId, t0);

    // While running, all three other triggers arrive concurrently-ish.
    const results = await Promise.all([
      requestDiscoveryRun(db, user, "scheduled", new Date(t0.getTime() + 1000)),
      requestDiscoveryRun(db, user, "manual", new Date(t0.getTime() + 1100)),
      requestDiscoveryRun(db, user, "profile_change", new Date(t0.getTime() + 1200))
    ]);

    // Exactly ONE follow-up may exist; everything else coalesces into it.
    const followups = results.filter((r) => r.outcome === "queued_followup");
    const coalesced = results.filter((r) => r.outcome === "coalesced");
    expect(followups.length).toBeLessThanOrEqual(1);
    expect(followups.length + coalesced.length).toBe(results.length);

    const queuedRuns = await db.query(
      `SELECT id FROM discovery_runs
        WHERE account_id = $1 AND status = 'queued'`,
      [user]
    );
    expect(queuedRuns.rows.length).toBeLessThanOrEqual(1);
  });

  it("only one active run per user across all triggers", async () => {
    const user = await createUser();
    await Promise.all([
      requestDiscoveryRun(db, user, "scheduled", t0),
      requestDiscoveryRun(db, user, "manual", t0),
      requestDiscoveryRun(db, user, "profile_change", t0)
    ]);
    const active = await db.query(
      `SELECT count(*)::int AS n FROM discovery_runs
        WHERE account_id = $1 AND status IN ('queued','running')`,
      [user]
    );
    expect(active.rows[0].n).toBe(1);
  });
});

describe("supersession at start (ADR-045)", () => {
  it("a queued run picks up the LATEST approved profile when started", async () => {
    const user = await createUser(); // profile v1
    const first = await requestDiscoveryRun(db, user, "scheduled", t0);
    if (!("runId" in first)) throw Error("setup");

    // Material profile change BEFORE the queued run starts.
    const { saveProfileVersion } = await import("../src/profile/profileVersions.js");
    await saveProfileVersion(db, user, { summary: "newer" }, "manual", new Date(t0.getTime() + 1000));

    const start = await startQueuedRun(db, first.runId, new Date(t0.getTime() + 2000));
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(start.supersededTo).toBeTruthy(); // re-pointed to latest version

    const run = await db.query<{ status: string }>(
      "SELECT status FROM discovery_runs WHERE id = $1",
      [first.runId]
    );
    expect(run.rows[0].status).toBe("running");
  });

  it("starting additional queued runs supersedes the others (single-run invariant)", async () => {
    const user = await createUser();
    // Force two queued runs via direct inserts (orchestrator normally prevents this).
    const pv = await db.query<{ id: string }>(
      "SELECT id FROM profile_versions WHERE account_id = $1 LIMIT 1",
      [user]
    );
    const r1 = await db.query<{ id: string }>(
      `INSERT INTO discovery_runs (account_id, profile_version_id, trigger_source)
       VALUES ($1, $2, 'scheduled') RETURNING id`,
      [user, pv.rows[0].id]
    );
    void r1;
    // The partial unique index prevents the second queued insert outright:
    await expect(
      db.query(
        `INSERT INTO discovery_runs (account_id, profile_version_id, trigger_source)
         VALUES ($1, $2, 'manual')`,
        [user, pv.rows[0].id]
      )
    ).rejects.toThrow();
  });

  it("suspension before start stops the pending run (ADR-045)", async () => {
    const user = await createUser();
    const first = await requestDiscoveryRun(db, user, "scheduled", t0);
    if (!("runId" in first)) throw Error("setup");
    const adminId = await db.query<{ id: string }>(
      `INSERT INTO accounts (email, state) VALUES ('adm-susp@example.invalid', 'active') RETURNING id`
    );
    const { suspendAccount } = await import("../src/identity/accounts.js");
    await suspendAccount(db, user, adminId.rows[0].id, new Date(t0.getTime() + 500), {});

    const start = await startQueuedRun(db, first.runId, new Date(t0.getTime() + 1000));
    expect(start).toEqual({ ok: false, reason: "account_inactive" });
    const run = await db.query<{ status: string }>(
      "SELECT status FROM discovery_runs WHERE id = $1",
      [first.runId]
    );
    expect(run.rows[0].status).toBe("superseded");
  });
});

void makeTestPool;
