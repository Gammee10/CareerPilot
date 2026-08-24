-- CareerPilot — run completion tracking (Phase 5 follow-up fix)
-- Truthful completion is computed from authoritative attempt records versus
-- the set of sources actually targeted for the run — not from queue state.

ALTER TABLE discovery_runs ADD COLUMN targeted_sources jsonb NOT NULL DEFAULT '[]'::jsonb;
