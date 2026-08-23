-- CareerPilot — shared job pipeline extension (Phase 4: T4.0–T4.6)

-- Material-change classification persisted per observation (ADR-039).
ALTER TABLE source_listing_observations ADD COLUMN change_classification text
  CHECK (change_classification IS NULL OR
         change_classification IN ('initial','material','non_material'));

-- Conservative strong-match key for canonicalization (ADR-006):
-- normalized (company | title | location). NULL = not yet keyed.
ALTER TABLE source_listings ADD COLUMN strong_match_key text;
CREATE INDEX source_listings_strong_key_idx ON source_listings(strong_match_key);

-- ---------------------------------------------------------------------------
-- T4.0 BLOCKING PRECONDITION EVIDENCE — current-API-terms validation records.
-- Verified 2026-08-23 against live documentation; details and citations in
-- docs/dev/source-terms.md. Adapters may not be used without these records.
-- ---------------------------------------------------------------------------
UPDATE job_sources SET
  terms_validation_recorded_at = now(),
  terms_validation_ref = 'docs/dev/source-terms.md#greenhouse'
WHERE slug = 'greenhouse';

UPDATE job_sources SET
  terms_validation_recorded_at = now(),
  terms_validation_ref = 'docs/dev/source-terms.md#lever'
WHERE slug = 'lever';

UPDATE job_sources SET
  terms_validation_recorded_at = now(),
  terms_validation_ref = 'docs/dev/source-terms.md#remoteok'
WHERE slug = 'remoteok';
