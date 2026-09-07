-- CareerPilot — operational indexes + dead-column removal (H15).
--
-- 1. Missing indexes on hot FK/sweep/lookup paths. Plain (non-concurrent)
--    builds are acceptable pre-onboarding with tiny tables; any future
--    production rebuild must use CREATE INDEX CONCURRENTLY in a maintenance
--    window instead.
-- 2. Drops the dead evaluations.superseded column: UPDATE is forbidden on the
--    append-only table so the flag could never be flipped; supersession is
--    derived from newer snapshots (ADR-005/037, invariant 7). Queries now
--    filter outcome='succeeded' only.
-- 3. Sweep-role separation (dedicated sweep role / SECURITY DEFINER) is
--    intentionally NOT implemented here: the design has a single app DB role,
--    so role separation would be theater without a second principal. Revisit
--    when read-replicas or additional roles exist.

-- Collection attempts per run (orchestrator completion + status reads).
CREATE INDEX IF NOT EXISTS source_collection_attempts_run_idx
  ON source_collection_attempts(discovery_run_id);

-- Observation lookups: latest-per-listing (M10/H7/C8 DISTINCT ON paths),
-- run linkage, and the 180-day time-based sweep.
CREATE INDEX IF NOT EXISTS source_listing_observations_latest_idx
  ON source_listing_observations(source_listing_id, observed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS source_listing_observations_run_idx
  ON source_listing_observations(collected_by_run_id);
CREATE INDEX IF NOT EXISTS source_listing_observations_observed_idx
  ON source_listing_observations(observed_at);

-- Evaluation input linkage (compatibility selection + retention guards).
CREATE INDEX IF NOT EXISTS evaluations_profile_version_idx
  ON evaluations(profile_version_id);
CREATE INDEX IF NOT EXISTS evaluations_input_observation_idx
  ON evaluations(input_observation_id);

-- Audit actor/action/correlation lookups.
CREATE INDEX IF NOT EXISTS audit_events_action_idx
  ON audit_events(action);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx
  ON audit_events(actor_account_id);
CREATE INDEX IF NOT EXISTS audit_events_correlation_idx
  ON audit_events(correlation_id) WHERE correlation_id IS NOT NULL;

-- Sign-in link expiry scans.
CREATE INDEX IF NOT EXISTS signin_links_expires_idx
  ON signin_links(expires_at);

-- Resume grace sweep: superseded but not yet soft-deleted rows.
CREATE INDEX IF NOT EXISTS resume_documents_grace_idx
  ON resume_documents(superseded_at) WHERE deleted_at IS NULL;

-- Time-based sweeps on history/audit-adjacent tables.
CREATE INDEX IF NOT EXISTS availability_history_recorded_idx
  ON availability_history(recorded_at);
CREATE INDEX IF NOT EXISTS exceptional_access_requested_idx
  ON exceptional_access_requests(requested_at);

-- Dead column removal (see header note 2).
ALTER TABLE evaluations DROP COLUMN IF EXISTS superseded;
