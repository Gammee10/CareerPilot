// Discovery orchestration (T5.2â€“T5.7): single-active-run + coalescing
// (ADR-042), guarded manual refresh (FR-9), truthful partial status
// (ADR-043), supersession + active-account checks (ADR-045).
import type { Pool } from "pg";
import { recordAudit } from "../identity/audit.js";

const HOUR_MS = 60 * 60 * 1000;
export const MANUAL_REFRESH_MIN_INTERVAL_HOURS = 6;
/** Local hour at which scheduled daily runs fire for a user (FR-8). */
export const SCHEDULED_RUN_LOCAL_HOUR = 8;

// ---------------------------------------------------------------------------
// Time-zone-aware daily scheduling (T5.2, FR-8)
// ---------------------------------------------------------------------------

/** Local wall-clock "YYYY-MM-DD" + hour in a given IANA time zone. */
export function localWallClock(instant: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24
  };
}

export type ScheduledCandidate = {
  accountId: string;
  timezone: string;
  lastScheduledRunLocalDate: string | null;
  accountState: "active" | "suspended" | "closed";
};

/**
 * Pure scheduler decision: a user is due when their local time has reached
 * the target hour and no scheduled run exists for the current local date.
 * Deterministic across time zones â€” tested with two zones (T5.2 AC).
 */
export function isDueForScheduledRun(
  candidate: ScheduledCandidate,
  now: Date,
  targetHour = SCHEDULED_RUN_LOCAL_HOUR
): boolean {
  if (candidate.accountState !== "active") return false; // ADR-025/045
  const local = localWallClock(now, candidate.timezone);
  if (local.hour < targetHour) return false;
  return candidate.lastScheduledRunLocalDate !== local.date;
}

// ---------------------------------------------------------------------------
// Run request intake: guardrails + coalescing (T5.3/T5.4)
// ---------------------------------------------------------------------------

export type TriggerSource = "scheduled" | "manual" | "profile_change";

export type RequestOutcome =
  | { outcome: "started"; runId: string }
  | { outcome: "queued_followup"; runId: string }
  // coalesced: an existing queued run absorbed this request (ADR-042)
  | { outcome: "coalesced"; runId: string }
  | { outcome: "rejected_min_interval"; nextEligibleAt: Date }
  | { outcome: "account_inactive" };

async function latestProfileVersion(db: IntakeDb, accountId: string): Promise<string | null> {
  const row = await db.query<{ id: string }>(
    `SELECT id FROM profile_versions WHERE account_id = $1
      ORDER BY version_number DESC LIMIT 1`,
    [accountId]
  );
  return row.rows[0]?.id ?? null;
}

async function findActiveRun(db: IntakeDb, accountId: string) {
  const row = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM discovery_runs
      WHERE account_id = $1 AND status IN ('queued','running')
      ORDER BY created_at DESC LIMIT 1`,
    [accountId]
  );
  return row.rows[0] ?? null;
}

export async function requestDiscoveryRun(
  db: Pool,
  accountId: string,
  trigger: TriggerSource,
  now: Date,
  opts: { manualMinIntervalHours?: number } = {}
): Promise<RequestOutcome> {
  // Serialized per-account intake (ADR-042): concurrent scheduled/manual/
  // profile-change triggers must not race the check-then-insert.
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [accountId]);

    const outcome = await intake(client, accountId, trigger, now, opts);
    if (outcome.outcome === "started") {
      await recordAudit(client, {
        actorType: trigger === "manual" ? "user" : "system",
        actorAccountId: accountId,
        action: "discovery.run_requested",
        outcome: "success",
        targetCategory: "discovery_run",
        targetId: outcome.runId,
        details: { trigger }
      });
    }
    await client.query("COMMIT");
    return outcome;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

type IntakeDb = Pool | import("pg").PoolClient;

async function intake(
  db: IntakeDb,
  accountId: string,
  trigger: TriggerSource,
  now: Date,
  opts: { manualMinIntervalHours?: number }
): Promise<RequestOutcome> {
  const account = await db.query<{ state: string }>(
    "SELECT state FROM accounts WHERE id = $1",
    [accountId]
  );
  if (account.rows[0]?.state !== "active") {
    return { outcome: "account_inactive" }; // ADR-045: suspended/closed get no work
  }

  const active = await findActiveRun(db, accountId);

  // Manual refresh guardrail (FR-9 / Flow 5): ~6h minimum interval.
  if (trigger === "manual") {
    const intervalHours = opts.manualMinIntervalHours ?? MANUAL_REFRESH_MIN_INTERVAL_HOURS;
    const recent = await db.query<{ created_at: Date }>(
      `SELECT created_at FROM discovery_runs
        WHERE account_id = $1 AND status <> 'superseded'
        ORDER BY created_at DESC LIMIT 1`,
      [accountId]
    );
    if (!active && recent.rows[0]) {
      const elapsed = now.getTime() - recent.rows[0].created_at.getTime();
      if (elapsed < intervalHours * HOUR_MS) {
        return {
          outcome: "rejected_min_interval",
          nextEligibleAt: new Date(recent.rows[0].created_at.getTime() + intervalHours * HOUR_MS)
        };
      }
    }
  }

  const profileVersionId = await latestProfileVersion(db, accountId);
  if (!profileVersionId) {
    // No approved profile yet â€” nothing to discover for.
    return { outcome: "account_inactive" };
  }

  if (active) {
    // ADR-042: at most ONE follow-up may exist; requests coalesce into it.
    if (active.status === "running") {
      const followup = await db.query<{ id: string }>(
        `SELECT id FROM discovery_runs
          WHERE account_id = $1 AND status = 'queued' LIMIT 1`,
        [accountId]
      );
      if (followup.rows.length > 0) {
        await appendCoalescedReason(db, followup.rows[0].id, trigger);
        return { outcome: "coalesced", runId: followup.rows[0].id };
      }
      const inserted = await db.query<{ id: string }>(
        `INSERT INTO discovery_runs (account_id, profile_version_id, trigger_source, coalesced_reasons, created_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          accountId,
          profileVersionId,
          trigger,
          JSON.stringify([`followup_for:${active.id}`, `trigger:${trigger}`]),
          now
        ]
      );
      return { outcome: "queued_followup", runId: inserted.rows[0].id };
    }
    // Queued run not started yet: absorb the request and re-point it at the
    // latest approved profile when it starts (supersession at start time).
    await appendCoalescedReason(db, active.id, trigger);
    return { outcome: "coalesced", runId: active.id };
  }

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO discovery_runs (account_id, profile_version_id, trigger_source, created_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [accountId, profileVersionId, trigger, now]
  );
  return { outcome: "started", runId: inserted.rows[0].id };
}

async function appendCoalescedReason(
  db: IntakeDb,
  runId: string,
  trigger: TriggerSource
): Promise<void> {
  await db.query(
    `UPDATE discovery_runs
        SET coalesced_reasons = coalesced_reasons || $2::jsonb
      WHERE id = $1`,
    [runId, JSON.stringify([`trigger:${trigger}`])]
  );
}

// ---------------------------------------------------------------------------
// Run lifecycle: start (supersession), complete (truthful partial status)
// ---------------------------------------------------------------------------

/**
 * Starts a queued run: re-resolves the LATEST approved profile (supersession
 * per ADR-045 â€” pending work uses newest inputs or is skipped when it cannot
 * produce a current result), verifies the account is still active.
 */
export async function startQueuedRun(
  db: Pool,
  runId: string,
  now: Date
): Promise<
  | { ok: true; runId: string; profileVersionId: string; supersededTo?: string }
  | { ok: false; reason: "not_queued" | "account_inactive" | "superseded" }
> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{
      id: string;
      account_id: string;
      profile_version_id: string;
      status: string;
    }>("SELECT id, account_id, profile_version_id, status FROM discovery_runs WHERE id = $1 FOR UPDATE",
      [runId]);
    if (run.rows.length === 0 || run.rows[0].status !== "queued") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_queued" };
    }
    const acct = await client.query<{ state: string }>(
      "SELECT state FROM accounts WHERE id = $1 FOR UPDATE",
      [run.rows[0].account_id]
    );
    if (acct.rows[0]?.state !== "active") {
      // Suspension/closure stops pending user-specific work (ADR-045).
      await client.query(
        "UPDATE discovery_runs SET status = 'superseded', completed_at = $2 WHERE id = $1",
        [runId, now]
      );
      await recordAudit(client, {
        actorType: "capability",
        actorAccountId: run.rows[0].account_id,
        action: "discovery.run_stopped",
        outcome: "denied",
        targetCategory: "discovery_run",
        targetId: runId,
        details: { reason: "account_not_active" }
      });
      await client.query("COMMIT");
      return { ok: false, reason: "account_inactive" };
    }

    // Supersession: use the latest approved profile version at start.
    const latest = await client.query<{ id: string }>(
      `SELECT id FROM profile_versions WHERE account_id = $1
        ORDER BY version_number DESC LIMIT 1`,
      [run.rows[0].account_id]
    );
    const effectiveProfile =
      latest.rows[0]?.id ?? run.rows[0].profile_version_id;

    // Any OTHER queued runs for this account are superseded by this start.
    await client.query(
      `UPDATE discovery_runs SET status = 'superseded', completed_at = $3
        WHERE account_id = $2 AND id <> $1 AND status IN ('queued')`,
      [runId, run.rows[0].account_id, now]
    );

    await client.query(
      `UPDATE discovery_runs
          SET status = 'running', started_at = $2::timestamptz,
              profile_version_id = $4::uuid
        WHERE id = $1 AND account_id = $3`,
      [runId, now, run.rows[0].account_id, effectiveProfile]
    );
    await client.query("COMMIT");
    return {
      ok: true,
      runId,
      profileVersionId: effectiveProfile,
      supersededTo: effectiveProfile !== run.rows[0].profile_version_id ? effectiveProfile : undefined
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Truthful completion (ADR-043): status reflects aggregate attempt outcomes.
 * complete = all succeeded; failed = none produced usable results;
 * partial = usable results exist but coverage was not full.
 */
export async function completeRunFromAttempts(
  db: Pool,
  runId: string,
  now: Date
): Promise<{ status: "complete" | "partial" | "failed" }> {
  const rows = await db.query<{ status: string }>(
    `SELECT DISTINCT ON (job_source_slug) job_source_slug, status
       FROM source_collection_attempts
      WHERE discovery_run_id = $1
      ORDER BY job_source_slug, started_at DESC`,
    [runId]
  );
  const outcomes = rows.rows.map((r) => r.status);
  let status: "complete" | "partial" | "failed";
  if (outcomes.length === 0) {
    // Nothing was targeted: the run trivially had full coverage.
    status = "complete";
  } else if (outcomes.every((o) => o === "failed_non_transient" || o === "failed_transient" || o === "rate_limited")) {
    status = "failed";
  } else if (outcomes.every((o) => o === "succeeded" || o === "deferred")) {
    status = "complete";
  } else {
    status = "partial";
  }

  await db.query(
    `UPDATE discovery_runs
        SET status = $2, completed_at = $3
      WHERE id = $1 AND status = 'running'`,
    [runId, status, now]
  );
  await recordAudit(db, {
    actorType: "capability",
    action: "discovery.run_completed",
    outcome: "success",
    targetCategory: "discovery_run",
    targetId: runId,
    details: { status }
  });
  return { status };
}

const TERMINAL_ATTEMPT_STATUSES = [
  "succeeded",
  "failed_non_transient",
  "rate_limited",
  "deferred",
  "failed_transient"
];

/**
 * Auto-completes the run once every TARGETED source has a terminal attempt.
 * Derived from authoritative attempt records — never from queue state.
 * Runs without targeted sources are completed explicitly by their driver.
 */
export async function checkAndCompleteRun(db: Pool, runId: string, now: Date): Promise<void> {
  const run = await db.query<{ targeted_sources: string[]; status: string }>(
    "SELECT targeted_sources, status FROM discovery_runs WHERE id = $1",
    [runId]
  );
  if (run.rows.length === 0) return;
  const targets = run.rows[0].targeted_sources ?? [];
  if (targets.length === 0 || run.rows[0].status !== "running") return;

  const done = await db.query<{ job_source_slug: string; status: string }>(
    `SELECT DISTINCT ON (job_source_slug) job_source_slug, status
       FROM source_collection_attempts
      WHERE discovery_run_id = $1
      ORDER BY job_source_slug, started_at DESC`,
    [runId]
  );
  const terminalSlugs = new Set(
    done.rows.filter((r) => TERMINAL_ATTEMPT_STATUSES.includes(r.status)).map((r) => r.job_source_slug)
  );
  if (targets.every((t) => terminalSlugs.has(t))) {
    await completeRunFromAttempts(db, runId, now);
  }
}
