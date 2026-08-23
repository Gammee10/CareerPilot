-- CareerPilot — initial schema (T1.2)
-- Implements docs/domain-model.md under ADR-048 (PostgreSQL sole system of record).
--
-- Append-only tables (AGENTS.md invariant 7, ADRs 005/013/037):
--   profile_versions, evaluations, source_listing_observations,
--   availability_history, audit_events.
-- UPDATE is forbidden unconditionally; DELETE is forbidden except during the
-- scheduled retention sweep (ADRs 020/021), which must set
-- `SET LOCAL app.retention_sweep = 'on'` inside its transaction.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- Note: the schema_migrations bookkeeping table is owned by the migration
-- runner (apps/backend/src/tools/migrate.ts) and is not created here.

-- Rejects mutation of append-only rows. DELETE is permitted only inside a
-- transaction explicitly marked as the retention sweep; UPDATE never.
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'table % is append-only: updates are forbidden', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(current_setting('app.retention_sweep', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'table % is append-only: deletes allowed only in retention sweep', TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Retention-sweep delete: returning OLD proceeds with the deletion.
  -- (Returning NULL would silently cancel it.)
  RETURN OLD;
END $$;

-- ---------------------------------------------------------------------------
-- Accounts, identity, governance (domain-model §Account/Access/Governance)
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  suspended_at timestamptz,
  CONSTRAINT closed_state_has_timestamp
    CHECK ((state = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT suspended_state_has_timestamp
    CHECK ((state = 'suspended') = (suspended_at IS NOT NULL))
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  token_hash text NOT NULL UNIQUE,           -- opaque token stored hashed only
  status text NOT NULL CHECK (status IN ('issued','accepted','expired','revoked')),
  invited_by_account_id uuid REFERENCES accounts(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,           -- 14 days per ADR-026
  accepted_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX invitations_email_idx ON invitations(email);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  token_hash text NOT NULL UNIQUE,           -- opaque session credential, hashed
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,  -- ADR-027: 30d user / 12h admin
  idle_expires_at timestamptz NOT NULL,      -- ADR-027: 7d user / 1h admin
  revoked_at timestamptz                     -- set immediately on suspension/closure
);
CREATE INDEX sessions_account_idx ON sessions(account_id);

CREATE TABLE administrator_role_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_account_id uuid NOT NULL REFERENCES accounts(id),
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  initiated_by_account_id uuid NOT NULL REFERENCES accounts(id),
  approved_by_account_id uuid REFERENCES accounts(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','executed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  executed_at timestamptz,
  -- Dual control (ADR-031): no self-approval.
  CONSTRAINT no_self_approval CHECK (approved_by_account_id IS NULL OR approved_by_account_id <> initiated_by_account_id)
);

CREATE TABLE exceptional_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_account_id uuid NOT NULL REFERENCES accounts(id),
  purpose text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  emergency boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('requested','approved','completed','reviewed','denied')),
  approved_by_account_id uuid REFERENCES accounts(id),
  retrospective_reviewed_by_account_id uuid REFERENCES accounts(id),
  time_limit timestamptz NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE preservation_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owned_by_account_id uuid REFERENCES accounts(id),
  data_scope jsonb NOT NULL,
  justification text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','expired','released')),
  created_by_account_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  review_date timestamptz NOT NULL,
  released_at timestamptz
);

-- Audit events: metadata only — raw sensitive payloads are excluded by policy
-- (ADR-015); this schema cannot store them by design of usage conventions.
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (actor_type IN ('user','admin','system','capability')),
  actor_account_id uuid REFERENCES accounts(id),
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success','failure','denied')),
  target_category text,
  target_id text,
  correlation_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_events_occurred_idx ON audit_events(occurred_at);
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Profile and resume processing (domain-model §Profile/Evaluation Versioning)
-- ---------------------------------------------------------------------------

CREATE TABLE career_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id),
  current_profile_version_id uuid,          -- FK added after profile_versions
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resume_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  storage_key text NOT NULL,                -- object reference only; artifact lives in Object Storage (ADR-050)
  sha256 text,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  content_type text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,                -- start of 30-day grace (ADR-020)
  deleted_at timestamptz                    -- set when removed from active storage
);
CREATE INDEX resume_documents_account_idx ON resume_documents(account_id);

CREATE TABLE resume_extraction_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  resume_document_id uuid REFERENCES resume_documents(id),  -- null = manual path
  proposed_content jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','ready','accepted','discarded')),
  accepted_profile_version_id uuid,         -- FK added after profile_versions
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Immutable snapshot on every save (ADR-005). Hard-constraint vs preference
-- classification lives inside content jsonb.
CREATE TABLE profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  version_number integer NOT NULL CHECK (version_number >= 1),
  source text NOT NULL CHECK (source IN ('manual','extraction_draft')),
  content jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, version_number)
);
CREATE TRIGGER profile_versions_append_only
  BEFORE UPDATE OR DELETE ON profile_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE career_profiles
  ADD CONSTRAINT career_profiles_current_version_fk
  FOREIGN KEY (current_profile_version_id) REFERENCES profile_versions(id);
ALTER TABLE resume_extraction_drafts
  ADD CONSTRAINT drafts_accepted_version_fk
  FOREIGN KEY (accepted_profile_version_id) REFERENCES profile_versions(id);

-- ---------------------------------------------------------------------------
-- Shared job data (domain-model §Core Job Model; ADRs 004/006/007/037/038/046)
-- ---------------------------------------------------------------------------

CREATE TABLE job_sources (
  slug text PRIMARY KEY CHECK (slug IN ('greenhouse','lever','remoteok','url_import')),
  enabled boolean NOT NULL DEFAULT true,     -- each adapter independently disableable (ADR-059)
  terms_validation_recorded_at timestamptz,  -- T4.0 blocking-precondition evidence
  terms_validation_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO job_sources(slug) VALUES ('greenhouse'),('lever'),('remoteok'),('url_import');

CREATE TABLE canonical_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  profile_version_id uuid NOT NULL REFERENCES profile_versions(id),
  trigger_source text NOT NULL CHECK (trigger_source IN ('scheduled','manual','profile_change')),
  coalesced_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ADR-042 truthfulness
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','complete','partial','failed','superseded')),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
-- ADR-042: at most one active run per user at any time.
CREATE UNIQUE INDEX one_active_run_per_user
  ON discovery_runs(account_id)
  WHERE status IN ('queued','running');

CREATE TABLE source_collection_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discovery_run_id uuid NOT NULL REFERENCES discovery_runs(id),
  job_source_slug text NOT NULL REFERENCES job_sources(slug),
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),  -- ADR-044 budget
  query text,                                -- search criteria only; never sensitive payload
  page_budget integer NOT NULL DEFAULT 5,
  pages_fetched integer NOT NULL DEFAULT 0,
  timeout_ms integer,
  retry_after_until timestamptz,             -- Retry-After honored (ADR-044)
  status text NOT NULL
    CHECK (status IN ('in_progress','succeeded','failed_transient','failed_non_transient','rate_limited','deferred')),
  error_code text,                           -- code only; no sensitive detail
  observation_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- Listing identity: one row per source-specific listing. Current-view fields
-- below are DERIVED, pipeline-maintained projections of the latest relevant
-- observations — not independent evidence (ADR-037).
CREATE TABLE source_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_source_slug text NOT NULL REFERENCES job_sources(slug),
  external_listing_key text NOT NULL,
  canonical_job_id uuid REFERENCES canonical_jobs(id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  latest_observation_at timestamptz,
  current_title text,
  current_location text,
  preferred_application_url text,            -- employer ATS preferred (ADR-007)
  alternative_application_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (job_source_slug, external_listing_key)
);
CREATE INDEX source_listings_canonical_idx ON source_listings(canonical_job_id);

-- Immutable, provenance-preserving observations (ADR-037).
CREATE TABLE source_listing_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_listing_id uuid NOT NULL REFERENCES source_listings(id),
  collected_by_run_id uuid REFERENCES discovery_runs(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  availability_signal text
    CHECK (availability_signal IS NULL OR availability_signal IN ('active','closed','removed')),
  content_hash text NOT NULL,                -- material-change detection input (ADR-039)
  provenance jsonb NOT NULL                  -- permitted source fields + fetch metadata
);
-- Retries must not duplicate observations for the same logical collection,
-- including collection without a linked run (hence NULLS NOT DISTINCT).
CREATE UNIQUE INDEX observations_idempotent_idx
  ON source_listing_observations(source_listing_id, collected_by_run_id, content_hash)
  NULLS NOT DISTINCT;
CREATE TRIGGER source_listing_observations_append_only
  BEFORE UPDATE OR DELETE ON source_listing_observations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Non-destructive reconciliation records (ADR-038): both identities retained;
-- historical evaluations/reviews are never rewritten.
CREATE TABLE canonical_job_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('merge','split')),
  from_canonical_job_id uuid NOT NULL REFERENCES canonical_jobs(id),
  to_canonical_job_id uuid NOT NULL REFERENCES canonical_jobs(id),
  confidence text NOT NULL CHECK (confidence IN ('high','uncertain')),
  evidence jsonb NOT NULL,
  performed_by_run_id uuid REFERENCES discovery_runs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Evidence-weighted availability history (ADR-046). Absence never writes a row.
CREATE TABLE availability_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canonical_job_id uuid NOT NULL REFERENCES canonical_jobs(id),
  source_listing_id uuid REFERENCES source_listings(id),   -- null = canonical-level inference
  state text NOT NULL CHECK (state IN ('active','unavailable','stale','uncertain')),
  reason text NOT NULL CHECK (reason IN
    ('explicit_closed','explicit_removed','freshness_window_stale',
     'freshness_window_uncertain','observation_active','restored')),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX availability_history_job_idx ON availability_history(canonical_job_id, recorded_at);
CREATE TRIGGER availability_history_append_only
  BEFORE UPDATE OR DELETE ON availability_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Search strategy, evaluations, reviews
-- ---------------------------------------------------------------------------

CREATE TABLE search_strategy (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  source_targeting jsonb NOT NULL DEFAULT '{}'::jsonb,   -- enabled sources / targeting prefs
  disabled_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE search_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  term text NOT NULL,
  origin text NOT NULL DEFAULT 'user_edited' CHECK (origin IN ('generated','user_edited')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_terms_account_idx ON search_terms(account_id);

-- Immutable evaluation snapshots (ADR-013). Each ties to its exact inputs:
-- profile version + job observation + matching-policy version. AI-derived
-- content persists here only after Node-side validation (ADR-054).
CREATE TABLE evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  canonical_job_id uuid NOT NULL REFERENCES canonical_jobs(id),
  profile_version_id uuid NOT NULL REFERENCES profile_versions(id),
  input_observation_id uuid REFERENCES source_listing_observations(id),
  matching_policy_version text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','failed')),
  eligibility text NOT NULL
    CHECK (eligibility IN ('confirmed','unverified','conflicting','ineligible')),
  constraint_failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,  -- evidence links + uncertainty labels
  score numeric,
  superseded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evaluations_user_job_idx ON evaluations(account_id, canonical_job_id, created_at DESC);
CREATE TRIGGER evaluations_append_only
  BEFORE UPDATE OR DELETE ON evaluations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE user_job_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  canonical_job_id uuid NOT NULL REFERENCES canonical_jobs(id),
  state text NOT NULL CHECK (state IN ('new','seen','saved','not_interested')),
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, canonical_job_id)
);

-- Background-work idempotency (ADR-045): re-delivery of the same logical work
-- yields at most one persisted outcome per idempotency identity.
CREATE TABLE idempotency_records (
  idempotency_key text PRIMARY KEY,
  work_type text NOT NULL,
  outcome jsonb,
  completed_at timestamptz NOT NULL DEFAULT now()
);
