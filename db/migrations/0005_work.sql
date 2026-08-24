-- CareerPilot — discovery/background-work extension (Phase 5: T5.1–T5.7)

-- Per-user time-zone-aware daily scheduling (FR-8).
ALTER TABLE accounts ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';

-- ---------------------------------------------------------------------------
-- ADR-042 single-active-run invariant, corrected for the coalescing model:
-- at most ONE running run AND at most ONE queued follow-up per user.
-- (The Phase-1 index treated a queued follow-up as active, which made
-- coalescing impossible; it is replaced here.)
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS one_active_run_per_user;
CREATE UNIQUE INDEX one_running_run_per_user
  ON discovery_runs(account_id) WHERE status = 'running';
CREATE UNIQUE INDEX one_queued_followup_per_user
  ON discovery_runs(account_id) WHERE status = 'queued';
